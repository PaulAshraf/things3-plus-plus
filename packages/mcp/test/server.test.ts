import { afterEach, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer, VIEW_URI } from "../src/server.js";
import { ThingsClient } from "../src/things/client.js";
import { bridgeError, fakeRunner, todo } from "./fixtures.js";

const WRITE_TOOLS = ["add_todo", "add_project", "update_todo", "complete_todo", "reopen_todo"];
const READ_TOOLS = ["show_list", "show_project", "show_area", "search_todos", "get_todo", "list_projects", "list_areas", "list_tags"];

let client: Client | undefined;
afterEach(async () => {
  await client?.close();
  client = undefined;
});

async function connect(handler: Parameters<typeof fakeRunner>[0]) {
  const fake = fakeRunner(handler);
  const server = createServer(new ThingsClient(fake.runner));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(b);
  return { client, calls: fake.calls };
}

function text(res: { content?: unknown }): string {
  return ((res.content as { type: string; text?: string }[]) ?? []).map((c) => c.text ?? "").join("\n");
}

describe("MCP server", () => {
  it("exposes exactly the expected tools, and nothing that deletes", async () => {
    const { client } = await connect(() => null);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...READ_TOOLS, ...WRITE_TOOLS].sort());
    expect(names.some((n) => /delete|trash|remove|empty/i.test(n))).toBe(false);
  });

  it("marks read tools read-only and write tools not", async () => {
    const { client } = await connect(() => null);
    const { tools } = await client.listTools();
    for (const t of tools) {
      if (READ_TOOLS.includes(t.name)) expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      else expect(t.annotations?.readOnlyHint, t.name).toBe(false);
    }
  });

  it("links UI tools to the view resource and serves it as an MCP App", async () => {
    const { client } = await connect(() => null);
    const { tools } = await client.listTools();
    const show = tools.find((t) => t.name === "show_list")!;
    expect((show._meta as { ui?: { resourceUri?: string } }).ui?.resourceUri).toBe(VIEW_URI);
    const res = await client.readResource({ uri: VIEW_URI });
    const content = res.contents[0] as { mimeType?: string; text?: string };
    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    expect(content.text).toContain("<html");
  });

  it("show_list returns text for the model and structured data for the UI", async () => {
    const items = [todo({ title: "Write report", tags: ["work"], project: { id: "p1", name: "Q4" } })];
    const { client, calls } = await connect((op, args) => {
      expect(op).toBe("list");
      expect(args).toMatchObject({ list: "today" });
      return { total: 1, items };
    });
    const res = await client.callTool({ name: "show_list", arguments: { list: "today" } });
    expect(res.isError).toBeFalsy();
    expect(text(res)).toContain("Write report");
    expect(text(res)).toContain("id: abc123");
    expect(res.structuredContent).toMatchObject({ view: "list", title: "Today", total: 1, source: { tool: "show_list" } });
    expect(calls).toHaveLength(1);
  });

  it("resolves 'tomorrow' before it reaches Things", async () => {
    const { client, calls } = await connect((_op, args) => todo({ title: String(args.title) }));
    await client.callTool({ name: "add_todo", arguments: { title: "Call mom", when: "tomorrow" } });
    expect(calls[0]!.args.when).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("rejects invalid input without calling Things", async () => {
    const { client, calls } = await connect(() => todo());
    const bad = await client.callTool({ name: "add_todo", arguments: { title: "x", when: "someday-ish" } });
    expect(bad.isError).toBe(true);
    const badDate = await client.callTool({ name: "add_todo", arguments: { title: "x", deadline: "2026-02-31" } });
    expect(badDate.isError).toBe(true);
    const blank = await client.callTool({ name: "add_todo", arguments: { title: "   " } });
    expect(blank.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("complete and reopen set the right status", async () => {
    const { client, calls } = await connect((_op, args) => todo({ status: args.status as "open" }));
    const done = await client.callTool({ name: "complete_todo", arguments: { id: "abc123" } });
    expect(done.structuredContent).toMatchObject({ view: "item", item: { status: "completed" } });
    await client.callTool({ name: "reopen_todo", arguments: { id: "abc123" } });
    expect(calls.map((c) => [c.op, c.args.status])).toEqual([
      ["setStatus", "completed"],
      ["setStatus", "open"],
    ]);
  });

  it("turns Things errors into readable tool errors", async () => {
    const { client } = await connect(() => {
      throw bridgeError("Not authorized to send Apple events to Things3.", -1743);
    });
    const res = await client.callTool({ name: "show_list", arguments: { list: "inbox" } });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/Automation/);
  });
});
