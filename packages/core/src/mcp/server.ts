import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { LISTS, type ListName, type ThingsApi, type Todo, type TodoPage } from "../things/types.js";
import { itemText, pageText, type ViewPayload } from "../format.js";
import { resolveWhen, isValidDay, WHEN_KEYWORDS } from "../when.js";

export const VIEW_URI = "ui://things/view.html";

const LIST_TITLES: Record<ListName, string> = {
  inbox: "Inbox",
  today: "Today",
  upcoming: "Upcoming",
  anytime: "Anytime",
  someday: "Someday",
  logbook: "Logbook",
};

const INSTRUCTIONS = `Read and organise the user's Things 3 to-dos.
- "What's on my plate?" → show_list with list "today". Use search_todos to find items by text.
- Ids come from earlier results; never invent them. Projects and areas can be referenced by exact name or id.
- Dates are local calendar days (YYYY-MM-DD). "when" also accepts today, tomorrow, anytime, someday, inbox.
- Results render as an interactive Things-style card in apps that support MCP Apps, so don't repeat the whole list back unless asked.
- Deleting is intentionally not supported. To get rid of something, complete it, or tell the user to delete it in Things.`;


// ---------- shared schemas ----------

const id = z.string().min(1).max(200).describe("Things id from an earlier result.");
const limit = z.number().int().min(1).max(500).optional().describe("Max items to return (default 50).");
const when = z
  .string()
  .max(20)
  .refine((v) => (WHEN_KEYWORDS as readonly string[]).includes(v.toLowerCase()) || isValidDay(v), {
    message: "Use today, tomorrow, anytime, someday, inbox, or YYYY-MM-DD.",
  })
  .describe("When to do it: today, tomorrow, anytime, someday, inbox, or a date (YYYY-MM-DD).");
const day = z
  .string()
  .refine(isValidDay, { message: "Use a real date as YYYY-MM-DD." })
  .describe("Calendar date, YYYY-MM-DD.");
const tags = z
  .array(z.string().min(1).max(100))
  .max(50)
  .describe("Tag names. Tags must already exist in Things; unknown tags are ignored by Things.");
const title = z.string().trim().min(1).max(1000);
const notes = z.string().max(10_000).describe("Notes (Markdown is fine).");
const containerRef = z.string().min(1).max(500);

// ---------- result helpers ----------

function listResult(heading: string, page: TodoPage, source: { tool: string; args: Record<string, unknown> }): CallToolResult {
  const payload: ViewPayload = { view: "list", title: heading, source, total: page.total, items: page.items };
  return {
    content: [{ type: "text", text: pageText(heading, page) }],
    structuredContent: payload as unknown as Record<string, unknown>,
  };
}

function itemResult(heading: string, item: Todo): CallToolResult {
  const payload: ViewPayload = { view: "item", title: heading, item };
  return {
    content: [{ type: "text", text: itemText(heading, item) }],
    structuredContent: payload as unknown as Record<string, unknown>,
  };
}

function errorResult(err: unknown): CallToolResult {
  const message = err instanceof Error ? err.message : `Unexpected error: ${String(err)}`;
  return { isError: true, content: [{ type: "text", text: message }] };
}

async function guard(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await fn();
  } catch (err) {
    return errorResult(err);
  }
}

const READ = { readOnlyHint: true, openWorldHint: false } as const;
const ui = { ui: { resourceUri: VIEW_URI } };

// ---------- server ----------

export interface ServerOptions {
  things: ThingsApi;
  /** The bundled MCP App HTML (dist/ui/view.html). */
  viewHtml: () => string | Promise<string>;
  version: string;
}

