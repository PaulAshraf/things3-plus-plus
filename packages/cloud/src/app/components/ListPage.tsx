import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { Task } from "things3pp-core/model/types";
import { addDays, diffDays, loggedLabel, longWhen, monthLabel, parseDay, shortWhen } from "../dates.ts";
import {
  IconAnytime,
  IconArea,
  IconCalendar,
  IconChevronLeft,
  IconEvening,
  IconFlag,
  IconInbox,
  IconLogbook,
  IconMove,
  IconPlus,
  IconSearch,
  IconSomeday,
  IconTag,
  IconToday,
  IconTrash,
  IconUpcoming,
  Pie,
} from "../icons.tsx";
import { currentDay, index, moveTo, navigate, set, setWhen, state, type Draft, type Route } from "../store.ts";
import { anchorOf, type Anchor } from "./Popover.tsx";
import { MovePicker, WhenPicker } from "./Pickers.tsx";
import { DraftCard, TodoItem, type RowContext } from "./TodoItem.tsx";

interface SectionHead {
  kind: "plain" | "evening" | "project" | "area" | "day" | "month" | "heading" | "logged";
  title: string;
  link?: Route;
  dayNum?: string;
  icon?: ComponentChildren;
  muted?: string;
}
interface Section {
  key: string;
  head?: SectionHead;
  tasks: Task[];
  ctx: Partial<RowContext>;
  /** Nested under an area. */
  indent?: boolean;
}
export interface View {
  title: string;
  icon: ComponentChildren;
  notes?: string;
  sections: Section[];
  empty: { icon: ComponentChildren; text: string };
  defaults: Draft["defaults"] | null;
  footer?: ComponentChildren;
  editableTitle?: boolean;
}

const plain = (key: string, tasks: Task[], ctx: Partial<RowContext> = {}): Section => ({ key, tasks, ctx });

function groupsToSections(groups: ReturnType<ReturnType<typeof index>["anytime"]>, ctx: Partial<RowContext>): Section[] {
  const ix = index();
  const out: Section[] = [];
  for (const g of groups) {
    if (g.kind === "none") out.push(plain("none", g.tasks, ctx));
    else if (g.kind === "project") {
      const prog = ix.progress(g.id!);
      out.push({ key: g.id!, head: { kind: "project", title: g.title || "New Project", link: { kind: "project", id: g.id! }, icon: <Pie done={prog.done} total={prog.total} class="icon" /> }, tasks: g.tasks, ctx });
    } else {
      out.push({ key: g.id!, head: { kind: "area", title: g.title, link: { kind: "area", id: g.id! }, icon: <IconArea /> }, tasks: g.tasks, ctx });
      for (const c of g.children ?? []) {
        const prog = ix.progress(c.id!);
        out.push({ key: c.id!, indent: true, head: { kind: "project", title: c.title || "New Project", link: { kind: "project", id: c.id! }, icon: <Pie done={prog.done} total={prog.total} class="icon" /> }, tasks: c.tasks, ctx });
      }
    }
  }
  return out;
}

