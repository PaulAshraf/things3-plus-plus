// Development only: a believable sample database so the UI can be built and screenshotted without
// a Mac. Loaded with ?demo during `cf dev`; never included in production builds.
import type { Area, Snapshot, Tag, Task } from "things3pp-core/model/types";
import type { Action, ActionResult } from "things3pp-core/relay/protocol";
import { addDays, dayOf } from "./dates.ts";

let n = 0;
const today = dayOf(new Date());

function task(p: Partial<Task> & { title: string }): Task {
  n++;
  return {
    id: p.id ?? `demo${n}`,
    kind: "todo",
    notes: "",
    status: "open",
    start: "anytime",
    when: null,
    evening: false,
    deadline: null,
    reminder: null,
    areaId: null,
    projectId: null,
    headingId: null,
    tags: [],
    checklist: [],
    index: n,
    todayIndex: n,
    repeating: false,
    trashed: false,
    createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
    modifiedAt: new Date(Date.now() - 86400000).toISOString(),
    completedAt: null,
    ...p,
  };
}

const tags: Tag[] = [
  { id: "t-errand", title: "Errand", parentId: null, shortcut: null, index: 1 },
  { id: "t-home", title: "Home", parentId: null, shortcut: null, index: 2 },
  { id: "t-office", title: "Office", parentId: null, shortcut: null, index: 3 },
  { id: "t-15", title: "15 min", parentId: null, shortcut: null, index: 4 },
  { id: "t-wait", title: "Waiting", parentId: null, shortcut: null, index: 5 },
];
const areas: Area[] = [
  { id: "a-home", title: "Home", index: 1, tags: [] },
  { id: "a-work", title: "Work", index: 2, tags: [] },
  { id: "a-health", title: "Health", index: 3, tags: [] },
];

export function demoSnapshot(): Snapshot {
  n = 0;
  const tasks: Task[] = [
    // projects
    task({ id: "p-garden", kind: "project", title: "Spring garden", areaId: "a-home", notes: "Raised beds by the fence, herbs near the kitchen door." }),
    task({ id: "p-launch", kind: "project", title: "Website relaunch", areaId: "a-work", deadline: addDays(today, 12) }),
    task({ id: "p-trip", kind: "project", title: "Lisbon trip", start: "anytime" }),
    task({ id: "p-run", kind: "project", title: "10K training plan", areaId: "a-health" }),
    task({ id: "p-book", kind: "project", title: "Learn watercolor", start: "someday", areaId: "a-home" }),
    // headings
    task({ id: "h-design", kind: "heading", title: "Design", projectId: "p-launch" }),
    task({ id: "h-content", kind: "heading", title: "Content", projectId: "p-launch" }),
    task({ id: "h-before", kind: "heading", title: "Before we go", projectId: "p-trip" }),
    // inbox
    task({ title: "Look into a standing desk", start: "inbox" }),
    task({ title: "Recipe from Maya — lemon orzo", start: "inbox", notes: "She said to use a lot of parmesan." }),
    task({ title: "Return library books", start: "inbox", tags: ["t-errand"] }),
    // today
    task({ title: "Call the plumber about the kitchen tap", when: today, tags: ["t-home"], todayIndex: 1 }),
    task({ title: "Review homepage wireframes", when: today, headingId: "h-design", todayIndex: 2, notes: "Focus on the hero and pricing sections.", checklist: [
      { id: "c1", title: "Hero copy", done: true },
      { id: "c2", title: "Pricing table", done: false },
      { id: "c3", title: "Mobile nav", done: false },
    ] }),
    task({ title: "Book flights", when: today, projectId: "p-trip", deadline: addDays(today, 2), todayIndex: 3 }),
    task({ title: "Pick up dry cleaning", when: today, tags: ["t-errand", "t-15"], todayIndex: 4 }),
    task({ title: "Easy 5 km run", when: today, projectId: "p-run", todayIndex: 5, repeating: true }),
    task({ title: "Water the seedlings", when: today, evening: true, projectId: "p-garden", todayIndex: 6 }),
    task({ title: "Read two chapters", when: today, evening: true, todayIndex: 7 }),
    task({ title: "Send invoice to Northwind", when: addDays(today, -1), areaId: "a-work", deadline: addDays(today, -1), todayIndex: 0 }),
    // upcoming
    task({ title: "Dentist appointment", when: addDays(today, 1), start: "someday", areaId: "a-health", reminder: "09:30" }),
    task({ title: "Team retro", when: addDays(today, 2), start: "someday", areaId: "a-work" }),
    task({ title: "Order compost", when: addDays(today, 2), start: "someday", projectId: "p-garden" }),
    task({ title: "Renew passport photos", when: addDays(today, 4), start: "someday", projectId: "p-trip", headingId: "h-before" }),
    task({ title: "Mom's birthday dinner", when: addDays(today, 9), start: "someday", tags: ["t-home"] }),
    task({ title: "Quarterly taxes", when: addDays(today, 24), start: "someday", areaId: "a-work", deadline: addDays(today, 30) }),
    // anytime
    task({ title: "Build the second raised bed", projectId: "p-garden" }),
    task({ title: "Sketch a planting map", projectId: "p-garden", notes: "Tomatoes need the most sun." }),
    task({ title: "Pick a color palette", headingId: "h-design" }),
    task({ title: "Write the About page", headingId: "h-content", tags: ["t-office"] }),
    task({ title: "Collect customer quotes", headingId: "h-content", tags: ["t-wait"] }),
    task({ title: "Find a place near Alfama", headingId: "h-before" }),
    task({ title: "Make a list of pastelarias", projectId: "p-trip" }),
    task({ title: "Interval session: 6 × 400 m", projectId: "p-run" }),
    task({ title: "Fix the squeaky door", areaId: "a-home", tags: ["t-home", "t-15"] }),
    task({ title: "Update CV", areaId: "a-work" }),
    task({ title: "Back up photos" }),
    // someday
    task({ title: "Learn to bake sourdough", start: "someday" }),
    task({ title: "Kayak trip on the lake", start: "someday", areaId: "a-health" }),
    task({ title: "Buy a brush set", projectId: "p-book", start: "someday" }),
    // logbook
    task({ title: "Pay electricity bill", status: "completed", completedAt: new Date().toISOString(), areaId: "a-home" }),
    task({ title: "Draft launch announcement", status: "completed", completedAt: new Date(Date.now() - 86400000).toISOString(), headingId: "h-content" }),
    task({ title: "Long run: 8 km", status: "completed", completedAt: new Date(Date.now() - 86400000 * 2).toISOString(), projectId: "p-run" }),
    task({ title: "Buy seed potatoes", status: "completed", completedAt: new Date(Date.now() - 86400000 * 3).toISOString(), projectId: "p-garden" }),
    task({ title: "Cancel old gym membership", status: "canceled", completedAt: new Date(Date.now() - 86400000 * 3).toISOString(), areaId: "a-health" }),
  ];
  return { rev: 1, generatedAt: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, tasks, areas, tags, capabilities: { urlScheme: true } };
}

