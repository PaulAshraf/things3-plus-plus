import { describe, expect, it } from "vitest";
import { MacActions } from "../src/things/actions.js";
import { ThingsClient } from "../src/things/client.js";
import { ActionSchema } from "../src/relay/protocol.js";
import { fakeRunner, todo } from "./fixtures.js";

function setup(token: string | null = "tok") {
  const fake = fakeRunner((op, args) => {
    if (op === "addTodo") return todo({ id: "new1", title: String(args.title) });
    return todo({ id: String(args.id ?? "x") });
  });
  const opened: string[] = [];
  const actions = new MacActions(new ThingsClient(fake.runner), { token: async () => token, open: async (u) => void opened.push(u) });
  const json = (i = 0) => JSON.parse(new URL(opened[i]!).searchParams.get("data")!) as { id: string; attributes: Record<string, unknown> }[];
  return { fake, opened, actions, json };
}

describe("relay actions", () => {
  it("has no delete or trash action", () => {
    const ops = ActionSchema.options.map((o) => o.shape.op.value);
    expect(ops).not.toContain("trash");
    expect(ops.some((o) => /delete|trash|empty/i.test(o))).toBe(false);
  });

  it("rejects anything that isn't a valid action", async () => {
    const { actions, fake } = setup();
    expect(await actions.run({ op: "trash", args: { id: "x" } })).toMatchObject({ ok: false, code: "invalid" });
    expect(await actions.run({ op: "update", args: { id: "x", when: "next tuesday" } })).toMatchObject({ ok: false });
    expect(fake.calls).toHaveLength(0);
  });

  it("creates with AppleScript, then sets evening and checklist via the URL scheme", async () => {
    const { actions, fake, opened, json } = setup();
    const res = await actions.run({ op: "addTodo", args: { title: "Read", evening: true, checklist: ["a", "b"] } });
    expect(res).toMatchObject({ ok: true, id: "new1" });
    expect(fake.calls[0]).toMatchObject({ op: "addTodo", args: { title: "Read", when: "today" } });
    expect(opened[0]).toMatch(/^things:\/\/\/json\?auth-token=tok&data=/);
    expect(json()[0]).toMatchObject({ id: "new1", attributes: { when: "evening", "checklist-items": [{ attributes: { title: "a" } }, { attributes: { title: "b" } }] } });
  });

  it("explains how to enable Things URLs when they're off", async () => {
    const { actions } = setup(null);
    const res = await actions.run({ op: "setChecklist", args: { id: "x", items: [{ title: "a", done: true }] } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/Enable Things URLs/);
  });

  it("moves an item out of This Evening through the URL scheme", async () => {
    const { actions, fake, json } = setup();
    expect(await actions.run({ op: "update", args: { id: "x", evening: false } })).toMatchObject({ ok: true });
    expect(fake.calls).toHaveLength(0);
    expect(json()[0]).toMatchObject({ id: "x", attributes: { when: "today" } });
  });

  it("sends plain edits through AppleScript only", async () => {
    const { actions, fake, opened } = setup();
    await actions.run({ op: "update", args: { id: "x", title: "New", when: "2026-12-01" } });
    expect(fake.calls[0]).toMatchObject({ op: "update", args: { id: "x", title: "New", when: "2026-12-01" } });
    expect(opened).toHaveLength(0);
  });
});
