import { describe, expect, it } from "vitest";
import { SnapshotThingsApi } from "../src/model/snapshot-api.js";
import type { Action } from "../src/relay/protocol.js";
import { snapshot, task } from "./model-fixtures.js";

describe("SnapshotThingsApi (hosted MCP)", () => {
  const snap = snapshot([
    task({ id: "p1", kind: "project", title: "Launch" }),
    task({ id: "x", title: "Write copy", projectId: "p1" }),
    task({ id: "i", title: "Inbox item", start: "inbox" }),
  ]);
  const sent: Action[] = [];
  const api = new SnapshotThingsApi({
    snapshot: async () => snap,
    send: async (a) => {
      sent.push(a);
      return { ok: true, id: "x", data: { id: "x", title: "Changed" } };
    },
  });

  it("reads lists and projects (by name) from the snapshot", async () => {
    expect((await api.list("inbox")).items.map((t) => t.id)).toEqual(["i"]);
    const p = await api.project("Launch");
    expect(p.container.id).toBe("p1");
    expect(p.items.map((t) => t.id)).toEqual(["x"]);
    await expect(api.project("Nope")).rejects.toThrow(/No project/);
  });

  it("sends writes to the Mac", async () => {
    const res = await api.setStatus("x", "completed");
    expect(sent.at(-1)).toEqual({ op: "setStatus", args: { id: "x", status: "completed" } });
    expect(res.title).toBe("Changed");
  });
});
