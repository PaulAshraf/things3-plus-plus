import { describe, expect, it } from "vitest";
import { ThingsIndex, todayIn } from "../src/model/queries.js";
import { applyPatch, diffSnapshots } from "../src/model/types.js";
import { snapshot, task, TODAY } from "./model-fixtures.js";

function build() {
  const tasks = [
    task({ id: "p1", kind: "project", title: "Launch", areaId: "a-work" }),
    task({ id: "p-some", kind: "project", title: "Maybe", start: "someday" }),
    task({ id: "h1", kind: "heading", title: "Design", projectId: "p1" }),
    task({ id: "inbox1", title: "Inbox thing", start: "inbox" }),
    task({ id: "today1", title: "Today thing", when: TODAY, todayIndex: 2 }),
    task({ id: "eve1", title: "Evening thing", when: TODAY, evening: true }),
    task({ id: "over1", title: "Overdue deadline", deadline: "2026-11-20", areaId: "a-home" }),
    task({ id: "fut1", title: "Next week", when: "2026-11-29", start: "someday" }),
    task({ id: "inproj", title: "In heading", headingId: "h1" }),
    task({ id: "loose", title: "Loose in project", projectId: "p1" }),
    task({ id: "some1", title: "Someday thing", start: "someday" }),
    task({ id: "somechild", title: "Child of someday project", projectId: "p-some", start: "anytime" }),
    task({ id: "done1", title: "Done", status: "completed", completedAt: "2026-11-21T09:00:00.000Z", projectId: "p1" }),
    task({ id: "trash1", title: "Trashed", trashed: true }),
    task({ id: "tagged", title: "Errand", tags: ["tag-errand"], areaId: "a-home" }),
  ];
  return new ThingsIndex(snapshot(tasks), TODAY);
}

describe("ThingsIndex", () => {
  it("puts scheduled and overdue items in Today, split into day and evening", () => {
    const t = build().todayList();
    expect(t.day.map((x) => x.id)).toEqual(expect.arrayContaining(["today1", "over1"]));
    expect(t.evening.map((x) => x.id)).toEqual(["eve1"]);
  });

  it("keeps Inbox to unscheduled inbox to-dos", () => {
    expect(build().inbox().map((t) => t.id)).toEqual(["inbox1"]);
  });

  it("groups Upcoming by day", () => {
    const up = build().upcoming();
    expect(up).toEqual([{ day: "2026-11-29", tasks: [expect.objectContaining({ id: "fut1" })] }]);
  });

  it("groups Anytime by area and project without listing projects as rows", () => {
    const groups = build().anytime();
    const ids = groups.flatMap((g) => [...g.tasks, ...(g.children ?? []).flatMap((c) => c.tasks)]).map((t) => t.id);
    expect(ids).toContain("inproj");
    expect(ids).toContain("today1");
    expect(ids).not.toContain("p1");
    expect(ids).not.toContain("somechild"); // its project is someday
    expect(ids).not.toContain("fut1");
    const work = groups.find((g) => g.kind === "area" && g.id === "a-work");
    expect(work?.children?.[0]?.id).toBe("p1");
  });

  it("lists someday projects but hides their children", () => {
    const ids = build()
      .someday()
      .flatMap((g) => g.tasks)
      .map((t) => t.id);
    expect(ids).toEqual(expect.arrayContaining(["some1", "p-some"]));
    expect(ids).not.toContain("somechild");
  });

  it("builds a project view with headings and logged items", () => {
    const v = build().project("p1")!;
    expect(v.loose.map((t) => t.id)).toEqual(["loose"]);
    expect(v.headings[0]!.heading.id).toBe("h1");
    expect(v.headings[0]!.tasks.map((t) => t.id)).toEqual(["inproj"]);
    expect(v.logged.map((t) => t.id)).toEqual(["done1"]);
    expect(build().progress("p1")).toEqual({ done: 1, total: 3 });
  });

  it("finds items through headings for their project and area", () => {
    const ix = build();
    expect(ix.projectIdOf(ix.task("inproj")!)).toBe("p1");
    expect(ix.areaIdOf(ix.task("inproj")!)).toBe("a-work");
  });

  it("keeps the Logbook and Trash apart", () => {
    const ix = build();
    expect(ix.logbook().flatMap((g) => g.tasks).map((t) => t.id)).toEqual(["done1"]);
    expect(ix.trash().map((t) => t.id)).toEqual(["trash1"]);
  });

  it("searches titles, notes and checklists", () => {
    expect(build().search("evening").map((t) => t.id)).toEqual(["eve1"]);
    expect(build().search("done").length).toBe(0);
    expect(build().search("done", { includeCompleted: true }).map((t) => t.id)).toEqual(["done1"]);
  });

  it("counts badges", () => {
    expect(build().counts()).toEqual({ inbox: 1, today: 3, overdue: 1 });
  });

  it("maps tasks to the MCP shape with names", () => {
    const ix = build();
    expect(ix.toTodo(ix.task("inproj")!)).toMatchObject({ project: { id: "p1", name: "Launch" }, kind: "todo" });
    expect(ix.toTodo(ix.task("tagged")!)).toMatchObject({ tags: ["Errand"], area: { id: "a-home", name: "Home" } });
  });

  it("computes today in a time zone", () => {
    expect(todayIn("Pacific/Kiritimati", new Date("2026-11-22T11:00:00Z"))).toBe("2026-11-23");
    expect(todayIn("Not/AZone", new Date())).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("snapshot patches", () => {
  it("round-trips a diff", () => {
    const a = snapshot([task({ id: "x", title: "A" }), task({ id: "y", title: "B" })]);
    const b = { ...snapshot([task({ id: "x", title: "A2" }), task({ id: "z", title: "C" })]), rev: 2 };
    const patch = diffSnapshots(a, b)!;
    expect(patch.remove.tasks).toEqual(["y"]);
    expect(patch.upsert.tasks.map((t) => t.id).sort()).toEqual(["x", "z"]);
    const applied = applyPatch(a, patch);
    expect(applied.tasks.map((t) => t.title).sort()).toEqual(["A2", "C"]);
    expect(applied.rev).toBe(2);
  });

  it("returns null when nothing changed and refuses out-of-order patches", () => {
    const a = snapshot([task({ id: "x", title: "A" })]);
    expect(diffSnapshots(a, { ...a, rev: 5 })).toBeNull();
    const patch = diffSnapshots(a, { ...a, rev: 2, tasks: [] })!;
    expect(() => applyPatch({ ...a, rev: 9 }, patch)).toThrow(/doesn't match/);
  });
});
