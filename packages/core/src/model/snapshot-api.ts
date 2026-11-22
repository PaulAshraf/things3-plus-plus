// ThingsApi for the hosted Worker: reads come from the latest snapshot (instant, and they still
// work while the Mac sleeps); writes are sent to the Mac as relay actions.

import type { Action, ActionResult } from "../relay/protocol.js";
import { ThingsError } from "../things/errors.js";
import type {
  AreaSummary,
  ListName,
  NewProject,
  NewTodo,
  ProjectSummary,
  Ref,
  Status,
  TagSummary,
  ThingsApi,
  Todo,
  TodoPage,
  TodoUpdate,
} from "../things/types.js";
import { ThingsIndex } from "./queries.js";
import type { Snapshot, Task } from "./types.js";

export interface SnapshotApiDeps {
  snapshot(): Promise<Snapshot>;
  send(action: Action): Promise<ActionResult>;
}

const DEFAULT_LIMIT = 50;

function page(index: ThingsIndex, tasks: Task[], limit = DEFAULT_LIMIT): TodoPage {
  return { total: tasks.length, items: tasks.slice(0, limit).map((t) => index.toTodo(t)) };
}

export class SnapshotThingsApi implements ThingsApi {
  constructor(private readonly deps: SnapshotApiDeps) {}

  private async index(): Promise<ThingsIndex> {
    return new ThingsIndex(await this.deps.snapshot());
  }

  private async write(action: Action): Promise<Todo> {
    const res = await this.deps.send(action);
    if (!res.ok) throw new ThingsError(res.error ?? "Your Mac couldn't make that change.", "things_error");
    if (res.data && typeof res.data === "object" && "id" in res.data) return res.data as Todo;
    const id = res.id;
    if (!id) throw new ThingsError("Your Mac didn't say which item changed.", "things_error");
    return this.get(id);
  }

  async list(list: ListName, limit?: number): Promise<TodoPage> {
    const ix = await this.index();
    switch (list) {
      case "inbox":
        return page(ix, ix.inbox(), limit);
      case "today": {
        const t = ix.todayList();
        return page(ix, [...t.day, ...t.evening], limit);
      }
      case "upcoming":
        return page(ix, ix.upcoming().flatMap((g) => g.tasks), limit);
      case "anytime":
        return page(ix, ix.anytime().flatMap((g) => [...g.tasks, ...(g.children ?? []).flatMap((c) => c.tasks)]), limit);
      case "someday":
        return page(ix, ix.someday().flatMap((g) => [...g.tasks, ...(g.children ?? []).flatMap((c) => c.tasks)]), limit);
      case "logbook":
        return page(ix, ix.logbook().flatMap((g) => g.tasks), limit);
    }
  }

  private findProject(ix: ThingsIndex, ref: string): Task {
    const byId = ix.task(ref);
    if (byId?.kind === "project") return byId;
    const byName = ix.snapshot.tasks.find((t) => t.kind === "project" && !t.trashed && t.title === ref && t.status === "open")
      ?? ix.snapshot.tasks.find((t) => t.kind === "project" && !t.trashed && t.title === ref);
    if (!byName) throw new ThingsError(`No project found named or with id: ${ref}`, "not_found");
    return byName;
  }

  async project(ref: string, limit?: number): Promise<TodoPage & { container: Todo }> {
    const ix = await this.index();
    const p = this.findProject(ix, ref);
    const view = ix.project(p.id)!;
    const tasks = [...view.loose, ...view.headings.flatMap((h) => h.tasks)];
    return { ...page(ix, tasks, limit ?? 100), container: ix.toTodo(p) };
  }

  async area(ref: string, limit?: number): Promise<TodoPage & { container: Ref }> {
    const ix = await this.index();
    const area = ix.area(ref) ?? ix.areas.find((a) => a.title === ref);
    if (!area) throw new ThingsError(`No area found named or with id: ${ref}`, "not_found");
    const view = ix.areaView(area.id)!;
    return { ...page(ix, [...view.tasks, ...view.projects], limit ?? 100), container: { id: area.id, name: area.title } };
  }

  async search(query: string, opts: { includeCompleted?: boolean; limit?: number } = {}): Promise<TodoPage> {
    const ix = await this.index();
    return page(ix, ix.search(query, { includeCompleted: opts.includeCompleted }), opts.limit);
  }

  async get(id: string): Promise<Todo> {
    const ix = await this.index();
    const t = ix.task(id);
    if (!t || t.kind === "heading") throw new ThingsError(`No to-do or project found with id ${id}`, "not_found");
    return ix.toTodo(t);
  }

  async projects(area?: string): Promise<ProjectSummary[]> {
    const ix = await this.index();
    const areaId = area ? (ix.area(area)?.id ?? ix.areas.find((a) => a.title === area)?.id ?? "__none__") : undefined;
    return ix.projects(areaId).map((p) => {
      const a = p.areaId ? ix.area(p.areaId) : undefined;
      return { id: p.id, title: p.title, area: a ? { id: a.id, name: a.title } : null };
    });
  }

  async areas(): Promise<AreaSummary[]> {
    return (await this.index()).areas.map((a) => ({ id: a.id, title: a.title }));
  }

  async tags(): Promise<TagSummary[]> {
    const ix = await this.index();
    return ix.tags.map((t) => ({ id: t.id, title: t.title, parent: t.parentId ? (ix.tag(t.parentId)?.title ?? null) : null }));
  }

  addTodo(todo: NewTodo): Promise<Todo> {
    return this.write({ op: "addTodo", args: todo });
  }
  addProject(project: NewProject): Promise<Todo> {
    return this.write({ op: "addProject", args: project });
  }
  update(update: TodoUpdate): Promise<Todo> {
    return this.write({ op: "update", args: update });
  }
  setStatus(id: string, status: Status): Promise<Todo> {
    return this.write({ op: "setStatus", args: { id, status } });
  }
}
