// The inline Things view, rendered by MCP Apps hosts (Claude, ChatGPT, VS Code, Goose, …).
// SECURITY: all data is inserted with textContent / createElement. Never use innerHTML with Things data.
import {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "@modelcontextprotocol/ext-apps/app-with-deps";

// Mirrors src/things/types.ts and src/format.ts (kept separate: this file is bundled for the browser).
interface Ref { id: string; name: string }
interface Todo {
  id: string;
  kind: "todo" | "project";
  title: string;
  notes: string;
  status: "open" | "completed" | "canceled";
  when: string | null;
  deadline: string | null;
  tags: string[];
  project: Ref | null;
  area: Ref | null;
  completedAt: string | null;
}
type Payload =
  | { view: "list"; title: string; source: { tool: string; args: Record<string, unknown> }; total: number; items: Todo[] }
  | { view: "item"; title: string; item: Todo };

// ---------- static icons (trusted constants only) ----------
const ICONS = {
  check: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.3l2.3 2.3 4.7-5"/></svg>',
  refresh: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/></svg>',
  open: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h4v4"/><path d="M13 3L7.5 8.5"/><path d="M12 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2.5"/></svg>',
  flag: '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M2.5 1.2v10h1.2V7.4h5.8l-1.4-2.3 1.4-2.3H3.7V1.2z"/></svg>',
  notes: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2.5 3h7M2.5 6h7M2.5 9h4.5"/></svg>',
  today: '<svg viewBox="0 0 24 24"><path fill="#f5c518" d="M12 2.8l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 16.8l-5.4 2.9 1-6.1L3.2 9.3l6.1-.9z"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="#1c7cf4" stroke-width="2" stroke-linejoin="round"><path d="M3.5 13.5l2.6-8h11.8l2.6 8v5h-17z"/><path d="M3.5 13.5h5l1 2.5h5l1-2.5h5"/></svg>',
  upcoming: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="3" fill="none" stroke="#e5484d" stroke-width="2"/><path d="M3.5 10h17" stroke="#e5484d" stroke-width="2"/><path d="M8 3v4M16 3v4" stroke="#e5484d" stroke-width="2" stroke-linecap="round"/></svg>',
  anytime: '<svg viewBox="0 0 24 24" fill="none" stroke="#12a594" stroke-width="2" stroke-linejoin="round"><path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z"/><path d="M3.5 12.5l8.5 4.5 8.5-4.5"/></svg>',
  someday: '<svg viewBox="0 0 24 24" fill="none" stroke="#c2a878" stroke-width="2" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="5" rx="1.5"/><path d="M5 9.5v9a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-9M10 13h4"/></svg>',
  logbook: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="#30a46c"/><path d="M8 12.3l2.7 2.7 5.3-5.7" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  todo: '<svg viewBox="0 0 24 24" fill="none" stroke="#1c7cf4" stroke-width="2"><rect x="4.5" y="4.5" width="15" height="15" rx="4"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="#8a8f98" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>',
  project: '<svg viewBox="0 0 24 24" fill="none" stroke="#1c7cf4" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 8 8h-8z" fill="#1c7cf4"/></svg>',
  area: '<svg viewBox="0 0 24 24" fill="none" stroke="#30a46c" stroke-width="2"><path d="M4 8.5l8-4.5 8 4.5v7L12 20l-8-4.5z"/></svg>',
} as const;

function svg(name: keyof typeof ICONS, cls?: string): HTMLElement {
  const span = document.createElement("span");
  span.innerHTML = ICONS[name]; // static constant, never user data
  const el = span.firstElementChild as HTMLElement;
  if (cls) el.classList.add(cls);
  return el;
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; text?: string; title?: string; attrs?: Record<string, string> } = {},
  ...children: (Node | null | false | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.title) el.title = props.title;
  for (const [k, v] of Object.entries(props.attrs ?? {})) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}

