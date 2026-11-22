import { describe, expect, it } from "vitest";
import { snapshotFromAppleScript } from "../src/things/applescript-snapshot.js";
import type { RawAppleScriptItem, RawAppleScriptSnapshot } from "../src/things/client.js";
import { ThingsIndex } from "../src/model/queries.js";

const item = (p: Partial<RawAppleScriptItem> & { id: string }): RawAppleScriptItem => ({
  kind: "todo",
  title: p.id,
  notes: "",
  status: "open",
  when: null,
  deadline: null,
  tagNames: [],
  createdAt: null,
  modifiedAt: null,
  completedAt: null,
  projectId: null,
  areaId: null,
  ...p,
});

const raw: RawAppleScriptSnapshot = {
  items: [
    item({ id: "in1" }),
    item({ id: "t2", when: "2026-11-22", tagNames: ["Errand"] }),
    item({ id: "t1", when: "2026-11-22", projectId: "p1" }),
    item({ id: "up", when: "2026-11-30" }),
    item({ id: "sd" }),
    item({ id: "p1", kind: "project", areaId: "a1" }),
  ],
  logbook: [item({ id: "done", status: "completed", completedAt: "2026-11-21T08:00:00.000Z" })],
  lists: { inbox: ["in1"], today: ["t1", "t2"], upcoming: ["up"], anytime: ["t1", "t2", "p1"], someday: ["sd"], trash: [] },
  areas: [{ id: "a1", title: "Work" }],
  tags: [{ id: "g1", title: "Errand", parentId: null }],
};

describe("basic mode (AppleScript snapshot)", () => {
  it("maps lists, order, tags and containers", () => {
    const { snapshot, logbook } = snapshotFromAppleScript(raw, { timeZone: "UTC" });
    expect(snapshot.capabilities).toEqual({ urlScheme: false, database: false });
    const by = new Map(snapshot.tasks.map((t) => [t.id, t]));
    expect(by.get("in1")!.start).toBe("inbox");
    expect(by.get("sd")!.start).toBe("someday");
    expect(by.get("up")!.start).toBe("someday");
    expect(by.get("t2")!.tags).toEqual(["g1"]);
    expect(by.get("t1")!.todayIndex).toBeLessThan(by.get("t2")!.todayIndex);
    expect(logbook.map((t) => t.id)).toEqual(["done"]);

    const ix = new ThingsIndex(snapshot, "2026-11-22");
    expect(ix.inbox().map((t) => t.id)).toEqual(["in1"]);
    expect(ix.todayList().day.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(ix.upcoming()[0]!.day).toBe("2026-11-30");
    expect(ix.someday().flatMap((g) => g.tasks).map((t) => t.id)).toContain("sd");
    expect(ix.project("p1")!.loose.map((t) => t.id)).toEqual(["t1"]);
    expect(ix.logbook().flatMap((g) => g.tasks).map((t) => t.id)).toEqual(["done"]);
  });

  it("reuses the previous Logbook when it wasn't re-read", () => {
    const first = snapshotFromAppleScript(raw);
    const second = snapshotFromAppleScript({ ...raw, logbook: null }, { previousLogbook: first.logbook });
    expect(second.snapshot.tasks.some((t) => t.id === "done")).toBe(true);
  });
});