export function buildView(route: Route, showLogged: boolean): View | null {
  const ix = index();
  const today = currentDay();
  if (route.kind === "list") {
    switch (route.list) {
      case "inbox":
        return {
          title: "Inbox",
          icon: <IconInbox />,
          sections: [plain("inbox", ix.inbox(), { showParent: false, showWhen: false })],
          empty: { icon: <IconInbox color="var(--text-3)" />, text: "Nothing in your Inbox. New to-dos without a date or project land here." },
          defaults: { start: "inbox" },
        };
      case "today": {
        const t = ix.todayList();
        const sections: Section[] = [plain("day", t.day, { showParent: true, showWhen: false })];
        if (t.evening.length) sections.push({ key: "evening", head: { kind: "evening", title: "This Evening", icon: <IconEvening /> }, tasks: t.evening, ctx: { showParent: true, showWhen: false } });
        return {
          title: "Today",
          icon: <IconToday />,
          sections,
          empty: { icon: <IconToday color="var(--text-3)" />, text: "Nothing planned for today. Enjoy it, or pull something in from Anytime." },
          defaults: { when: today, start: "anytime" },
        };
      }
      case "upcoming": {
        const groups = ix.upcoming();
        const sections: Section[] = [];
        const months = new Map<string, Task[]>();
        for (const g of groups) {
          const n = diffDays(today, g.day);
          if (n <= 7) {
            sections.push({ key: g.day, head: { kind: "day", dayNum: String(parseDay(g.day).getDate()), title: longWhen(g.day, today) }, tasks: g.tasks, ctx: { showParent: true, showWhen: false } });
          } else {
            const key = g.day.slice(0, 7);
            months.set(key, [...(months.get(key) ?? []), ...g.tasks]);
          }
        }
        for (const [key, tasks] of months) {
          sections.push({ key, head: { kind: "month", title: monthLabel(`${key}-01`, today) }, tasks, ctx: { showParent: true, showWhen: true } });
        }
        return {
          title: "Upcoming",
          icon: <IconUpcoming />,
          sections,
          empty: { icon: <IconUpcoming color="var(--text-3)" />, text: "Nothing scheduled. To-dos with a future date show up here." },
          defaults: { when: addDays(today, 1), start: "someday" },
        };
      }
      case "anytime":
        return {
          title: "Anytime",
          icon: <IconAnytime />,
          sections: groupsToSections(ix.anytime(), { showParent: false, showWhen: true }),
          empty: { icon: <IconAnytime color="var(--text-3)" />, text: "Nothing here yet." },
          defaults: { start: "anytime" },
        };
      case "someday":
        return {
          title: "Someday",
          icon: <IconSomeday />,
          sections: groupsToSections(ix.someday(), { showParent: false, showWhen: false }),
          empty: { icon: <IconSomeday color="var(--text-3)" />, text: "Ideas and maybes go here, out of your way." },
          defaults: { start: "someday" },
        };
      case "logbook":
        return {
          title: "Logbook",
          icon: <IconLogbook />,
          sections: ix.logbook().map((g) => ({ key: g.day, head: { kind: "logged", title: g.day === "unknown" ? "Earlier" : loggedLabel(g.day, today) }, tasks: g.tasks, ctx: { showParent: true, showWhen: false, logbook: true } })),
          empty: { icon: <IconLogbook color="var(--text-3)" />, text: "Completed to-dos are kept here." },
          defaults: null,
        };
      case "trash":
        return {
          title: "Trash",
          icon: <IconTrash />,
          notes: "Items you delete in Things. To restore one, open it and mark it open again; to empty the Trash, use Things on your Mac.",
          sections: [plain("trash", ix.trash(), { showParent: true, showWhen: false })],
          empty: { icon: <IconTrash color="var(--text-3)" />, text: "The Trash is empty." },
          defaults: null,
        };
    }
  }
  if (route.kind === "project") {
    const v = ix.project(route.id);
    if (!v) return null;
    const prog = ix.progress(route.id);
    const sections: Section[] = [plain("loose", v.loose, { showParent: false, showWhen: true })];
    for (const h of v.headings) sections.push({ key: h.heading.id, head: { kind: "heading", title: h.heading.title || "Heading" }, tasks: h.tasks, ctx: { showParent: false, showWhen: true } });
    if (showLogged && v.logged.length) sections.push({ key: "logged", head: { kind: "logged", title: "Logged" }, tasks: v.logged, ctx: { showParent: false, showWhen: false, logbook: true } });
    const parts: string[] = [];
    if (v.project.deadline) parts.push(`Deadline ${shortWhen(v.project.deadline, today)}`);
    if (v.project.when && v.project.when > today) parts.push(`Starts ${shortWhen(v.project.when, today)}`);
    if (v.project.start === "someday" && !v.project.when) parts.push("Someday");
    return {
      title: v.project.title || "New Project",
      icon: <Pie done={prog.done} total={prog.total} class="icon pie-lg" />,
      notes: [parts.join(" · "), v.project.notes].filter(Boolean).join("\n\n"),
      sections,
      empty: { icon: <IconCalendar color="var(--text-3)" />, text: "This project has no to-dos yet." },
      defaults: { projectId: route.id, start: "anytime" },
      footer:
        v.logged.length > 0 ? (
          <button class="link-btn" style={{ marginTop: "22px", fontSize: "13px" }} onClick={() => set({})} data-toggle-logged>
            {showLogged ? "Hide logged items" : `Show ${v.logged.length} logged item${v.logged.length === 1 ? "" : "s"}`}
          </button>
        ) : undefined,
    };
  }
  if (route.kind === "area") {
    const v = ix.areaView(route.id);
    if (!v) return null;
    return {
      title: v.area.title,
      icon: <IconArea />,
      sections: [plain("tasks", v.tasks, { showParent: false, showWhen: true }), ...(v.projects.length ? [{ key: "projects", tasks: v.projects, ctx: { showParent: false, showWhen: true } } as Section] : [])],
      empty: { icon: <IconArea color="var(--text-3)" />, text: "Nothing in this area yet." },
      defaults: { areaId: route.id, start: "anytime" },
    };
  }
  if (route.kind === "tag") {
    const tag = ix.tag(route.id);
    if (!tag) return null;
    return {
      title: tag.title,
      icon: <IconTag color="var(--text-2)" />,
      sections: [plain("tagged", ix.tagged(route.id), { showParent: true, showWhen: true })],
      empty: { icon: <IconTag color="var(--text-3)" />, text: "Nothing has this tag." },
      defaults: { tagIds: [route.id], start: "anytime" },
    };
  }
  return null;
}

export function visibleIds(view: View | null): string[] {
  if (!view) return [];
  return view.sections.flatMap((s) => s.tasks.map((t) => t.id));
}

function Head({ head, indent }: { head: SectionHead; indent?: boolean }) {
  if (head.kind === "heading") return <div class="heading-row">{head.title}</div>;
  if (head.kind === "day" || head.kind === "month") {
    return (
      <div class={`day-head${head.kind === "month" ? " later" : ""}`}>
        {head.dayNum && <span class="day-num">{head.dayNum}</span>}
        <span class="day-name">{head.title}</span>
      </div>
    );
  }
  return (
    <div
      class={`section-head${head.link ? " link" : ""}`}
      style={indent ? { marginLeft: "0", fontSize: "14px" } : undefined}
      onClick={() => head.link && navigate(head.link)}
    >
      {head.icon}
      <span class="section-title">{head.title}</span>
      {head.muted && <span class="muted">{head.muted}</span>}
    </div>
  );
}