// ---------- dates ----------
function parseDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}
function startOfToday(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}
function daysFromToday(s: string): number {
  return Math.round((parseDay(s).getTime() - startOfToday().getTime()) / 86_400_000);
}
function dayLabel(s: string): string {
  const diff = daysFromToday(s);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  const d = parseDay(s);
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}
function deadlineLabel(s: string): { text: string; urgent: boolean } {
  const diff = daysFromToday(s);
  if (diff < 0) return { text: `${-diff} day${diff === -1 ? "" : "s"} overdue`, urgent: true };
  if (diff === 0) return { text: "Due today", urgent: true };
  if (diff <= 3) return { text: `${diff} day${diff === 1 ? "" : "s"} left`, urgent: true };
  return { text: dayLabel(s), urgent: false };
}

// ---------- app ----------
const root = document.getElementById("root")!;
const app = new App({ name: "Things view", version: "0.1.0" }, {}, { autoResize: true });
let current: Payload | null = null;
const busy = new Set<string>();

function toast(message: string) {
  const el = h("div", { class: "toast", text: message, attrs: { role: "status" } });
  document.body.append(el);
  setTimeout(() => el.remove(), 3500);
}

function thingsLink(id?: string): string {
  return id ? `things:///show?id=${encodeURIComponent(id)}` : "things:///show?id=today";
}

async function openInThings(id?: string) {
  try {
    await app.openLink({ url: thingsLink(id) });
  } catch {
    toast("This app can't open Things links. Open Things manually.");
  }
}

function headerIcon(p: Payload): HTMLElement {
  if (p.view === "item") return svg(p.item.kind === "project" ? "project" : "todo", "icon");
  const t = p.source.tool;
  if (t === "show_list") {
    const list = String(p.source.args.list) as keyof typeof ICONS;
    return svg(list in ICONS ? list : "inbox", "icon");
  }
  if (t === "show_project") return svg("project", "icon");
  if (t === "show_area") return svg("area", "icon");
  return svg("search", "icon");
}

function checkbox(todo: Todo): HTMLButtonElement {
  const done = todo.status !== "open";
  const btn = h("button", {
    class: `check${todo.status === "completed" ? " on" : ""}${todo.status === "canceled" ? " canceled" : ""}${todo.kind === "project" ? " project" : ""}`,
    attrs: { role: "checkbox", "aria-checked": String(done), "aria-label": `${done ? "Reopen" : "Complete"} “${todo.title}”` },
  });
  btn.append(svg("check"));
  if (busy.has(todo.id)) btn.disabled = true;
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    void toggle(todo);
  });
  return btn;
}

function metaLine(todo: Todo, opts: { hideContainer?: boolean }): HTMLElement | null {
  const bits: Node[] = [];
  const container = todo.project ?? todo.area;
  if (container && !opts.hideContainer) bits.push(h("span", { text: container.name }));
  for (const tag of todo.tags) bits.push(h("span", { class: "tag", text: tag }));
  return bits.length ? h("div", { class: "meta" }, ...bits) : null;
}

function sideInfo(todo: Todo, listKind: string): HTMLElement | null {
  const side = h("div", { class: "side" });
  if (todo.deadline) {
    const d = deadlineLabel(todo.deadline);
    const el = h("span", { class: `deadline${d.urgent && todo.status === "open" ? " urgent" : ""}`, title: `Deadline ${todo.deadline}` });
    el.append(svg("flag"), document.createTextNode(d.text));
    side.append(el);
  }
  if (todo.when && listKind !== "upcoming" && listKind !== "today" && todo.status === "open") {
    side.append(h("span", { class: "badge", text: dayLabel(todo.when), title: `Scheduled ${todo.when}` }));
  }
  return side.childElementCount ? side : null;
}

function row(todo: Todo, listKind: string, hideContainer: boolean): HTMLElement {
  const isToday = todo.when !== null && daysFromToday(todo.when) <= 0 && todo.status === "open" && listKind !== "today";
  const title = h("div", { class: "title" });
  if (isToday) title.append(h("span", { class: "star", text: "★", title: "Today" }));
  title.append(document.createTextNode(todo.title || "Untitled"));
  if (todo.notes) title.append(svg("notes", "notes-hint"));

  const main = h(
    "button",
    { class: `row-main${todo.notes ? " has-notes" : ""}`, attrs: todo.notes ? { "aria-expanded": "false" } : { tabindex: "-1" } },
    title,
    metaLine(todo, { hideContainer }),
    todo.notes ? h("div", { class: "notes", text: todo.notes }) : null,
  );
  const el = h("div", { class: `row${todo.status !== "open" ? " done" : ""}`, attrs: { "data-id": todo.id } }, checkbox(todo), main, sideInfo(todo, listKind));
  if (todo.notes) {
    main.addEventListener("click", () => {
      const open = el.classList.toggle("open");
      main.setAttribute("aria-expanded", String(open));
    });
  }
  main.addEventListener("dblclick", () => void openInThings(todo.id));
  return el;
}

