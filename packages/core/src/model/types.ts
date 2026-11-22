// The full picture of a user's Things database, as read from its SQLite file on the Mac.
// The Mac sends this to the hosted Worker; the web app and remote MCP tools compute every list from it.
// Pure data, no Node or DOM APIs, so it runs on the Mac, in the Worker, and in the browser.

import type { Status } from "../things/types.js";

export type Start = "inbox" | "anytime" | "someday";
export type TaskKind = "todo" | "project" | "heading";

export interface ChecklistItem {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  kind: TaskKind;
  title: string;
  notes: string;
  status: Status;
  /** Which built-in list it belongs to before dates are considered. */
  start: Start;
  /** Scheduled ("When") day, local YYYY-MM-DD. */
  when: string | null;
  /** In the "This Evening" part of Today. */
  evening: boolean;
  deadline: string | null;
  /** Reminder time, "HH:MM" local. */
  reminder: string | null;
  areaId: string | null;
  projectId: string | null;
  headingId: string | null;
  /** Tag ids. */
  tags: string[];
  checklist: ChecklistItem[];
  /** Manual order inside its list/project/heading. */
  index: number;
  /** Manual order inside Today. */
  todayIndex: number;
  /** Created from a repeating template. */
  repeating: boolean;
  trashed: boolean;
  createdAt: string | null;
  modifiedAt: string | null;
  completedAt: string | null;
}

export interface Area {
  id: string;
  title: string;
  index: number;
  tags: string[];
}

export interface Tag {
  id: string;
  title: string;
  parentId: string | null;
  shortcut: string | null;
  index: number;
}

export interface Snapshot {
  /** Increases with every change the Mac sends. */
  rev: number;
  generatedAt: string;
  /** The Mac's IANA time zone; "today" is computed in it. */
  timeZone: string;
  tasks: Task[];
  areas: Area[];
  tags: Tag[];
  /**
   * urlScheme: the Mac can edit checklists / This Evening / headings ("Enable Things URLs").
   * database: read from the Things database (full detail). false = basic mode via AppleScript:
   * no checklists, headings or This Evening, until the agent gets access to Things' data.
   */
  capabilities: { urlScheme: boolean; database?: boolean };
}

/** Changes since `baseRev`. Entities are replaced whole. */
export interface SnapshotPatch {
  rev: number;
  baseRev: number;
  generatedAt: string;
  timeZone: string;
  capabilities: Snapshot["capabilities"];
  upsert: { tasks: Task[]; areas: Area[]; tags: Tag[] };
  remove: { tasks: string[]; areas: string[]; tags: string[] };
}

export function emptySnapshot(): Snapshot {
  return { rev: 0, generatedAt: new Date(0).toISOString(), timeZone: "UTC", tasks: [], areas: [], tags: [], capabilities: { urlScheme: false } };
}

function byId<T extends { id: string }>(list: T[]): Map<string, T> {
  return new Map(list.map((x) => [x.id, x]));
}

function diffList<T extends { id: string }>(prev: T[], next: T[]): { upsert: T[]; remove: string[] } {
  const before = new Map(prev.map((x) => [x.id, JSON.stringify(x)]));
  const upsert = next.filter((x) => before.get(x.id) !== JSON.stringify(x));
  const nextIds = new Set(next.map((x) => x.id));
  const remove = prev.filter((x) => !nextIds.has(x.id)).map((x) => x.id);
  return { upsert, remove };
}

/** What changed between two snapshots, or null if nothing did. */
export function diffSnapshots(prev: Snapshot, next: Snapshot): SnapshotPatch | null {
  const tasks = diffList(prev.tasks, next.tasks);
  const areas = diffList(prev.areas, next.areas);
  const tags = diffList(prev.tags, next.tags);
  const metaChanged =
    prev.timeZone !== next.timeZone ||
    prev.capabilities.urlScheme !== next.capabilities.urlScheme ||
    prev.capabilities.database !== next.capabilities.database;
  const empty =
    !metaChanged &&
    tasks.upsert.length + tasks.remove.length + areas.upsert.length + areas.remove.length + tags.upsert.length + tags.remove.length === 0;
  if (empty) return null;
  return {
    rev: next.rev,
    baseRev: prev.rev,
    generatedAt: next.generatedAt,
    timeZone: next.timeZone,
    capabilities: next.capabilities,
    upsert: { tasks: tasks.upsert, areas: areas.upsert, tags: tags.upsert },
    remove: { tasks: tasks.remove, areas: areas.remove, tags: tags.remove },
  };
}

function applyList<T extends { id: string }>(list: T[], upsert: T[], remove: string[]): T[] {
  const map = byId(list);
  for (const id of remove) map.delete(id);
  for (const x of upsert) map.set(x.id, x);
  return [...map.values()];
}

/** Applies a patch. Throws if it doesn't follow on from this snapshot (ask for a full one instead). */
export function applyPatch(snap: Snapshot, patch: SnapshotPatch): Snapshot {
  if (patch.baseRev !== snap.rev) throw new Error(`Patch base ${patch.baseRev} doesn't match snapshot rev ${snap.rev}`);
  return {
    rev: patch.rev,
    generatedAt: patch.generatedAt,
    timeZone: patch.timeZone,
    capabilities: patch.capabilities,
    tasks: applyList(snap.tasks, patch.upsert.tasks, patch.remove.tasks),
    areas: applyList(snap.areas, patch.upsert.areas, patch.remove.areas),
    tags: applyList(snap.tags, patch.upsert.tags, patch.remove.tags),
  };
}
