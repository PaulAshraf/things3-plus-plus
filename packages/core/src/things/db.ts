// Reads the Things database (SQLite) read-only, for the full picture AppleScript can't give:
// checklists, headings, This Evening, manual order, reminders. Node only (macOS).
//
// macOS protects the database: the app running this needs Full Disk Access.
// SECURITY: queries are static SQL built only from constants below (never from input), and the
// database is opened read-only. Writes always go through Things itself (AppleScript / URL scheme).

import { execFile } from "node:child_process";
import { existsSync, readdirSync, watch, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Area, ChecklistItem, Snapshot, Start, Tag, Task, TaskKind } from "../model/types.js";
import type { Status } from "./types.js";

export class DatabaseError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "no_access" | "read_failed",
  ) {
    super(message);
    this.name = "DatabaseError";
  }
}

const CONTAINER = "Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac";
const DB_DIR = "Things Database.thingsdatabase";

export const FULL_DISK_ACCESS_HELP =
  "macOS is blocking access to the Things database. Open System Settings → Privacy & Security → Full Disk Access and turn it on for the app running things3pp (Terminal, iTerm, or node for the background agent), then try again.";

/** Path to main.sqlite, or throws a DatabaseError explaining what's wrong. */
export function findThingsDatabase(home = homedir()): string {
  const container = join(home, CONTAINER);
  let entries: string[];
  try {
    entries = readdirSync(container);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") throw new DatabaseError(FULL_DISK_ACCESS_HELP, "no_access");
    throw new DatabaseError("Couldn't find the Things database. Is Things 3 installed and opened at least once?", "not_found");
  }
  const candidates = [
    ...entries.filter((e) => e.startsWith("ThingsData-")).map((e) => join(container, e, DB_DIR, "main.sqlite")),
    join(container, DB_DIR, "main.sqlite"),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new DatabaseError("Couldn't find the Things database. Is Things 3 installed and opened at least once?", "not_found");
  return found;
}

// ----- low-level -----

export type SqlRunner = (dbPath: string, sql: string) => Promise<string>;

export const sqliteCliRunner: SqlRunner = (dbPath, sql) =>
  new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/sqlite3",
      ["-readonly", "-noheader", "-list", "-bail", dbPath, sql],
      { timeout: 20_000, maxBuffer: 256 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          const msg = String(stderr || err.message);
          if (/authori[sz]ation denied|operation not permitted|unable to open/i.test(msg)) {
            reject(new DatabaseError(FULL_DISK_ACCESS_HELP, "no_access"));
          } else reject(new DatabaseError(`Couldn't read the Things database: ${msg.trim()}`, "read_failed"));
          return;
        }
        resolve(stdout);
      },
    );
  });

// ----- decoding -----