/** Pretend to be the Mac: apply an action to the snapshot. */
export function demoApply(snap: Snapshot, action: Action): { snapshot: Snapshot; result: ActionResult } {
  const tasks = snap.tasks.map((t) => ({ ...t }));
  const find = (id: string) => tasks.find((t) => t.id === id);
  const tagIds = (names?: string[]) => names?.map((nm) => snap.tags.find((t) => t.title === nm)?.id).filter((x): x is string => Boolean(x));
  const applyWhen = (t: Task, when?: string) => {
    if (!when) return;
    if (when === "today") Object.assign(t, { when: today, start: "anytime", evening: false });
    else if (when === "anytime") Object.assign(t, { when: null, start: "anytime" });
    else if (when === "someday") Object.assign(t, { when: null, start: "someday" });
    else if (when === "inbox") Object.assign(t, { when: null, start: "inbox" });
    else Object.assign(t, { when, start: when > today ? "someday" : "anytime" });
  };
  let id: string | undefined;
  switch (action.op) {
    case "addTodo": {
      const a = action.args;
      const t = task({ id: `demo-new-${Date.now()}`, title: a.title, notes: a.notes ?? "", start: "inbox", projectId: a.project ?? null, areaId: a.area ?? null, headingId: a.headingId ?? null, tags: tagIds(a.tags) ?? [], checklist: (a.checklist ?? []).map((c, i) => ({ id: `nc${i}`, title: c, done: false })) });
      if (t.projectId || t.areaId) t.start = "anytime";
      applyWhen(t, a.when);
      if (a.evening) Object.assign(t, { when: today, evening: true, start: "anytime" });
      t.index = 0;
      tasks.push(t);
      id = t.id;
      break;
    }
    case "update": {
      const t = find(action.args.id);
      if (!t) return { snapshot: snap, result: { ok: false, error: "Not found" } };
      const a = action.args;
      if (a.title !== undefined) t.title = a.title;
      if (a.notes !== undefined) t.notes = a.notes;
      if (a.deadline !== undefined) t.deadline = a.deadline;
      if (a.tags) t.tags = tagIds(a.tags) ?? [];
      if (a.project) Object.assign(t, { projectId: a.project, areaId: null, headingId: null });
      if (a.area) Object.assign(t, { areaId: a.area, projectId: null, headingId: null });
      applyWhen(t, a.when);
      if (a.evening === true) Object.assign(t, { when: today, evening: true, start: "anytime" });
      if (a.evening === false) t.evening = false;
      id = t.id;
      break;
    }
    case "setStatus": {
      const t = find(action.args.id);
      if (t) Object.assign(t, { status: action.args.status, completedAt: action.args.status === "open" ? null : new Date().toISOString() });
      id = action.args.id;
      break;
    }
    case "setChecklist": {
      const t = find(action.args.id);
      if (t) t.checklist = action.args.items.map((it, i) => ({ id: `${t.id}-c${i}-${Date.now()}`, ...it }));
      id = action.args.id;
      break;
    }
    default:
      break;
  }
  for (const t of tasks) if (t.id === id) t.modifiedAt = new Date().toISOString();
  return { snapshot: { ...snap, rev: snap.rev + 1, tasks }, result: { ok: true, id } };
}
