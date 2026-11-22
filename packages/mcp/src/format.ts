import type { Todo, TodoPage } from "./things/types.js";

/** Payload the inline UI renders. Also returned as `structuredContent` so any client can use it. */
export type ViewPayload =
  | {
      view: "list";
      title: string;
      /** Source of the list, so the UI can refresh it. */
      source: { tool: string; args: Record<string, unknown> };
      total: number;
      items: Todo[];
    }
  | {
      view: "item";
      title: string;
      item: Todo;
    };

function box(t: Todo): string {
  if (t.status === "completed") return "[x]";
  if (t.status === "canceled") return "[-]";
  return "[ ]";
}

export function todoLine(t: Todo): string {
  const bits = [`${box(t)} ${t.kind === "project" ? "📁 " : ""}${t.title || "(untitled)"}`];
  const meta: string[] = [];
  if (t.project) meta.push(`project: ${t.project.name}`);
  else if (t.area) meta.push(`area: ${t.area.name}`);
  if (t.when) meta.push(`when: ${t.when}`);
  if (t.deadline) meta.push(`deadline: ${t.deadline}`);
  if (t.tags.length) meta.push(`tags: ${t.tags.join(", ")}`);
  meta.push(`id: ${t.id}`);
  bits.push(`(${meta.join(" · ")})`);
  return `- ${bits.join(" ")}`;
}

export function pageText(title: string, page: TodoPage): string {
  if (page.items.length === 0) return `${title}: nothing here.`;
  const more = page.total > page.items.length ? `\n…and ${page.total - page.items.length} more (raise "limit" to see them).` : "";
  return `${title} — ${page.total} item${page.total === 1 ? "" : "s"}\n${page.items.map(todoLine).join("\n")}${more}`;
}

export function itemText(prefix: string, t: Todo): string {
  const notes = t.notes ? `\nNotes:\n${t.notes}` : "";
  return `${prefix}\n${todoLine(t)}${notes}`;
}