/** Things packs days as year<<16 | month<<12 | day<<7. */
export function unpackDay(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  const y = v >> 16;
  const m = (v >> 12) & 0xf;
  const d = (v >> 7) & 0x1f;
  if (!y || !m || !d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Things packs reminder times as hour<<26 | minute<<20. */
export function unpackTime(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  const h = v >> 26;
  const m = (v >> 20) & 0x3f;
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function unixToIso(v: unknown): string | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return new Date(v * 1000).toISOString();
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
/** Older Things versions wrap notes in <note xml:space="preserve">…</note>. */
export function cleanNotes(v: unknown): string {
  if (typeof v !== "string") return "";
  if (!v.startsWith("<note")) return v;
  return v
    .replace(/^<note[^>]*>/, "")
    .replace(/<\/note>\s*$/, "")
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e] ?? _);
}

const STATUS: Record<number, Status> = { 0: "open", 2: "canceled", 3: "completed" };
const START: Record<number, Start> = { 0: "inbox", 1: "anytime", 2: "someday" };
const KIND: Record<number, TaskKind> = { 0: "todo", 1: "project", 2: "heading" };

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

// ----- queries -----

// Columns we read from TMTask, in order. Any missing in this Things version are read as NULL.
const TASK_COLS = [
  "uuid", "type", "status", "trashed", "title", "notes", "start", "startDate", "startBucket", "deadline",
  "reminderTime", "area", "project", "heading", "index", "todayIndex", "rt1_repeatingTemplate",
  "creationDate", "userModificationDate", "stopDate",
] as const;
const TEXT_COLS = new Set(["uuid", "title", "notes", "area", "project", "heading", "rt1_repeatingTemplate"]);

// Open items, every project and heading, the latest 1000 finished items, and the latest 200 trashed.
const TASK_FILTER = `rt1_recurrenceRule IS NULL AND (
  (trashed = 0 AND status = 0)
  OR (trashed = 0 AND type IN (1, 2))
  OR uuid IN (SELECT uuid FROM TMTask WHERE trashed = 0 AND status != 0 AND rt1_recurrenceRule IS NULL ORDER BY stopDate DESC LIMIT 1000)
  OR uuid IN (SELECT uuid FROM TMTask WHERE trashed = 1 AND rt1_recurrenceRule IS NULL ORDER BY userModificationDate DESC LIMIT 200)
)`;

function colExpr(name: string, present: Set<string>): string {
  if (!present.has(name)) return "NULL";
  const quoted = `"${name}"`;
  return TEXT_COLS.has(name) ? `CAST(${quoted} AS TEXT)` : quoted;
}

async function columnsOf(run: SqlRunner, dbPath: string, table: string): Promise<Set<string>> {
  // Table names here are constants from this file.
  const out = await run(dbPath, `SELECT json_group_array(name) FROM pragma_table_info('${table}');`);
  return new Set(JSON.parse(out.trim() || "[]") as string[]);
}

export interface ReadOptions {
  run?: SqlRunner;
  timeZone?: string;
}

/** Reads everything the web app needs. `rev` is left at 0; the caller numbers snapshots. */
export async function readSnapshot(dbPath: string, opts: ReadOptions = {}): Promise<Snapshot> {
  const run = opts.run ?? sqliteCliRunner;
  const cols = await columnsOf(run, dbPath, "TMTask");
  if (!cols.has("uuid")) throw new DatabaseError("This doesn't look like a Things database.", "read_failed");

  const filter = cols.has("rt1_recurrenceRule") ? TASK_FILTER : TASK_FILTER.replace(/rt1_recurrenceRule IS NULL AND /g, "");
  const sql = [
    `SELECT json_group_array(json_array(${TASK_COLS.map((c) => colExpr(c, cols)).join(", ")})) FROM TMTask WHERE ${filter};`,
    `SELECT json_group_array(json_array(CAST(uuid AS TEXT), CAST(task AS TEXT), CAST(title AS TEXT), status, "index")) FROM TMChecklistItem WHERE task IN (SELECT uuid FROM TMTask WHERE trashed = 0 AND status = 0);`,
    `SELECT json_group_array(json_array(CAST(tasks AS TEXT), CAST(tags AS TEXT))) FROM TMTaskTag;`,
    `SELECT json_group_array(json_array(CAST(uuid AS TEXT), CAST(title AS TEXT), "index")) FROM TMArea;`,
    `SELECT json_group_array(json_array(CAST(areas AS TEXT), CAST(tags AS TEXT))) FROM TMAreaTag;`,
    `SELECT json_group_array(json_array(CAST(uuid AS TEXT), CAST(title AS TEXT), CAST(parent AS TEXT), CAST(shortcut AS TEXT), "index")) FROM TMTag;`,
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM TMSettings WHERE uriSchemeAuthenticationToken IS NOT NULL AND uriSchemeAuthenticationToken != '') THEN 1 ELSE 0 END;`,
  ].join("\n");

  const lines = (await run(dbPath, sql)).split("\n").filter((l) => l.length > 0);
  if (lines.length < 7) throw new DatabaseError("Unexpected output while reading the Things database.", "read_failed");
  const [taskRows, checkRows, taskTagRows, areaRows, areaTagRows, tagRows] = lines.slice(0, 6).map((l) => JSON.parse(l) as unknown[][]) as [
    unknown[][], unknown[][], unknown[][], unknown[][], unknown[][], unknown[][],
  ];
  const urlScheme = lines[6]?.trim() === "1";

  const checklists = new Map<string, (ChecklistItem & { index: number })[]>();
  for (const [uuid, task, title, status, index] of checkRows) {
    const key = String(task);
    const list = checklists.get(key) ?? [];
    list.push({ id: String(uuid), title: String(title ?? ""), done: num(status) !== 0, index: num(index) });
    checklists.set(key, list);
  }
  const tagsOf = new Map<string, string[]>();
  for (const [task, tag] of taskTagRows) {
    const list = tagsOf.get(String(task)) ?? [];
    list.push(String(tag));
    tagsOf.set(String(task), list);
  }
  const areaTags = new Map<string, string[]>();
  for (const [area, tag] of areaTagRows) {
    const list = areaTags.get(String(area)) ?? [];
    list.push(String(tag));
    areaTags.set(String(area), list);
  }

  const tasks: Task[] = taskRows.map((r) => {
    const row = Object.fromEntries(TASK_COLS.map((c, i) => [c, r[i]])) as Record<(typeof TASK_COLS)[number], unknown>;
    const id = String(row.uuid);
    const status = STATUS[num(row.status)] ?? "open";
    return {
      id,
      kind: KIND[num(row.type)] ?? "todo",
      title: String(row.title ?? ""),
      notes: cleanNotes(row.notes),
      status,
      start: START[num(row.start)] ?? "anytime",
      when: unpackDay(row.startDate),
      evening: num(row.startBucket) === 1,
      deadline: unpackDay(row.deadline),
      reminder: unpackTime(row.reminderTime),
      areaId: str(row.area),
      projectId: str(row.project),
      headingId: str(row.heading),
      tags: tagsOf.get(id) ?? [],
      checklist: (checklists.get(id) ?? []).sort((a, b) => a.index - b.index).map(({ id, title, done }) => ({ id, title, done })),
      index: num(row.index),
      todayIndex: num(row.todayIndex),
      repeating: str(row.rt1_repeatingTemplate) !== null,
      trashed: num(row.trashed) === 1,
      createdAt: unixToIso(row.creationDate),
      modifiedAt: unixToIso(row.userModificationDate),
      completedAt: status === "open" ? null : unixToIso(row.stopDate),
    };
  });

  const areas: Area[] = areaRows.map(([uuid, title, index]) => ({
    id: String(uuid),
    title: String(title ?? ""),
    index: num(index),
    tags: areaTags.get(String(uuid)) ?? [],
  }));
  const tags: Tag[] = tagRows.map(([uuid, title, parent, shortcut, index]) => ({
    id: String(uuid),
    title: String(title ?? ""),
    parentId: str(parent),
    shortcut: str(shortcut),
    index: num(index),
  }));

  return {
    rev: 0,
    generatedAt: new Date().toISOString(),
    timeZone: opts.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    tasks,
    areas,
    tags,
    capabilities: { urlScheme, database: true },
  };
}

/** The URL-scheme auth token. Stays on this Mac: never put it in a snapshot or send it anywhere. */
export async function readUrlSchemeToken(dbPath: string, run: SqlRunner = sqliteCliRunner): Promise<string | null> {
  const out = await run(dbPath, `SELECT CAST(uriSchemeAuthenticationToken AS TEXT) FROM TMSettings LIMIT 1;`);
  const token = out.trim();
  return token ? token : null;
}

/** Calls `onChange` (debounced) whenever Things writes to its database. */
export function watchDatabase(dbPath: string, onChange: () => void, debounceMs = 250): { close(): void } {
  let timer: NodeJS.Timeout | undefined;
  let watcher: FSWatcher | undefined;
  const fire = () => {
    clearTimeout(timer);
    timer = setTimeout(onChange, debounceMs);
  };
  try {
    watcher = watch(dirname(dbPath), (_event, file) => {
      if (!file || String(file).startsWith("main.sqlite")) fire();
    });
  } catch {
    // Watching can fail (permissions); callers also poll.
  }
  return {
    close() {
      clearTimeout(timer);
      watcher?.close();
    },
  };
}
