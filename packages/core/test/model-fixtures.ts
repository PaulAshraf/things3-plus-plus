import type { Snapshot, Task } from "../src/model/types.js";

let n = 0;
export function task(p: Partial<Task> & { title: string }): Task {
  n++;
  return {
    id: p.id ?? `t${n}`,
    kind: "todo",
    notes: "",
    status: "open",
    start: "anytime",
    when: null,
    evening: false,
    deadline: null,
    reminder: null,
    areaId: null,
    projectId: null,
    headingId: null,
    tags: [],
    checklist: [],
    index: n,
    todayIndex: n,
    repeating: false,
    trashed: false,
    createdAt: null,
    modifiedAt: null,
    completedAt: null,
    ...p,
  };
}

export const TODAY = "2026-11-22";

export function snapshot(tasks: Task[], extra: Partial<Snapshot> = {}): Snapshot {
  return {
    rev: 1,
    generatedAt: "2026-11-22T10:00:00.000Z",
    timeZone: "Europe/Berlin",
    tasks,
    areas: [
      { id: "a-home", title: "Home", index: 1, tags: [] },
      { id: "a-work", title: "Work", index: 2, tags: [] },
    ],
    tags: [{ id: "tag-errand", title: "Errand", parentId: null, shortcut: null, index: 1 }],
    capabilities: { urlScheme: true },
    ...extra,
  };
}
