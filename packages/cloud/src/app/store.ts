// App state: the live snapshot from your Mac, optimistic edits on top, selection, routing, toasts.
// One tiny observable store; the whole tree re-renders on change (cheap at Things scale).

import { applyPatch, type Snapshot, type Task } from "things3pp-core/model/types";
import { ThingsIndex, todayIn } from "things3pp-core/model/queries";
import type { Action, ActionResult, HubToBrowser, MacState } from "things3pp-core/relay/protocol";

// ---------- routing ----------

export type ListId = "inbox" | "today" | "upcoming" | "anytime" | "someday" | "logbook" | "trash";
export type Route =
  | { kind: "list"; list: ListId }
  | { kind: "project"; id: string }
  | { kind: "area"; id: string }
  | { kind: "tag"; id: string }
  | { kind: "settings" }
  | { kind: "pair"; code: string }
  | { kind: "home" };

const LISTS: ListId[] = ["inbox", "today", "upcoming", "anytime", "someday", "logbook", "trash"];

export function parseRoute(path: string, hash: string): Route {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "pair") return { kind: "pair", code: decodeURIComponent(hash.replace(/^#/, "")) };
  if (parts.length === 0) return { kind: "home" };
  if (LISTS.includes(parts[0] as ListId)) return { kind: "list", list: parts[0] as ListId };
  if (parts[0] === "project" && parts[1]) return { kind: "project", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "area" && parts[1]) return { kind: "area", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "tag" && parts[1]) return { kind: "tag", id: decodeURIComponent(parts[1]) };
  if (parts[0] === "settings") return { kind: "settings" };
  return { kind: "home" };
}

export function routePath(r: Route): string {
  switch (r.kind) {
    case "list":
      return `/${r.list}`;
    case "project":
    case "area":
    case "tag":
      return `/${r.kind}/${encodeURIComponent(r.id)}`;
    case "settings":
      return "/settings";
    case "pair":
      return `/pair#${r.code}`;
    case "home":
      return "/";
  }
}

// ---------- state ----------

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export type Auth =
  | { status: "loading" }
  | { status: "signedOut"; setUp: boolean; shared?: boolean }
  | { status: "signedIn" };

export interface State {
  auth: Auth;
  route: Route;
  /** Phone layout: showing the list (detail) instead of the sidebar. */
  mobileDetail: boolean;
  snapshot: Snapshot | null;
  mac: MacState | null;
  connected: boolean;
  selected: string[];
  expanded: string | null;
  /** A new, not-yet-saved to-do being typed into, and where it goes. */
  draft: Draft | null;
  quickFind: boolean;
  toasts: Toast[];
  devices: { id: string; name: string; createdAt: number; lastSeenAt: number | null; online: boolean }[];
}

export interface Draft {
  key: number;
  /** Where it was started, so it can be inserted in the right place. */
  afterId: string | null;
  defaults: { when?: string; evening?: boolean; projectId?: string; areaId?: string; headingId?: string; tagIds?: string[]; start?: Task["start"] };
}

const isPhone = () => window.matchMedia("(max-width: 760px)").matches;

export const state: State = {
  auth: { status: "loading" },
  route: parseRoute(location.pathname, location.hash),
  mobileDetail: false,
  snapshot: null,
  mac: null,
  connected: false,
  selected: [],
  expanded: null,
  draft: null,
  quickFind: false,
  toasts: [],
  devices: [],
};

const listeners = new Set<() => void>();
let version = 0;
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
let scheduled = false;
export function set(patch: Partial<State>) {
  Object.assign(state, patch);
  version++;
  if (scheduled) return;
  scheduled = true;
  queueMicrotask(() => {
    scheduled = false;
    for (const l of listeners) l();
  });
}
export const getVersion = () => version;

// ---------- optimistic layer ----------

/** Local edits not yet confirmed by the Mac. */
const overrides = new Map<string, { task: Task; fields: Partial<Task>; at: number }>();
/** New items not yet created on the Mac. */
const temps = new Map<string, Task>();
/** Just-completed items that stay visible for a moment before leaving the list. */
const lingering = new Map<string, number>();

let cached: { v: number; index: ThingsIndex; today: string } | null = null;

/** The index the UI renders: the Mac's snapshot plus local edits. */
export function index(): ThingsIndex {
  const today = currentDay();
  if (cached && cached.v === version && cached.today === today) return cached.index;
  const base = state.snapshot ?? { rev: 0, generatedAt: "", timeZone: "UTC", tasks: [], areas: [], tags: [], capabilities: { urlScheme: false } };
  let tasks = base.tasks;
  if (overrides.size || temps.size || lingering.size) {
    tasks = base.tasks.map((t) => overrides.get(t.id)?.task ?? t);
    tasks.push(...temps.values());
    if (lingering.size) tasks = tasks.map((t) => (lingering.has(t.id) && t.status !== "open" ? { ...t, status: "open" as const, completedAt: null } : t));
  }
  const ix = new ThingsIndex({ ...base, tasks }, today);
  cached = { v: version, index: ix, today };
  return ix;
}

/** The status to draw (lingering items render as done while still listed). */
export function displayStatus(t: Task): Task["status"] {
  if (lingering.has(t.id)) return lingering.get(t.id)! > 0 ? "completed" : "canceled";
  return t.status;
}
export function isLeaving(id: string): boolean {
  const at = lingering.get(id);
  return at !== undefined && Math.abs(at) < Date.now() - 1300;
}

export function currentDay(): string {
  // Things dates are the Mac's local days; use its zone when we know it.
  return todayIn(state.snapshot?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
}

function currentTask(id: string): Task | undefined {
  return overrides.get(id)?.task ?? temps.get(id) ?? state.snapshot?.tasks.find((t) => t.id === id);
}

function override(id: string, change: Partial<Task>) {
  const cur = currentTask(id);
  if (!cur) return;
  const prev = overrides.get(id);
  overrides.set(id, { task: { ...cur, ...change, modifiedAt: new Date().toISOString() }, fields: { ...prev?.fields, ...change }, at: Date.now() });
  set({});
}

// Forget local edits the Mac never confirmed (e.g. it changed something else).
setInterval(() => {
  let changed = false;
  for (const [id, o] of overrides) if (Date.now() - o.at > 20_000) (overrides.delete(id), (changed = true));
  if (changed) set({});
}, 5000);

// ---------- network ----------

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-things3pp": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!res.ok) {
    // ActionResult puts its message in `error`; other endpoints use `message`.
    const message = data.message ?? (typeof data.error === "string" && data.error.includes(" ") ? data.error : undefined) ?? `Request failed (${res.status})`;
    throw Object.assign(new Error(message), { status: res.status, data });
  }
  return data;
}
export { api };

export async function loadState() {
  try {
    const s = await api<{ signedIn: boolean; setUp: boolean; shared?: boolean; mac?: MacState; devices?: State["devices"] }>("/api/state");
    if (s.signedIn) {
      set({ auth: { status: "signedIn" }, mac: s.mac ?? null, devices: s.devices ?? [] });
      connectLive();
    } else set({ auth: { status: "signedOut", setUp: s.setUp, shared: s.shared } });
  } catch {
    set({ auth: { status: "signedOut", setUp: true } });
  }
}

let ws: WebSocket | null = null;
let wsBackoff = 1000;
let pingTimer: ReturnType<typeof setInterval> | undefined;

export function connectLive() {
  if (ws) return;
  const url = new URL("/api/live", location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const sock = new WebSocket(url);
  ws = sock;
  sock.onopen = () => {
    wsBackoff = 1000;
    set({ connected: true });
    clearInterval(pingTimer);
    pingTimer = setInterval(() => sock.readyState === WebSocket.OPEN && sock.send('{"t":"ping"}'), 25_000);
  };
  sock.onmessage = (ev) => {
    let msg: HubToBrowser;
    try {
      msg = JSON.parse(String(ev.data)) as HubToBrowser;
    } catch {
      return;
    }
    if (msg.t === "snapshot") {
      for (const t of msg.snapshot.tasks) confirmOverride(t);
      set({ snapshot: msg.snapshot, mac: msg.mac });
    } else if (msg.t === "patch") {
      if (!state.snapshot) return;
      try {
        for (const t of msg.patch.upsert.tasks) confirmOverride(t);
        for (const id of msg.patch.remove.tasks) overrides.delete(id);
        set({ snapshot: applyPatch(state.snapshot, msg.patch) });
      } catch {
        sock.close(); // out of step: reconnect for a fresh snapshot
      }
    } else if (msg.t === "mac") set({ mac: msg.mac });
  };
  sock.onclose = (ev) => {
    ws = null;
    clearInterval(pingTimer);
    set({ connected: false });
    if (ev.code === 1008 || ev.code === 4401) return;
    setTimeout(() => {
      // Re-check the session first; it may have expired.
      void fetch("/api/state", { credentials: "same-origin" })
        .then((r) => r.json() as Promise<{ signedIn: boolean; setUp: boolean }>)
        .then((s) => (s.signedIn ? connectLive() : set({ auth: { status: "signedOut", setUp: s.setUp } })))
        .catch(() => connectLive());
    }, wsBackoff);
    wsBackoff = Math.min(wsBackoff * 2, 30_000);
  };
}

/** The Mac's version of a task arrived: drop our local guess once every field we changed matches. */
function confirmOverride(t: Task) {
  const o = overrides.get(t.id);
  if (!o) return;
  const settled = Object.entries(o.fields).every(([k, v]) => k === "modifiedAt" || k === "completedAt" || JSON.stringify(t[k as keyof Task]) === JSON.stringify(v));
  if (settled) overrides.delete(t.id);
  else overrides.set(t.id, { ...o, task: { ...t, ...o.fields } });
}

// ---------- toasts ----------

let toastId = 0;
export function toast(text: string, action?: Toast["action"], ms = 4500) {
  const t = { id: ++toastId, text, action };
  set({ toasts: [...state.toasts, t].slice(-3) });
  setTimeout(() => set({ toasts: state.toasts.filter((x) => x.id !== t.id) }), ms);
}

// ---------- actions ----------

/** Dev-only demo mode (?demo during `cf dev`): a fake Mac in the browser. */
let demo: { apply: (s: Snapshot, a: Action) => { snapshot: Snapshot; result: ActionResult } } | null = null;
export async function startDemo(): Promise<boolean> {
  if (!import.meta.env.DEV || !new URLSearchParams(location.search).has("demo")) return false;
  const mod = await import("./demo.ts");
  demo = { apply: mod.demoApply };
  set({
    auth: { status: "signedIn" },
    snapshot: mod.demoSnapshot(),
    connected: true,
    mac: { online: true, lastSeen: new Date().toISOString(), name: "Demo Mac", problem: null },
    devices: [{ id: "dev_demo", name: "Demo Mac", createdAt: Date.now(), lastSeenAt: Date.now(), online: true }],
  });
  return true;
}

async function send(action: Action, undo?: () => void): Promise<ActionResult> {
  if (demo) {
    await new Promise((r) => setTimeout(r, 250));
    const { snapshot, result } = demo.apply(state.snapshot!, action);
    for (const t of snapshot.tasks) confirmOverride(t);
    set({ snapshot });
    return result;
  }
  try {
    const res = await api<ActionResult>("/api/action", { action });
    return res;
  } catch (e) {
    undo?.();
    const msg = e instanceof Error ? e.message : "Something went wrong.";
    toast(msg);
    return { ok: false, error: msg };
  }
}

function tagTitles(ids: string[]): string[] {
  const ix = index();
  return ids.map((id) => ix.tag(id)?.title).filter((x): x is string => Boolean(x));
}

function revert(id: string) {
  overrides.delete(id);
  set({});
}

export function toggleComplete(id: string, opts: { cancel?: boolean } = {}) {
  const t = currentTask(id);
  if (!t) return;
  const done = t.status !== "open" && !lingering.has(id);
  const nowLingering = lingering.has(id);
  if (done || nowLingering) {
    // Un-check.
    lingering.delete(id);
    override(id, { status: "open", completedAt: null });
    void send({ op: "setStatus", args: { id, status: "open" } }, () => revert(id));
    return;
  }
  const status = opts.cancel ? "canceled" : "completed";
  lingering.set(id, opts.cancel ? -Date.now() : Date.now());
  override(id, { status, completedAt: new Date().toISOString() });
  // Let it linger checked for a moment, then slide out.
  setTimeout(() => set({}), 1350);
  setTimeout(() => {
    lingering.delete(id);
    set({ selected: state.selected.filter((s) => s !== id), expanded: state.expanded === id ? null : state.expanded });
  }, 1750);
  void send({ op: "setStatus", args: { id, status } }, () => {
    lingering.delete(id);
    revert(id);
  }).then((res) => {
    if (res.ok) toast(`${opts.cancel ? "Canceled" : "Completed"} “${t.title || "New To-Do"}”`, { label: "Undo", run: () => toggleComplete(id) }, 4000);
  });
}

export type WhenChoice = "today" | "evening" | "anytime" | "someday" | "inbox" | { day: string };

export function setWhen(ids: string[], choice: WhenChoice) {
  const today = currentDay();
  for (const id of ids) {
    const t = currentTask(id);
    if (!t) continue;
    let change: Partial<Task>;
    let action: Action;
    if (choice === "today") {
      change = { when: today, evening: false, start: "anytime" };
      action = { op: "update", args: { id, when: "today", ...(t.evening ? { evening: false } : {}) } };
    } else if (choice === "evening") {
      change = { when: today, evening: true, start: "anytime" };
      action = { op: "update", args: { id, evening: true } };
    } else if (choice === "anytime") {
      change = { when: null, evening: false, start: "anytime" };
      action = { op: "update", args: { id, when: "anytime" } };
    } else if (choice === "someday") {
      change = { when: null, evening: false, start: "someday" };
      action = { op: "update", args: { id, when: "someday" } };
    } else if (choice === "inbox") {
      change = { when: null, evening: false, start: "inbox" };
      action = { op: "update", args: { id, when: "inbox" } };
    } else {
      const future = choice.day > today;
      change = { when: choice.day, evening: false, start: future ? "someday" : "anytime" };
      action = { op: "update", args: { id, when: choice.day === today ? "today" : choice.day } };
    }
    override(id, change);
    void send(action, () => revert(id));
  }
}

export function setDeadline(id: string, day: string | null) {
  override(id, { deadline: day });
  void send({ op: "update", args: { id, deadline: day } }, () => revert(id));
}

export function setTitle(id: string, title: string) {
  const t = currentTask(id);
  if (!t || t.title === title || !title.trim()) return;
  override(id, { title });
  void send({ op: "update", args: { id, title } }, () => revert(id));
}

export function setNotes(id: string, notes: string) {
  const t = currentTask(id);
  if (!t || t.notes === notes) return;
  override(id, { notes });
  void send({ op: "update", args: { id, notes } }, () => revert(id));
}

export function setTags(id: string, tagIds: string[]) {
  override(id, { tags: tagIds });
  void send({ op: "update", args: { id, tags: tagTitles(tagIds) } }, () => revert(id));
}

export function setChecklist(id: string, items: { id: string; title: string; done: boolean }[]) {
  override(id, { checklist: items });
  if (!state.snapshot?.capabilities.urlScheme) {
    toast('To edit checklists, turn on Things → Settings → General → "Enable Things URLs" on your Mac.');
    revert(id);
    return;
  }
  void send({ op: "setChecklist", args: { id, items: items.filter((i) => i.title.trim()).map(({ title, done }) => ({ title, done })) } }, () => revert(id));
}

export function moveTo(ids: string[], dest: { projectId?: string; areaId?: string }) {
  for (const id of ids) {
    if (dest.projectId) override(id, { projectId: dest.projectId, headingId: null, areaId: null, start: currentTask(id)?.start === "inbox" ? "anytime" : currentTask(id)?.start });
    else if (dest.areaId) override(id, { areaId: dest.areaId, projectId: null, headingId: null, start: currentTask(id)?.start === "inbox" ? "anytime" : currentTask(id)?.start });
    void send({ op: "update", args: { id, ...(dest.projectId ? { project: dest.projectId } : { area: dest.areaId }) } }, () => revert(id));
  }
}

let tempN = 0;
export async function createTodo(input: { title: string; notes?: string; checklist?: string[]; tagIds?: string[] } & Draft["defaults"]) {
  const today = currentDay();
  const id = `tmp_${++tempN}_${Date.now()}`;
  const when = input.evening ? today : (input.when ?? null);
  const start: Task["start"] = input.start ?? (when ? (when > today ? "someday" : "anytime") : input.projectId || input.areaId ? "anytime" : "inbox");
  const temp: Task = {
    id,
    kind: "todo",
    title: input.title,
    notes: input.notes ?? "",
    status: "open",
    start,
    when,
    evening: Boolean(input.evening),
    deadline: null,
    reminder: null,
    areaId: input.areaId ?? null,
    projectId: input.headingId ? null : (input.projectId ?? null),
    headingId: input.headingId ?? null,
    tags: input.tagIds ?? [],
    checklist: (input.checklist ?? []).map((title, i) => ({ id: `${id}_${i}`, title, done: false })),
    index: Number.MAX_SAFE_INTEGER,
    todayIndex: Number.MAX_SAFE_INTEGER,
    repeating: false,
    trashed: false,
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
    completedAt: null,
  };
  temps.set(id, temp);
  set({});
  const whenArg = input.evening ? undefined : when ? (when === today ? "today" : when) : start === "someday" ? "someday" : start === "anytime" && !input.projectId && !input.areaId ? "anytime" : undefined;
  const res = await send({
    op: "addTodo",
    args: {
      title: input.title,
      ...(input.notes ? { notes: input.notes } : {}),
      ...(whenArg ? { when: whenArg as "today" } : {}),
      ...(input.evening ? { evening: true } : {}),
      ...(input.projectId && !input.headingId ? { project: input.projectId } : {}),
      ...(input.areaId && !input.projectId ? { area: input.areaId } : {}),
      ...(input.headingId ? { headingId: input.headingId, project: input.projectId } : {}),
      ...(input.tagIds?.length ? { tags: tagTitles(input.tagIds) } : {}),
      ...(input.checklist?.length ? { checklist: input.checklist } : {}),
    },
  });
  temps.delete(id);
  set({});
  if (res.ok && res.id) return res.id;
  return null;
}

// ---------- navigation ----------

export function navigate(route: Route, opts: { replace?: boolean } = {}) {
  const path = routePath(route) + (demo || (import.meta.env.DEV && location.search.includes("demo")) ? "?demo" : "");
  if (opts.replace) history.replaceState(null, "", path);
  else if (location.pathname + location.search + location.hash !== path) history.pushState(null, "", path);
  set({ route, selected: [], expanded: null, draft: null, mobileDetail: isPhone() ? route.kind !== "home" : state.mobileDetail });
  document.querySelector(".main-scroll")?.scrollTo({ top: 0 });
}

function onLocationChange() {
  const route = parseRoute(location.pathname, location.hash);
  set({ route, selected: [], expanded: null, draft: null, mobileDetail: route.kind !== "home" });
}
window.addEventListener("popstate", onLocationChange);
// Opening another /pair#CODE link in the same tab only changes the hash.
window.addEventListener("hashchange", onLocationChange);

export function select(id: string, mode: "only" | "toggle" | "range" = "only", visibleIds: string[] = []) {
  if (mode === "toggle") {
    set({ selected: state.selected.includes(id) ? state.selected.filter((s) => s !== id) : [...state.selected, id] });
  } else if (mode === "range" && state.selected.length) {
    const a = visibleIds.indexOf(state.selected[state.selected.length - 1]!);
    const b = visibleIds.indexOf(id);
    if (a < 0 || b < 0) return set({ selected: [id] });
    const [lo, hi] = a < b ? [a, b] : [b, a];
    set({ selected: visibleIds.slice(lo, hi + 1) });
  } else set({ selected: [id] });
}

export async function signOut() {
  await api("/api/auth/logout", {}).catch(() => {});
  ws?.close(1008);
  set({ auth: { status: "signedOut", setUp: true }, snapshot: null });
  navigate({ kind: "home" }, { replace: true });
}
