// Every Things list, computed from a Snapshot. Shared by the web app (instant navigation),
// the hosted MCP tools, and tests. Mirrors how Things itself decides what shows where.

import type { Todo } from "../things/types.js";
import type { Area, Snapshot, Tag, Task } from "./types.js";

/** Today's date (YYYY-MM-DD) in a time zone. Falls back to the runtime's zone if it's unknown. */
export function todayIn(timeZone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  }
}

export interface ListGroup {
  /** "none" = not in an area or project. */
  kind: "none" | "area" | "project";
  id: string | null;
  title: string;
  tasks: Task[];
  /** For areas: the area's projects that have something to show here. */
  children?: ListGroup[];
}

export interface DayGroup {
  day: string;
  tasks: Task[];
}

export interface ProjectView {
  project: Task;
  loose: Task[];
  headings: { heading: Task; tasks: Task[] }[];
  logged: Task[];
}

export interface AreaView {
  area: Area;
  tasks: Task[];
  projects: Task[];
}

const byIndex = (a: Task, b: Task) => a.index - b.index || a.title.localeCompare(b.title);
const byTodayIndex = (a: Task, b: Task) => a.todayIndex - b.todayIndex || a.index - b.index;
const byCompletedDesc = (a: Task, b: Task) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "");

export class ThingsIndex {
  readonly today: string;
  private readonly tasks = new Map<string, Task>();
  private readonly areasById = new Map<string, Area>();
  private readonly tagsById = new Map<string, Tag>();
  private readonly childrenOf = new Map<string, Task[]>();

  constructor(
    readonly snapshot: Snapshot,
    today?: string,
  ) {
    this.today = today ?? todayIn(snapshot.timeZone);
    for (const t of snapshot.tasks) this.tasks.set(t.id, t);
    for (const a of snapshot.areas) this.areasById.set(a.id, a);
    for (const t of snapshot.tags) this.tagsById.set(t.id, t);
    for (const t of snapshot.tasks) {
      const parent = this.projectIdOf(t);
      if (!parent) continue;
      const list = this.childrenOf.get(parent) ?? [];
      list.push(t);
      this.childrenOf.set(parent, list);
    }
  }

  // ----- lookups -----

  task(id: string): Task | undefined {
    return this.tasks.get(id);
  }
  area(id: string): Area | undefined {
    return this.areasById.get(id);
  }
  tag(id: string): Tag | undefined {
    return this.tagsById.get(id);
  }
  get areas(): Area[] {
    return [...this.snapshot.areas].sort((a, b) => a.index - b.index);
  }
  get tags(): Tag[] {
    return [...this.snapshot.tags].sort((a, b) => a.index - b.index || a.title.localeCompare(b.title));
  }
  tagNames(task: Task): string[] {
    return task.tags.map((id) => this.tagsById.get(id)?.title).filter((x): x is string => Boolean(x));
  }

  /** The project a task belongs to, directly or through a heading. */
  projectIdOf(task: Task): string | null {
    if (task.projectId) return task.projectId;
    if (task.headingId) return this.tasks.get(task.headingId)?.projectId ?? null;
    return null;
  }
  /** The area a task belongs to, directly or through its project. */
  areaIdOf(task: Task): string | null {
    if (task.areaId) return task.areaId;
    const p = this.projectIdOf(task);
    return p ? (this.tasks.get(p)?.areaId ?? null) : null;
  }

  // ----- predicates -----

  isOpen(t: Task): boolean {
    return t.status === "open" && !t.trashed && t.kind !== "heading";
  }
  isScheduledToday(t: Task): boolean {
    return t.when !== null && t.when <= this.today && t.start !== "inbox";
  }
  isOverdue(t: Task): boolean {
    return t.deadline !== null && t.deadline < this.today;
  }
  isDueToday(t: Task): boolean {
    return t.deadline !== null && t.deadline <= this.today;
  }
  /** False when the task lives in a project that is itself someday, upcoming, finished or trashed. */
  private parentActive(t: Task): boolean {
    const pid = this.projectIdOf(t);
    if (!pid) return true;
    const p = this.tasks.get(pid);
    if (!p) return true;
    if (!this.isOpen(p)) return false;
    if (p.start === "someday" && !this.isScheduledToday(p)) return false;
    return true;
  }

  // ----- built-in lists -----