export function createServer({ things, viewHtml, version }: ServerOptions): McpServer {
  const server = new McpServer({ name: "things3pp", title: "Things 3", version }, { instructions: INSTRUCTIONS });

  registerAppResource(
    server,
    "Things view",
    VIEW_URI,
    { description: "Interactive Things-style list and to-do card." },
    async () => ({
      contents: [
        {
          uri: VIEW_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await viewHtml(),
          _meta: { ui: { prefersBorder: true } },
        },
      ],
    }),
  );

  // ----- read -----

  registerAppTool(
    server,
    "show_list",
    {
      title: "Show a Things list",
      description: "Show the to-dos in one of the built-in Things lists: inbox, today, upcoming, anytime, someday or logbook.",
      inputSchema: z.object({ list: z.enum(LISTS), limit }),
      annotations: READ,
      _meta: ui,
    },
    async ({ list, limit }) =>
      guard(async () => listResult(LIST_TITLES[list], await things.list(list, limit), { tool: "show_list", args: { list, limit } })),
  );

  registerAppTool(
    server,
    "show_project",
    {
      title: "Show a project",
      description: "Show the open to-dos in a project, by project name or id.",
      inputSchema: z.object({ project: containerRef.describe("Project name or id."), limit }),
      annotations: READ,
      _meta: ui,
    },
    async ({ project, limit }) =>
      guard(async () => {
        const res = await things.project(project, limit);
        return listResult(res.container.title, res, { tool: "show_project", args: { project: res.container.id, limit } });
      }),
  );

  registerAppTool(
    server,
    "show_area",
    {
      title: "Show an area",
      description: "Show the to-dos and projects in an area of responsibility, by area name or id.",
      inputSchema: z.object({ area: containerRef.describe("Area name or id."), limit }),
      annotations: READ,
      _meta: ui,
    },
    async ({ area, limit }) =>
      guard(async () => {
        const res = await things.area(area, limit);
        return listResult(res.container.name, res, { tool: "show_area", args: { area: res.container.id, limit } });
      }),
  );

  registerAppTool(
    server,
    "search_todos",
    {
      title: "Search to-dos",
      description: "Find to-dos and projects whose title or notes contain some text. Open items only unless includeCompleted is true.",
      inputSchema: z.object({
        query: z.string().trim().min(1).max(200),
        includeCompleted: z.boolean().optional(),
        limit,
      }),
      annotations: READ,
      _meta: ui,
    },
    async ({ query, includeCompleted, limit }) =>
      guard(async () =>
        listResult(`Search: “${query}”`, await things.search(query, { includeCompleted, limit }), {
          tool: "search_todos",
          args: { query, includeCompleted, limit },
        }),
      ),
  );

  registerAppTool(
    server,
    "get_todo",
    {
      title: "Get a to-do",
      description: "Get one to-do or project by id, including its notes.",
      inputSchema: z.object({ id }),
      annotations: READ,
      _meta: ui,
    },
    async ({ id }) => guard(async () => itemResult("To-do", await things.get(id))),
  );

  server.registerTool(
    "list_projects",
    {
      title: "List projects",
      description: "List open projects (id, title, area). Optionally only those in one area (name or id).",
      inputSchema: z.object({ area: containerRef.optional() }),
      annotations: READ,
    },
    async ({ area }) =>
      guard(async () => {
        const projects = await things.projects(area);
        const text = projects.length
          ? projects.map((p) => `- ${p.title}${p.area ? ` (area: ${p.area.name})` : ""} · id: ${p.id}`).join("\n")
          : "No open projects.";
        return { content: [{ type: "text", text }], structuredContent: { projects } };
      }),
  );

  server.registerTool(
    "list_areas",
    {
      title: "List areas",
      description: "List all areas of responsibility (id, title).",
      annotations: READ,
    },
    async () =>
      guard(async () => {
        const areas = await things.areas();
        const text = areas.length ? areas.map((a) => `- ${a.title} · id: ${a.id}`).join("\n") : "No areas.";
        return { content: [{ type: "text", text }], structuredContent: { areas } };
      }),
  );

  server.registerTool(
    "list_tags",
    {
      title: "List tags",
      description: "List all tags. Use these exact names when tagging to-dos.",
      annotations: READ,
    },
    async () =>
      guard(async () => {
        const tags = await things.tags();
        const text = tags.length
          ? tags.map((t) => `- ${t.title}${t.parent ? ` (in ${t.parent})` : ""}`).join("\n")
          : "No tags.";
        return { content: [{ type: "text", text }], structuredContent: { tags } };
      }),
  );

  // ----- write (no deletes, by design) -----

  registerAppTool(
    server,
    "add_todo",
    {
      title: "Add a to-do",
      description: "Create a to-do. Without when/project/area it lands in the Inbox.",
      inputSchema: z.object({
        title,
        notes: notes.optional(),
        when: when.optional(),
        deadline: day.optional(),
        tags: tags.optional(),
        project: containerRef.optional().describe("Project name or id to put it in."),
        area: containerRef.optional().describe("Area name or id (ignored if project is set)."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: ui,
    },
    async (args) =>
      guard(async () => itemResult("Added to Things", await things.addTodo({ ...args, when: resolveWhen(args.when) }))),
  );

  registerAppTool(
    server,
    "add_project",
    {
      title: "Add a project",
      description: "Create a project, optionally with starter to-dos.",
      inputSchema: z.object({
        title,
        notes: notes.optional(),
        when: when.optional(),
        deadline: day.optional(),
        tags: tags.optional(),
        area: containerRef.optional().describe("Area name or id."),
        todos: z.array(title).max(100).optional().describe("Titles of to-dos to create inside the project."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      _meta: ui,
    },
    async (args) =>
      guard(async () => itemResult("Project created", await things.addProject({ ...args, when: resolveWhen(args.when) }))),
  );

  registerAppTool(
    server,
    "update_todo",
    {
      title: "Update a to-do",
      description:
        "Change a to-do or project. Only the fields you pass change. tags replaces all tags; deadline null clears it; project/area moves it.",
      inputSchema: z.object({
        id,
        title: title.optional(),
        notes: notes.optional(),
        when: when.optional(),
        deadline: day.nullable().optional(),
        tags: tags.optional(),
        project: containerRef.optional().describe("Move into this project (name or id)."),
        area: containerRef.optional().describe("Move into this area (name or id)."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      _meta: ui,
    },
    async (args) => guard(async () => itemResult("Updated", await things.update({ ...args, when: resolveWhen(args.when) }))),
  );

  registerAppTool(
    server,
    "complete_todo",
    {
      title: "Complete a to-do",
      description: "Mark a to-do or project as completed. Reversible with reopen_todo.",
      inputSchema: z.object({ id }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: ui,
    },
    async ({ id }) => guard(async () => itemResult("Completed", await things.setStatus(id, "completed"))),
  );

  registerAppTool(
    server,
    "reopen_todo",
    {
      title: "Reopen a to-do",
      description: "Mark a completed or canceled to-do as open again.",
      inputSchema: z.object({ id }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: ui,
    },
    async ({ id }) => guard(async () => itemResult("Reopened", await things.setStatus(id, "open"))),
  );

  return server;
}