function groupItems(items: Todo[], listKind: string): { title: string; sub?: string; items: Todo[] }[] {
  const groups = new Map<string, { title: string; sub?: string; items: Todo[] }>();
  const add = (key: string, title: string, item: Todo, sub?: string) => {
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { title, sub, items: [] }));
    g.items.push(item);
  };
  for (const t of items) {
    if (listKind === "upcoming") {
      // Repeating to-dos don't expose their next date to scripting, so they have no `when`.
      if (t.when) add(t.when, dayLabel(t.when), t, parseDay(t.when).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
      else add("~other", "Repeating & other", t);
    }
    else if (listKind === "logbook" && t.completedAt) {
      const day = t.completedAt.slice(0, 10);
      add(day, dayLabel(new Date(t.completedAt).toLocaleDateString("sv-SE")), t);
    } else if (["today", "anytime", "someday", "inbox"].includes(listKind)) {
      const c = t.project ?? t.area;
      add(c ? c.id : "", c ? c.name : "", t);
    } else add("", "", t);
  }
  const out = [...groups.entries()];
  if (listKind === "upcoming") out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)); // dates first, "~other" last
  return out.map(([, g]) => g);
}

function renderList(p: Extract<Payload, { view: "list" }>) {
  const listKind = p.source.tool === "show_list" ? String(p.source.args.list) : p.source.tool;
  const refresh = h("button", { class: "ghost", title: "Refresh", attrs: { "aria-label": "Refresh" } }, svg("refresh"));
  refresh.addEventListener("click", () => void reload(refresh));
  const openBtn = h("button", { class: "ghost", title: "Open in Things" }, svg("open"), h("span", { text: "Things" }));
  openBtn.addEventListener("click", () => void openInThings(listKind === "show_project" || listKind === "show_area" ? String(p.source.args.project ?? p.source.args.area) : typeof p.source.args.list === "string" ? p.source.args.list : undefined));

  const head = h("div", { class: "head" }, headerIcon(p), h("h1", { text: p.title }, h("span", { class: "count", text: p.total ? String(p.total) : "" })), refresh, openBtn);
  const body: Node[] = [head];

  if (p.items.length === 0) {
    body.push(h("div", { class: "empty" }, h("span", { class: "big", text: listKind === "today" ? "☀︎" : "✓" }), h("span", { text: listKind === "today" ? "Nothing left for today." : "Nothing here." })));
  } else {
    const hideContainer = listKind === "show_project" || listKind === "show_area";
    for (const g of groupItems(p.items, listKind)) {
      const section = h("section", { class: "group" });
      if (g.title) section.append(h("div", { class: "group-title" }, h("span", { text: g.title }), g.sub && g.sub !== g.title ? h("span", { class: "sub", text: g.sub }) : null));
      for (const t of g.items) section.append(row(t, listKind, hideContainer || Boolean(g.title && (t.project ?? t.area))));
      body.push(section);
    }
    if (p.total > p.items.length) body.push(h("div", { class: "more", text: `Showing ${p.items.length} of ${p.total}. Ask for more to see the rest.` }));
  }
  root.replaceChildren(...body);
}

