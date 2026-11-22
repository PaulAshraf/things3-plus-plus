// Basic mode: build a Snapshot from AppleScript alone, for when the Things database can't be read
// (the agent hasn't been given access to Things' data). Node only.
//
// What's missing compared with the database: checklists, headings, This Evening, reminders and
// repeating flags. Order comes from each list's display order.

import type { Area, Snapshot, Tag, Task } from "../model/types.js";
import type { RawAppleScriptItem, RawAppleScriptSnapshot, ThingsClient } from "./client.js";

export interface AppleScriptReadOptions {
  /** Also read the Logbook (slow on big databases); otherwise `previousLogbook` is reused. */
  readLogbook: boolean;
  previousLogbook?: Task[];
  logbookLimit?: number;
  timeZone?: string;
}

function toTask(r: RawAppleScriptItem, tagIdByName: Map<string, string>, extra: Partial<Task>): Task {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    notes: r.notes,
    status: r.status,
    start: "anytime",
    when: r.when,
    evening: false,
    deadline: r.deadline,
    reminder: null,
    areaId: r.areaId ?? null,
    projectId: r.projectId ?? null,
    headingId: null,
    tags: r.tagNames.map((n) => tagIdByName.get(n)).filter((x): x is string => Boolean(x)),
    checklist: [],
    index: 0,
    todayIndex: 0,
    repeating: false,
    trashed: false,
    createdAt: r.createdAt,
    modifiedAt: r.modifiedAt,
    completedAt: r.status === "open" ? null : r.completedAt,
    ...extra,
  };
}

/** Turns the bridge's raw output into a Snapshot. Pure, so it's unit-tested without Things. */
export function snapshotFromAppleScript(raw: RawAppleScriptSnapshot, opts: { previousLogbook?: Task[]; timeZone?: string } = {}): { snapshot: Snapshot; logbook: Task[] } {
  const tags: Tag[] = raw.tags.map((t, i) => ({ id: t.id, title: t.title, parentId: t.parentId, shortcut: null, index: i }));
  const tagIdByName = new Map(tags.map((t) => [t.title, t.id]));
  const areas: Area[] = raw.areas.map((a, i) => ({ id: a.id, title: a.title, index: i, tags: [] }));
  const position = (key: keyof RawAppleScriptSnapshot["lists"]) => new Map(raw.lists[key].map((id, i) => [id, i]));
  const inbox = position("inbox");
  const today = position("today");
  const upcoming = position("upcoming");
  const anytime = position("anytime");
  const someday = position("someday");

  const tasks: Task[] = raw.items.map((r, i) => {
    const start: Task["start"] = inbox.has(r.id) ? "inbox" : someday.has(r.id) || upcoming.has(r.id) ? "someday" : "anytime";
    const index = inbox.get(r.id) ?? anytime.get(r.id) ?? someday.get(r.id) ?? upcoming.get(r.id) ?? 10_000 + i;
    return toTask(r, tagIdByName, { start, index, todayIndex: today.get(r.id) ?? 10_000 + i });
  });
  const open = new Set(tasks.map((t) => t.id));
  const logbook = raw.logbook
    ? raw.logbook.filter((r) => !open.has(r.id)).map((r, i) => toTask(r, tagIdByName, { index: i }))
    : (opts.previousLogbook ?? []).filter((t) => !open.has(t.id));

  return {
    snapshot: {
      rev: 0,
      generatedAt: new Date().toISOString(),
      timeZone: opts.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      tasks: [...tasks, ...logbook],
      areas,
      tags,
      capabilities: { urlScheme: false, database: false },
    },
    logbook,
  };
}

export async function readSnapshotViaAppleScript(client: ThingsClient, opts: AppleScriptReadOptions): Promise<{ snapshot: Snapshot; logbook: Task[] }> {
  const raw = await client.snapshotRaw({ logbook: opts.readLogbook, logbookLimit: opts.logbookLimit ?? 500 });
  return snapshotFromAppleScript(raw, opts);
}
