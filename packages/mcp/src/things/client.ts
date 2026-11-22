import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  AreaSummary,
  ListName,
  NewProject,
  NewTodo,
  ProjectSummary,
  Status,
  TagSummary,
  Todo,
  TodoPage,
  TodoUpdate,
} from "./types.js";

export type ThingsErrorCode =
  | "permission_denied"
  | "permission_pending"
  | "not_installed"
  | "not_found"
  | "timeout"
  | "unsupported_platform"
  | "things_error";

export class ThingsError extends Error {
  constructor(
    message: string,
    readonly code: ThingsErrorCode,
  ) {
    super(message);
    this.name = "ThingsError";
  }
}

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
    s = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");
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

function toThingsError(message: string, errorNumber: number | null): ThingsError {
  const n = errorNumber ?? Number(/\((-?\d+)\)\s*$/.exec(message.trim())?.[1] ?? NaN);
  if (n === -1743 || /not authori[sz]ed/i.test(message)) {
    return new ThingsError(
      "macOS blocked access to Things. Open System Settings → Privacy & Security → Automation, find the app running this server, and enable \"Things3\".",
      "permission_denied",
    );
  }
  if (n === -1712) {
    return new ThingsError(
      "Things didn't respond. macOS may be waiting for you to approve access — look for a \"wants to control Things3\" prompt and click OK.",
      "permission_pending",
    );
  }
  if (n === -2700 && /Application can't be found/i.test(message)) {
    return new ThingsError("Things 3 doesn't seem to be installed.", "not_installed");
  }
  if (/Application can.t be found/i.test(message)) {
    return new ThingsError("Things 3 doesn't seem to be installed.", "not_installed");
  }
  if (/^No (to-do|project|area)/.test(message) || n === -1728) {
    return new ThingsError(message, "not_found");
  }
  return new ThingsError(`Things reported an error: ${message}`, "things_error");
}

interface BridgeResponse {
  ok: boolean;
  data?: unknown;
  error?: string;
  errorNumber?: number | null;
}

export class ThingsClient {
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
    return this.call<TodoPage & { container: { id: string; name: string } }>("area", { area, limit });
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
  /** Moves an item to the Trash. Deliberately NOT exposed as an MCP tool — test cleanup only. */
  trashForTests(id: string) {
    return this.call<{ id: string; trashed: boolean }>("trash", { id });
  }
}

/** Deep link that opens an item in the Things app. */
export function thingsUrl(id: string): string {
  return `things:///show?id=${encodeURIComponent(id)}`;
}
