import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ThingsClient } from "../../dist/things/client.js";
import { localDay } from "../../dist/when.js";
import { connectStdio, enabled, marker, scan } from "./support.js";

const uri = "ui://things/view.html";
const views = ["show_list", "show_project", "show_area", "search_todos", "get_todo"];
const catalogs = ["list_projects", "list_areas", "list_tags"];
const writes = ["add_todo", "add_project", "update_todo", "complete_todo", "reopen_todo"];
const title = `${marker} <img src=x onerror=alert(1)>`;
const notes = "Temporary e2e notes";
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
const date = localDay(tomorrow);

describe.runIf(enabled)("built stdio server and MCP App", () => {
  let client: Awaited<ReturnType<typeof connectStdio>>;
  let id: string;
  let tag: string;
  const things = new ThingsClient();
  const owned = new Set<string>();
  let writesAttempted = false;

  beforeAll(async () => {
    await things.ping();
    client = await connectStdio();
  }, 40_000);

  afterAll(async () => {
    await client?.close();
    if (!writesAttempted) return;
    const before = await scan();
    for (const item of Object.values(before).flat()) {
      if (item.title.startsWith(marker)) owned.add(item.id);
    }
    const failures: unknown[] = [];
    // Children are created after the project and should be trashed before it.
    for (const item of [...owned].reverse()) {
      try {
        await things.trashForTests(item);
      } catch (error) {
        failures.push(error);
      }
    }
    const remaining = await scan();
    expect(Object.values(remaining).flat().map(({ id }) => id), "e2e-prefixed items outside Trash").toEqual([]);
    console.info("Cleanup scan clear across Inbox, Today, Anytime, Someday, Upcoming, Logbook and projects.");
    expect(failures, "cleanup failures").toEqual([]);
  }, 90_000);

  async function invoke(name: string, args: Record<string, unknown> = {}) {
    const start = performance.now();
    try {
      return await client.callTool({ name, arguments: args });
    } finally {
      const elapsed = performance.now() - start;
      console.info(`${name} ${Math.round(elapsed)} ms${elapsed > 5000 ? " (slow)" : ""}`);
    }
  }

  async function call(name: string, args?: Record<string, unknown>, view?: string) {
    const result = await invoke(name, args);
    // Avoid printing private Things contents on assertion failure.
    expect(result.isError ?? false, `${name}: ${result.isError ? JSON.stringify(result.content) : ""}`).toBe(false);
    expect((result.content as { type: string }[]).some(({ type }) => type === "text")).toBe(true);
    expect(result.structuredContent).toBeDefined();
    if (view) expect(result.structuredContent?.view).toBe(view);
    return result;
  }

  it("advertises the exact tools and serves the inline HTML", async () => {
    const { tools } = await client.listTools();
    expect(tools.map(({ name }) => name).sort()).toEqual([...views, ...catalogs, ...writes].sort());
    for (const { name, annotations, _meta } of tools) {
      const read = !writes.includes(name);
      expect(annotations).toMatchObject({ readOnlyHint: read, openWorldHint: false });
      if (!read) {
        expect(annotations).toMatchObject({
          destructiveHint: name === "update_todo",
          idempotentHint: !name.startsWith("add_"),
        });
      }
      if (!catalogs.includes(name)) expect(_meta?.ui).toMatchObject({ resourceUri: uri });
    }
    const { contents } = await client.readResource({ uri });
    expect(contents[0]).toMatchObject({ uri, mimeType: "text/html;profile=mcp-app" });
    expect(contents[0].text).toMatch(/<!doctype html>/i);
    expect(contents[0].text).not.toMatch(/<(?:script|link)\b[^>]*(?:src|href)\s*=\s*["'](?:https?:)?\/\//i);
  });

  it("reads all lists and catalogs and exercises the write lifecycle", async () => {
    for (const list of ["inbox", "today", "anytime", "someday", "upcoming", "logbook"]) {
      await call("show_list", { list, limit: 5 }, "list");
    }
    const areas = (await call("list_areas")).structuredContent!.areas as { id: string }[];
    expect(Array.isArray(areas)).toBe(true);
    expect(areas.length, "an existing area is needed for a read-only show_area check").toBeGreaterThan(0);
    await call("show_area", { area: areas[0].id, limit: 5 }, "list");
    expect(Array.isArray((await call("list_projects")).structuredContent!.projects)).toBe(true);
    const tags = (await call("list_tags")).structuredContent!.tags as { title: string }[];
    expect(tags.length, "an existing tag is needed for tag rendering").toBeGreaterThan(0);
    tag = tags[0].title;

    writesAttempted = true;
    const created = (await call("add_todo", { title, notes, deadline: date, when: "tomorrow", tags: [tag] }, "item")).structuredContent!.item as { id: string };
    id = created.id;
    owned.add(id);
    expect(created).toMatchObject({ title, notes, when: date, deadline: date, tags: [tag] });

    const found = await call("search_todos", { query: marker }, "list");
    expect(found.structuredContent!.items).toEqual([expect.objectContaining({ id })]);
    expect((await call("get_todo", { id }, "item")).structuredContent!.item).toMatchObject({ id, title });

    const updated = await call("update_todo", { id, title: `${marker} updated`, notes: "updated", deadline: null }, "item");
    expect(updated.structuredContent!.item).toMatchObject({ title: `${marker} updated`, notes: "updated", deadline: null });
    for (const list of ["someday", "anytime", "inbox"]) {
      await call("update_todo", { id, when: list }, "item");
      const result = await call("show_list", { list, limit: 500 }, "list");
      expect((result.structuredContent!.items as { id: string }[]).some((item) => item.id === id)).toBe(true);
    }
    expect((await call("update_todo", { id, when: date }, "item")).structuredContent!.item).toMatchObject({ when: date });
    for (const [tool, status] of [["complete_todo", "completed"], ["reopen_todo", "open"]]) {
      expect((await call(tool, { id }, "item")).structuredContent!.item).toMatchObject({ status });
    }

    const todos = [`${marker} first`, `${marker} second`];
    const project = (await call("add_project", { title: `${marker} project`, todos }, "item")).structuredContent!.item as { id: string };
    owned.add(project.id);
    const inside = await call("show_project", { project: project.id }, "list");
    const children = inside.structuredContent!.items as { id: string; title: string }[];
    for (const child of children.filter((item) => item.title.startsWith(marker))) owned.add(child.id);
    expect(children.map((item) => item.title)).toEqual(todos);
  }, 150_000);

  it("rejects invalid dates, scheduling and an empty title without changing Things", async () => {
    expect(id).toBeTruthy();
    const before = await scan();
    for (const args of [{ deadline: "2026-02-30" }, { when: "whenever" }]) {
      expect((await invoke("add_todo", { title: `${marker} invalid`, ...args })).isError).toBe(true);
    }
    // An update probes the shared title validator without risking an unmarked creation.
    expect((await invoke("update_todo", { id, title: "" })).isError).toBe(true);
    expect((await call("get_todo", { id }, "item")).structuredContent!.item).toMatchObject({ title: `${marker} updated` });
    expect(await scan()).toEqual(before);
  }, 60_000);

  it("renders real results in Chrome and rolls back a rejected checkbox action", async () => {
    expect(id).toBeTruthy();
    await call("update_todo", { id, title, notes, when: date, deadline: date }, "item");
    const item = await call("get_todo", { id }, "item");
    const list = await call("show_list", { list: "upcoming", limit: 500 }, "list");
    const items = (list.structuredContent!.items as { id: string }[]).filter((todo) => todo.id === id);
    expect(items).toHaveLength(1);
    const html = await readFile(new URL("../../dist/ui/view.html", import.meta.url), "utf8");
    const shots = resolve(process.env.THINGS_E2E_SHOTS ?? "/tmp/things3pp-e2e-shots");
    await mkdir(shots, { recursive: true });
    const host = await build({
      stdin: { contents: `
        import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
        window.calls = [];
        const frame = document.createElement("iframe");
        frame.style = "border:0;width:100%;height:100vh";
        frame.sandbox = "allow-scripts";
        document.body.append(frame);
        const bridge = new AppBridge(null, { name: "e2e", version: "1" }, { serverTools: {} }, { hostContext: { theme: "light" } });
        bridge.oncalltool = async (params) => {
          window.calls.push(params);
          return await new Promise((resolve) => { window.answer = resolve; });
        };
        window.ready = new Promise((resolve) => { bridge.oninitialized = resolve; });
        window.bridge = bridge;
        void bridge.connect(new PostMessageTransport(frame.contentWindow, frame.contentWindow));
        window.mount = (html) => { frame.srcdoc = html; };
      `, resolveDir: process.cwd() },
      bundle: true, write: false, format: "iife",
    });
    const browser = await chromium.launch({ channel: process.env.THINGS_E2E_BROWSER ?? "chrome" });
    try {
      const page = await browser.newPage({ viewport: { width: 820, height: 540 } });
      const dialogs: string[] = [];
      page.on("dialog", async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
      await page.setContent('<body style="margin:0"></body>');
      await page.addScriptTag({ content: host.outputFiles[0].text });
      await page.evaluate(async (appHtml) => {
        window.mount(appHtml);
        await window.ready;
        await window.bridge.sendToolInput({ arguments: { list: "upcoming" } });
      }, html);
      await page.evaluate((payload) => window.bridge.sendToolResult(payload), {
        content: [{ type: "text", text: "Upcoming fixture" }],
        structuredContent: { ...list.structuredContent, items, total: 1 },
      });
      const frame = page.frameLocator("iframe");
      const row = frame.locator(".row");
      await row.getByText(title, { exact: true }).waitFor();
      expect(await frame.locator(".group").count()).toBe(1);
      expect(await frame.locator("img").count()).toBe(0);
      expect(dialogs).toEqual([]);
      expect(await row.locator(".tag").textContent()).toBe(tag);
      expect(await row.locator(".deadline").getAttribute("title")).toBe(`Deadline ${date}`);
      await page.screenshot({ path: resolve(shots, "list-light.png") });
      await page.evaluate(() => window.bridge.setHostContext({ theme: "dark" }));
      await frame.locator('html[data-theme="dark"]').waitFor({ state: "attached" });
      await page.screenshot({ path: resolve(shots, "list-dark.png") });

      const checkbox = row.getByRole("checkbox");
      await checkbox.click();
      await page.waitForFunction(() => window.calls.length === 1);
      expect(await page.evaluate(() => window.calls)).toMatchObject([{ name: "complete_todo", arguments: { id } }]);
      expect(await checkbox.getAttribute("aria-checked")).toBe("true");
      await page.evaluate(() => window.answer({ isError: true, content: [{ type: "text", text: "Mock completion rejected" }] }));
      await frame.getByText("Mock completion rejected", { exact: true }).waitFor();
      expect(await checkbox.getAttribute("aria-checked")).toBe("false");
      await checkbox.click();
      await page.waitForFunction(() => window.calls.length === 2);
      await page.evaluate((payload) => window.answer(payload), {
        content: [{ type: "text", text: "Mock completion succeeded" }],
        structuredContent: { ...item.structuredContent, item: { ...(item.structuredContent!.item as object), status: "completed" } },
      });
      await row.locator('button[aria-checked="true"]:enabled').waitFor();

      await page.evaluate(() => window.bridge.setHostContext({ theme: "light" }));
      await page.evaluate((payload) => window.bridge.sendToolResult(payload), item);
      await frame.locator(".card").getByText(notes, { exact: true }).waitFor();
      await frame.locator('html[data-theme="light"]').waitFor({ state: "attached" });
      await page.screenshot({ path: resolve(shots, "item-card.png") });
      console.info(`Screenshots saved in ${shots}`);
    } finally {
      await browser.close();
    }
  }, 60_000);
});