function renderItem(p: Extract<Payload, { view: "item" }>) {
  const t = p.item;
  const props = h("dl", { class: "props" });
  const prop = (label: string, value: string | Node) => props.append(h("dt", { text: label }), h("dd", {}, typeof value === "string" ? document.createTextNode(value) : value));
  if (t.when) prop("When", dayLabel(t.when));
  if (t.deadline) {
    const d = deadlineLabel(t.deadline);
    const el = h("span", { class: `deadline${d.urgent && t.status === "open" ? " urgent" : ""}` });
    el.append(svg("flag"), document.createTextNode(`${dayLabel(t.deadline)}${d.urgent ? ` · ${d.text}` : ""}`));
    prop("Deadline", el);
  }
  if (t.project) prop("Project", t.project.name);
  else if (t.area) prop("Area", t.area.name);
  if (t.tags.length) prop("Tags", h("span", { class: "meta" }, ...t.tags.map((tag) => h("span", { class: "tag", text: tag }))));

  const openBtn = h("button", { class: "ghost" }, svg("open"), h("span", { text: "Open in Things" }));
  openBtn.addEventListener("click", () => void openInThings(t.id));

  const card = h(
    "div",
    { class: `card${t.status !== "open" ? " done" : ""}` },
    h("div", { class: "eyebrow" }, svg(t.kind === "project" ? "project" : "todo"), h("span", { text: p.title })),
    h("div", { class: `top row${t.status !== "open" ? " done" : ""}`, attrs: { "data-id": t.id } }, checkbox(t), h("div", { class: "title", text: t.title || "Untitled" })),
    t.notes ? h("div", { class: "notes", text: t.notes }) : null,
    props.childElementCount ? props : null,
    h("div", { class: "actions" }, openBtn),
  );
  root.replaceChildren(card);
}

function render() {
  if (!current) return;
  if (current.view === "list") renderList(current);
  else renderItem(current);
}

function applyResult(structured: unknown) {
  const p = structured as Payload | undefined;
  if (!p || (p.view !== "list" && p.view !== "item")) return;
  current = p;
  render();
}

function replaceTodo(updated: Todo) {
  if (!current) return;
  if (current.view === "item" && current.item.id === updated.id) current = { ...current, item: updated };
  if (current.view === "list") current = { ...current, items: current.items.map((t) => (t.id === updated.id ? updated : t)) };
}

async function toggle(todo: Todo) {
  if (busy.has(todo.id)) return;
  const completing = todo.status === "open";
  busy.add(todo.id);
  // Optimistic: show the new state immediately, roll back on failure.
  replaceTodo({ ...todo, status: completing ? "completed" : "open" });
  render();
  try {
    const res = await app.callServerTool({ name: completing ? "complete_todo" : "reopen_todo", arguments: { id: todo.id } });
    if (res.isError) throw new Error(res.content?.map((c) => ("text" in c ? c.text : "")).join(" ") || "Things returned an error.");
    const payload = res.structuredContent as Payload | undefined;
    if (payload?.view === "item") replaceTodo(payload.item);
    void app
      .updateModelContext({
        content: [{ type: "text", text: `The user ${completing ? "completed" : "reopened"} “${todo.title}” (id ${todo.id}) from the Things view.` }],
      })
      .catch(() => {});
  } catch (err) {
    replaceTodo(todo);
    toast(err instanceof Error ? err.message : "Couldn't update Things.");
  } finally {
    busy.delete(todo.id);
    render();
  }
}

async function reload(btn: HTMLElement) {
  if (!current || current.view !== "list") return;
  btn.classList.add("spin");
  try {
    const res = await app.callServerTool({ name: current.source.tool, arguments: current.source.args });
    if (res.isError) throw new Error("Refresh failed.");
    applyResult(res.structuredContent);
  } catch (err) {
    toast(err instanceof Error ? err.message : "Refresh failed.");
  } finally {
    btn.classList.remove("spin");
  }
}

function applyContext(ctx: ReturnType<App["getHostContext"]>) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
}

// Register handlers before connecting so one-shot notifications aren't missed.
app.ontoolresult = (params) => {
  if (params.isError) {
    const text = params.content?.map((c) => ("text" in c ? c.text : "")).join(" ") || "Something went wrong.";
    root.replaceChildren(h("div", { class: "empty" }, h("span", { class: "big", text: "!" }), h("span", { text })));
    return;
  }
  applyResult(params.structuredContent);
};
app.onhostcontextchanged = (ctx) => applyContext(ctx);

app
  .connect()
  .then(() => applyContext(app.getHostContext()))
  .catch((err: unknown) => {
    root.replaceChildren(h("div", { class: "empty", text: `Couldn't connect to the host: ${String(err)}` }));
  });
