export const LISTS = ["inbox", "today", "upcoming", "anytime", "someday", "logbook"] as const;
export type ListName = (typeof LISTS)[number];

export type Status = "open" | "completed" | "canceled";

export interface Ref {
  id: string;
  name: string;
}

/** A to-do or project as returned by Things. Dates are local `YYYY-MM-DD`, timestamps are ISO. */
export interface Todo {
  id: string;
  kind: "todo" | "project";
  title: string;
  notes: string;
  status: Status;
  /** Scheduled ("When") date. */
  when: string | null;
  deadline: string | null;
  tags: string[];
  project: Ref | null;
  area: Ref | null;
  createdAt: string | null;
  modifiedAt: string | null;
  completedAt: string | null;
}

export interface TodoPage {
  total: number;
  items: Todo[];
}

export interface ProjectSummary {
  id: string;
  title: string;
  area: Ref | null;
}

export interface AreaSummary {
  id: string;
  title: string;
}

export interface TagSummary {
  id: string;
  title: string;
  parent: string | null;
}

/** `today` | `anytime` | `someday` | `inbox` | `YYYY-MM-DD` (resolved from friendlier input before reaching Things). */
export type When = "today" | "anytime" | "someday" | "inbox" | (string & {});

export interface NewTodo {
  title: string;
  notes?: string;
  when?: When;
  deadline?: string;
  tags?: string[];
  /** Project id or exact name. */
  project?: string;
  /** Area id or exact name. Ignored when `project` is set. */
  area?: string;
}

export interface NewProject {
  title: string;
  notes?: string;
  when?: When;
  deadline?: string;
  tags?: string[];
  area?: string;
  todos?: string[];
}

export interface TodoUpdate {
  id: string;
  title?: string;
  notes?: string;
  when?: When;
  /** `null` clears the deadline. */
  deadline?: string | null;
  /** Replaces all tags. */
  tags?: string[];
  project?: string;
  area?: string;
}

/**
 * Everything the MCP tools need from Things. Implemented locally by ThingsClient (osascript) and,
 * in the hosted Worker, by a relay that forwards writes to the user's Mac.
 * There is deliberately no delete/trash method here.
 */
export interface ThingsApi {
  list(list: ListName, limit?: number): Promise<TodoPage>;
  project(project: string, limit?: number): Promise<TodoPage & { container: Todo }>;
  area(area: string, limit?: number): Promise<TodoPage & { container: Ref }>;
  search(query: string, opts?: { includeCompleted?: boolean; limit?: number }): Promise<TodoPage>;
  get(id: string): Promise<Todo>;
  projects(area?: string): Promise<ProjectSummary[]>;
  areas(): Promise<AreaSummary[]>;
  tags(): Promise<TagSummary[]>;
  addTodo(todo: NewTodo): Promise<Todo>;
  addProject(project: NewProject): Promise<Todo>;
  update(update: TodoUpdate): Promise<Todo>;
  setStatus(id: string, status: Status): Promise<Todo>;
}