  inbox(): Task[] {
    return this.snapshot.tasks.filter((t) => this.isOpen(t) && t.kind === "todo" && t.start === "inbox").sort(byIndex);
  }

  todayList(): { day: Task[]; evening: Task[] } {
    const items = this.snapshot.tasks
      .filter((t) => this.isOpen(t) && (this.isScheduledToday(t) || this.isDueToday(t)))
      .sort(byTodayIndex);
    return { day: items.filter((t) => !t.evening), evening: items.filter((t) => t.evening) };
  }

  /** Scheduled for later (and deadlines on their day), grouped by date. */
  upcoming(): DayGroup[] {
    const groups = new Map<string, Task[]>();
    for (const t of this.snapshot.tasks) {
      if (!this.isOpen(t)) continue;
      let day: string | null = null;
      if (t.when && t.when > this.today) day = t.when;
      else if (!t.when && t.deadline && t.deadline > this.today && t.start !== "someday") day = t.deadline;
      if (!day) continue;
      if (t.kind === "todo" && !this.parentActive(t) && this.projectIdOf(t)) {
        // A to-do in a future project shows with the project, not on its own.
        const p = this.tasks.get(this.projectIdOf(t)!);
        if (p && p.when && p.when > this.today) continue;
      }
      const list = groups.get(day) ?? [];
      list.push(t);
      groups.set(day, list);
    }
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, tasks]) => ({ day, tasks: tasks.sort(byIndex) }));
  }

  /** Everything you could do now, including Today's items. */
  anytime(): ListGroup[] {
    // Projects show as group headers here, not as rows.
    const visible = this.snapshot.tasks.filter(
      (t) =>
        this.isOpen(t) &&
        t.kind === "todo" &&
        t.start !== "inbox" &&
        (t.start === "anytime" || this.isScheduledToday(t)) &&
        !(t.when && t.when > this.today) &&
        this.parentActive(t),
    );
    return this.group(visible);
  }

  someday(): ListGroup[] {
    const visible = this.snapshot.tasks.filter(
      (t) => this.isOpen(t) && t.start === "someday" && t.when === null && (t.kind === "project" || this.parentActive(t) || !this.projectIdOf(t)),
    );
    // Children of a someday project are hidden; the project itself is listed.
    const somedayProjects = new Set(visible.filter((t) => t.kind === "project").map((t) => t.id));
    return this.group(visible.filter((t) => !somedayProjects.has(this.projectIdOf(t) ?? "")));
  }

  logbook(limit = 500): DayGroup[] {
    const done = this.snapshot.tasks
      .filter((t) => t.status !== "open" && !t.trashed && t.kind !== "heading")
      .sort(byCompletedDesc)
      .slice(0, limit);
    const groups = new Map<string, Task[]>();
    for (const t of done) {
      const day = (t.completedAt ?? "").slice(0, 10) || "unknown";
      const list = groups.get(day) ?? [];
      list.push(t);
      groups.set(day, list);
    }
    return [...groups.entries()].map(([day, tasks]) => ({ day, tasks }));
  }

  trash(): Task[] {
    return this.snapshot.tasks.filter((t) => t.trashed && t.kind !== "heading").sort(byCompletedDesc);
  }

  // ----- containers -----

  /** Open projects, in sidebar order. */
  projects(areaId?: string | null): Task[] {
    return this.snapshot.tasks
      .filter((t) => t.kind === "project" && this.isOpen(t) && (areaId === undefined || (t.areaId ?? null) === areaId))
      .sort(byIndex);
  }

  project(id: string): ProjectView | null {
    const project = this.tasks.get(id);
    if (!project || project.kind !== "project") return null;
    const children = this.childrenOf.get(id) ?? [];
    const headings = children.filter((t) => t.kind === "heading" && !t.trashed && t.status === "open").sort(byIndex);
    const headingIds = new Set(headings.map((h) => h.id));
    const open = children.filter((t) => t.kind === "todo" && this.isOpen(t));
    return {
      project,
      loose: open.filter((t) => !t.headingId || !headingIds.has(t.headingId)).sort(byIndex),
      headings: headings.map((heading) => ({ heading, tasks: open.filter((t) => t.headingId === heading.id).sort(byIndex) })),
      logged: children.filter((t) => t.kind === "todo" && t.status !== "open" && !t.trashed).sort(byCompletedDesc),
    };
  }

  /** Done / total to-dos in a project (for the progress pie). */
  progress(projectId: string): { done: number; total: number } {
    const kids = (this.childrenOf.get(projectId) ?? []).filter((t) => t.kind === "todo" && !t.trashed);
    const done = kids.filter((t) => t.status !== "open").length;
    return { done, total: kids.length };
  }

  areaView(id: string): AreaView | null {
    const area = this.areasById.get(id);
    if (!area) return null;
    const tasks = this.snapshot.tasks
      .filter((t) => t.kind === "todo" && this.isOpen(t) && t.areaId === id && !this.projectIdOf(t) && t.start !== "inbox")
      .sort(byIndex);
    return { area, tasks, projects: this.projects(id) };
  }

  /** Open items with a tag. */
  tagged(tagId: string): Task[] {
    return this.snapshot.tasks.filter((t) => this.isOpen(t) && t.tags.includes(tagId)).sort(byIndex);
  }

  search(query: string, opts: { includeCompleted?: boolean; limit?: number } = {}): Task[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: Task[] = [];
    for (const t of this.snapshot.tasks) {
      if (t.kind === "heading" || t.trashed) continue;
      if (!opts.includeCompleted && t.status !== "open") continue;
      const hay = `${t.title}\n${t.notes}\n${t.checklist.map((c) => c.title).join("\n")}`.toLowerCase();
      if (hay.includes(q)) out.push(t);
    }
    // Title matches first, then open before done.
    out.sort((a, b) => {
      const at = a.title.toLowerCase().includes(q) ? 0 : 1;
      const bt = b.title.toLowerCase().includes(q) ? 0 : 1;
      return at - bt || (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1) || byIndex(a, b);
    });
    return opts.limit ? out.slice(0, opts.limit) : out;
  }

  /** Inbox count and Today count, for the sidebar badges. */
  counts(): { inbox: number; today: number; overdue: number } {
    const t = this.todayList();
    const all = [...t.day, ...t.evening];
    return { inbox: this.inbox().length, today: all.length, overdue: all.filter((x) => this.isOverdue(x)).length };
  }

  private group(tasks: Task[]): ListGroup[] {
    const loose: Task[] = [];
    const byProject = new Map<string, Task[]>();
    const byArea = new Map<string, Task[]>();
    for (const t of tasks) {
      const pid = t.kind === "todo" ? this.projectIdOf(t) : null;
      if (pid) {
        const l = byProject.get(pid) ?? [];
        l.push(t);
        byProject.set(pid, l);
      } else if (t.areaId) {
        const l = byArea.get(t.areaId) ?? [];
        l.push(t);
        byArea.set(t.areaId, l);
      } else loose.push(t);
    }
    const projectGroup = (p: Task): ListGroup => ({ kind: "project", id: p.id, title: p.title, tasks: (byProject.get(p.id) ?? []).sort(byIndex) });
    const projectsWithItems = (areaId: string | null) =>
      this.snapshot.tasks
        .filter((p) => p.kind === "project" && byProject.has(p.id) && (p.areaId ?? null) === areaId)
        .sort(byIndex);

    const groups: ListGroup[] = [];
    if (loose.length) groups.push({ kind: "none", id: null, title: "", tasks: loose.sort(byIndex) });
    for (const p of projectsWithItems(null)) groups.push(projectGroup(p));
    for (const a of this.areas) {
      const children = projectsWithItems(a.id).map(projectGroup);
      const own = (byArea.get(a.id) ?? []).sort(byIndex);
      if (own.length || children.length) groups.push({ kind: "area", id: a.id, title: a.title, tasks: own, children });
    }
    return groups;
  }

  // ----- MCP shape -----

  /** The task in the shape the MCP tools return. */
  toTodo(t: Task): Todo {
    const pid = this.projectIdOf(t);
    const project = pid ? this.tasks.get(pid) : undefined;
    const aid = t.areaId ?? null;
    const area = aid ? this.areasById.get(aid) : undefined;
    return {
      id: t.id,
      kind: t.kind === "project" ? "project" : "todo",
      title: t.title,
      notes: t.notes,
      status: t.status,
      when: t.when,
      deadline: t.deadline,
      tags: this.tagNames(t),
      project: project ? { id: project.id, name: project.title } : null,
      area: area ? { id: area.id, name: area.title } : null,
      createdAt: t.createdAt,
      modifiedAt: t.modifiedAt,
      completedAt: t.completedAt,
    };
  }
}