export function ListPage({ view, showLogged, onToggleLogged }: { view: View; showLogged: boolean; onToggleLogged: () => void }) {
  const ids = visibleIds(view);
  const draft = state.draft;
  const total = view.sections.reduce((n, s) => n + s.tasks.length, 0);
  const isPhone = window.matchMedia("(max-width: 760px)").matches;
  return (
    <div class="page">
      {isPhone && (
        <button class="mobile-back" onClick={() => navigate({ kind: "home" })}>
          <IconChevronLeft /> Lists
        </button>
      )}
      <div class="list-head">
        <span class="icon">{view.icon}</span>
        <h1 class="list-title">{view.title}</h1>
      </div>
      {view.notes ? <div class="list-notes">{view.notes}</div> : null}
      <div class="list-body" style={{ marginTop: view.notes ? "8px" : "24px" }}>
        {draft && draft.afterId === null && <DraftCard draft={draft} />}
        {view.sections.map((s, i) =>
          s.tasks.length === 0 && s.head?.kind !== "heading" ? null : (
            <div key={s.key} class={s.head ? (s.head.kind === "day" || s.head.kind === "month" ? "day-group" : "section") : ""} style={i === 0 && !s.head ? undefined : s.indent ? { marginTop: "18px" } : undefined}>
              {s.head && <Head head={s.head} indent={s.indent} />}
              <div class="rows">
                {s.tasks.map((t) => (
                  <>
                    <TodoItem key={t.id} task={t} ctx={{ showParent: false, showWhen: false, ...s.ctx, visibleIds: ids }} />
                    {draft && draft.afterId === t.id && <DraftCard key={`draft-${draft.key}`} draft={draft} />}
                  </>
                ))}
              </div>
            </div>
          ),
        )}
        {total === 0 && !draft && (
          <div class="empty">
            {view.empty.icon}
            <p>{view.empty.text}</p>
          </div>
        )}
        {view.footer && (
          <div onClick={onToggleLogged} style={{ display: "contents" }}>
            {view.footer}
          </div>
        )}
        {showLogged ? null : null}
      </div>
    </div>
  );
}

/** Bottom toolbar: actions for the selection, like the Mac app's. */
export function Toolbar({ view }: { view: View | null }) {
  const [pop, setPop] = useState<{ kind: "when" | "move"; anchor: Anchor } | null>(null);
  const sel = state.selected.filter((id) => !id.startsWith("tmp_"));
  const ix = index();
  return (
    <>
      <div class="toolbar">
        <button class="tb-btn" title="New To-Do (Space)" aria-label="New To-Do" disabled={!view?.defaults} onClick={() => newTodo(view)}>
          <IconPlus />
        </button>
        <button class="tb-btn" title="When (⌘S)" aria-label="When" disabled={!sel.length} onClick={(e) => setPop({ kind: "when", anchor: anchorOf(e.currentTarget) })}>
          <IconCalendar />
        </button>
        <button class="tb-btn" title="Move (⌥M)" aria-label="Move" disabled={!sel.length} onClick={(e) => setPop({ kind: "move", anchor: anchorOf(e.currentTarget) })}>
          <IconMove />
        </button>
        <button class="tb-btn" title="Quick Find (⌘F)" aria-label="Quick Find" onClick={() => set({ quickFind: true })}>
          <IconSearch />
        </button>
      </div>
      {view?.defaults && (
        <button class="magic-plus" aria-label="New To-Do" title="New To-Do" onClick={() => newTodo(view)}>
          <IconPlus />
        </button>
      )}
      {pop?.kind === "when" && <WhenPicker anchor={pop.anchor} task={sel.length === 1 ? ix.task(sel[0]!) : undefined} onPick={(c) => setWhen(sel, c)} onClose={() => setPop(null)} />}
      {pop?.kind === "move" && <MovePicker anchor={pop.anchor} onPick={(d) => moveTo(sel, d)} onClose={() => setPop(null)} />}
    </>
  );
}

let draftKey = 0;
/** Starts a new to-do below the selection (or at the top), with the list's defaults. */
export function newTodo(view: View | null) {
  if (!view?.defaults) return;
  const after = state.selected[state.selected.length - 1] ?? null;
  const ix = index();
  const afterTask = after ? ix.task(after) : undefined;
  const defaults = { ...view.defaults };
  // Inside a project heading or Today's evening, keep the new one there.
  if (afterTask?.headingId) defaults.headingId = afterTask.headingId;
  if (afterTask?.evening && state.route.kind === "list" && state.route.list === "today") defaults.evening = true;
  set({ draft: { key: ++draftKey, afterId: afterTask && afterTask.kind === "todo" ? after : null, defaults }, expanded: null });
}

export { IconFlag };
