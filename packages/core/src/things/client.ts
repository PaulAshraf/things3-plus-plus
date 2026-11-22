import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ThingsError, toThingsError } from "./errors.js";
export { ThingsError, type ThingsErrorCode } from "./errors.js";
import type {
  AreaSummary,
  ListName,
  NewProject,
  NewTodo,
  ProjectSummary,
  Status,
  Ref,
  TagSummary,
  ThingsApi,
  Todo,
  TodoPage,
  TodoUpdate,
} from "./types.js";

export interface ScriptRequest {
  language: "JavaScript" | "AppleScript";
  /** A static script shipped with this package. Never built from input. */
  script: string;
  /** Data for the script's run handler. */
  args: string[];
}

/** Runs a script with osascript and returns raw stdout. Swappable for tests. */
export type Runner = (req: ScriptRequest) => Promise<string>;

const scripts = new Map<string, string>();
function shippedScript(file: "things.jxa.js" | "move.applescript"): string {
  let s = scripts.get(file);
  if (s === undefined) {
    // Next to this module when running from source; under ./things/ once bundled into a CLI's dist.
    const candidates = [new URL(`./${file}`, import.meta.url), new URL(`./things/${file}`, import.meta.url)].map((u) => fileURLToPath(u));
    const path = candidates.find((c) => existsSync(c));
    if (!path) throw new ThingsError(`Missing bundled script ${file}. Try reinstalling things3pp.`, "things_error");
    s = readFileSync(path, "utf8");
    scripts.set(file, s);
  }
  return s;
}

const LIST_IDS = { inbox: "TMInboxListSource", anytime: "TMNextListSource", someday: "TMSomedayListSource" } as const;
type ListMove = keyof typeof LIST_IDS;
function isListMove(when: string | undefined): when is ListMove {
  return when === "inbox" || when === "anytime" || when === "someday";
}

const TIMEOUT_MS = 30_000;

export const osascriptRunner: Runner = ({ language, script, args }) =>
  new Promise((resolve, reject) => {
    if (process.platform !== "darwin") {
      reject(new ThingsError("Things 3 is only available on macOS.", "unsupported_platform"));
      return;
    }
    // Script and data are separate argv entries: user input is never parsed as code.
    execFile(
      "/usr/bin/osascript",
      ["-l", language, "-e", script, ...args],
      { timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          if ((err as NodeJS.ErrnoException & { killed?: boolean }).killed) {
            reject(
              new ThingsError(
                "Things didn't respond in time. If macOS is showing a permission prompt, click OK and try again.",
                "timeout",
              ),
            );
            return;
          }
          reject(toThingsError(String(stderr || err.message), null));
          return;
        }
        resolve(stdout);
      },
    );
  });

interface BridgeResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
  errorNumber?: number | null;
}

export interface RawAppleScriptItem {
  id: string;
  kind: "todo" | "project";
  title: string;
  notes: string;
  status: Status;
  when: string | null;
  deadline: string | null;
  tagNames: string[];
  createdAt: string | null;
  modifiedAt: string | null;
  completedAt: string | null;
  projectId?: string | null;
  areaId?: string | null;
}
export interface RawAppleScriptSnapshot {
  items: RawAppleScriptItem[];
  logbook: RawAppleScriptItem[] | null;
  lists: Record<"inbox" | "today" | "upcoming" | "anytime" | "someday" | "trash", string[]>;
  areas: { id: string; title: string }[];
  tags: { id: string; title: string; parentId: string | null }[];
}

export class ThingsClient implements ThingsApi {
  constructor(private readonly runner: Runner = osascriptRunner) {}

  private async call<T>(op: string, args: object = {}): Promise<T> {
    const stdout = await this.runner({ language: "JavaScript", script: shippedScript("things.jxa.js"), args: [JSON.stringify({ op, args })] });
    let res: BridgeResponse;
    try {
      res = JSON.parse(stdout.trim()) as BridgeResponse;
    } catch {
      throw new ThingsError(`Unexpected response from Things: ${stdout.slice(0, 200)}`, "things_error");
    }
    if (!res.ok) throw toThingsError(res.error ?? "Unknown error", res.errorNumber ?? null);
    return res.data as T;
  }

  ping() {
    return this.call<{ version: string; lists: number }>("ping");
  }
  list(list: ListName, limit?: number) {
    return this.call<TodoPage>("list", { list, limit });
  }
  project(project: string, limit?: number) {
    return this.call<TodoPage & { container: Todo }>("project", { project, limit });
  }
  area(area: string, limit?: number) {
    return this.call<TodoPage & { container: Ref }>("area", { area, limit });
  }
  search(query: string, opts: { includeCompleted?: boolean; limit?: number } = {}) {
    return this.call<TodoPage>("search", { query, ...opts });
  }
  get(id: string) {
    return this.call<Todo>("get", { id });
  }
  projects(area?: string) {
    return this.call<ProjectSummary[]>("projects", { area });
  }
  areas() {
    return this.call<AreaSummary[]>("areas");
  }
  tags() {
    return this.call<TagSummary[]>("tags");
  }
  /** Move to Inbox / Anytime / Someday (AppleScript; see move.applescript). */
  async moveToList(id: string, list: ListMove): Promise<void> {
    await this.runner({ language: "AppleScript", script: shippedScript("move.applescript"), args: [id, LIST_IDS[list]] });
  }

  /** Runs a write op, then applies a list move ("inbox"/"anytime"/"someday") if one was asked for. */
  private async writeThenMove(op: string, input: { when?: string }, id?: string): Promise<Todo> {
    const { when } = input;
    const move = isListMove(when);
    const result = await this.call<Todo>(op, move ? { ...input, when: undefined } : input);
    if (!move) return result;
    await this.moveToList(id ?? result.id, when);
    return this.get(result.id);
  }

  addTodo(todo: NewTodo) {
    return this.writeThenMove("addTodo", todo);
  }
  addProject(project: NewProject) {
    return this.writeThenMove("addProject", project);
  }
  update(update: TodoUpdate) {
    return this.writeThenMove("update", update, update.id);
  }
  setStatus(id: string, status: Status) {
    return this.call<Todo>("setStatus", { id, status });
  }
  /** Everything AppleScript can see, for basic mode (see applescript-snapshot.ts). */
  snapshotRaw(opts: { logbook: boolean; logbookLimit?: number }) {
    return this.call<RawAppleScriptSnapshot>("snapshot", opts);
  }
  /** Moves an item to the Trash. Deliberately NOT exposed as an MCP tool — test cleanup only. */
  trashForTests(id: string) {
    return this.call<{ id: string; trashed: boolean }>("trash", { id });
  }
}

/** Deep link that opens an item in the Things app. */
export function thingsUrl(id: string): string {
  return `things:///show?id=${encodeURIComponent(id)}`;
}
