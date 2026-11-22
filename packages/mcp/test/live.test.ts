// Runs against the real Things app. Opt-in: `pnpm test:live` (sets THINGS_LIVE=1).
// Creates one clearly-labelled to-do and moves it to the Trash at the end.
import { afterAll, describe, expect, it } from "vitest";
import { ThingsClient } from "../src/things/client.js";
import { localDay } from "../src/when.js";

const live = process.env.THINGS_LIVE === "1";
const things = new ThingsClient();
const marker = `[things3pp live test ${Date.now()}]`;
let id: string | undefined;

describe.runIf(live)("live Things", () => {
  afterAll(async () => {
    // Trash everything this run created, even if a step failed halfway.
    const leftovers = await things.search(marker, { includeCompleted: true });
    for (const item of leftovers.items) if (item.title.startsWith(marker)) await things.trashForTests(item.id);
  });

  it("reaches Things", async () => {
    const res = await things.ping();
    expect(res.version).toMatch(/^\d+\./);
    expect(res.lists).toBeGreaterThan(0);
  });

  it("reads the built-in lists", async () => {
    for (const list of ["inbox", "today", "upcoming", "anytime", "someday"] as const) {
      const page = await things.list(list, 5);
      expect(page.items.length).toBeLessThanOrEqual(5);
      expect(page.total).toBeGreaterThanOrEqual(page.items.length);
    }
  });

  it("creates, finds, updates, completes and reopens a to-do", async () => {
    const created = await things.addTodo({ title: marker, notes: "safe to delete", when: "anytime" });
    id = created.id;
    expect(created.title).toBe(marker);
    expect(created.status).toBe("open");

    const found = await things.search(marker);
    expect(found.items.map((t) => t.id)).toContain(id);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const updated = await things.update({ id, notes: "updated", deadline: localDay(tomorrow), when: localDay(tomorrow) });
    expect(updated.notes).toBe("updated");
    expect(updated.deadline).toBe(localDay(tomorrow));
    expect(updated.when).toBe(localDay(tomorrow));

    const cleared = await things.update({ id, deadline: null });
    expect(cleared.deadline).toBeNull();

    expect((await things.setStatus(id, "completed")).status).toBe("completed");
    expect((await things.setStatus(id, "open")).status).toBe("open");
  });

  it("moves between Someday, Anytime and Inbox", async () => {
    const inList = async (list: "someday" | "anytime" | "inbox") =>
      (await things.list(list, 500)).items.some((t) => t.id === id);
    await things.update({ id: id!, when: "someday" });
    expect(await inList("someday")).toBe(true);
    await things.update({ id: id!, when: "anytime" });
    expect(await inList("anytime")).toBe(true);
    await things.update({ id: id!, when: "inbox" });
    expect(await inList("inbox")).toBe(true);
  });

  it("creates a project with starter to-dos", async () => {
    const project = await things.addProject({ title: `${marker} project`, todos: [`${marker} step 1`, `${marker} step 2`], when: "someday" });
    expect(project.kind).toBe("project");
    const inside = await things.project(project.id);
    expect(inside.items.map((t) => t.title)).toEqual([`${marker} step 1`, `${marker} step 2`]);
  });
});
