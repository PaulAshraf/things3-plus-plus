import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { Task } from "things3pp-core/model/types";
import { deadlineText, isoToDay, shortWhen } from "../dates.ts";
import {
  IconCalendar,
  IconCheck,
  IconChecklist,
  IconEvening,
  IconFlag,
  IconMove,
  IconNotes,
  IconRepeat,
  IconSomeday,
  IconTag,
  IconToday,
  IconX,
  Pie,
} from "../icons.tsx";
import {
  createTodo,
  currentDay,
  displayStatus,
  index,
  isLeaving,
  moveTo,
  select,
  set,
  setChecklist,
  setDeadline,
  setNotes,
  setTags,
  setTitle,
  setWhen,
  state,
  toggleComplete,
  navigate,
  type Draft,
} from "../store.ts";
import { anchorOf, type Anchor } from "./Popover.tsx";
import { DeadlinePicker, MovePicker, TagPicker, WhenPicker } from "./Pickers.tsx";

/** What the surrounding list already says, so rows don't repeat it. */
export interface RowContext {
  showParent: boolean;
  showWhen: boolean;
  /** Logbook: show the completion date instead. */
  logbook?: boolean;
  visibleIds: string[];
}

// ---------- shared bits ----------

export function Checkbox({ task, onToggle }: { task: Task; onToggle: (e: MouseEvent) => void }) {
  const status = displayStatus(task);
  const [burst, setBurst] = useState(false);
  const today = currentDay();
  if (task.kind === "project") {
    const p = index().progress(task.id);
    return (
      <button class="check project" style={{ border: 0, background: "none" }} aria-label="Project" onClick={onToggle}>
        <Pie done={status === "open" ? p.done : p.total || 1} total={p.total || 1} />
      </button>
    );
  }
  return (
    <button
      class={`check${status === "completed" ? " on" : ""}${status === "canceled" ? " canceled" : ""}${burst ? " burst" : ""}${status === "open" && task.deadline && task.deadline <= today ? " today-due" : ""}`}
      role="checkbox"
      aria-checked={status !== "open"}
      aria-label={status === "open" ? "Complete" : "Mark as open"}
      onClick={(e) => {
        e.stopPropagation();
        if (status === "open") {
          setBurst(true);
          setTimeout(() => setBurst(false), 500);
        }
        onToggle(e);
      }}
    >
      {status === "canceled" ? <IconX /> : <IconCheck />}
    </button>
  );
}

function WhenChip({ task }: { task: Task }) {
  const today = currentDay();
  if (task.when && task.when <= today) {
    return (
      <span class="when-chip today" title={task.evening ? "This Evening" : "Today"}>
        {task.evening ? <IconEvening /> : <IconToday />}
      </span>
    );
  }
  if (task.when) return <span class="when-chip">{shortWhen(task.when, today)}</span>;
  if (task.start === "someday") return <span class="when-chip" title="Someday"><IconSomeday style={{ width: "13px", height: "13px" }} /></span>;
  return null;
}

function Deadline({ day }: { day: string }) {
  const d = deadlineText(day, currentDay());
  return (
    <span class={`deadline ${d.tone}`}>
      <IconFlag /> {d.text}
    </span>
  );
}

function parentLabel(task: Task): string | null {
  const ix = index();
  const pid = ix.projectIdOf(task);
  if (pid) return ix.task(pid)?.title || "New Project";
  if (task.areaId) return ix.area(task.areaId)?.title ?? null;
  return null;
}

// ---------- row ----------

export function TodoItem({ task, ctx }: { task: Task; ctx: RowContext }) {
  const expanded = state.expanded === task.id;
  if (expanded && task.kind === "todo") return <TodoCard task={task} />;
  const selected = state.selected.includes(task.id);
  const status = displayStatus(task);
  const ix = index();
  const parent = ctx.showParent ? parentLabel(task) : null;
  const tags = task.tags.map((id) => ix.tag(id)?.title).filter(Boolean) as string[];
  const isProject = task.kind === "project";

  const open = () => {
    if (isProject) navigate({ kind: "project", id: task.id });
    else set({ expanded: task.id, selected: [task.id] });
  };

  return (
    <div
      class={`row${selected ? " selected" : ""}${status !== "open" ? " done" : ""}${isLeaving(task.id) ? " leaving" : ""}`}
      data-id={task.id}
      draggable={!task.id.startsWith("tmp_")}
      onDragStart={(e) => {
        const ids = state.selected.includes(task.id) ? state.selected : [task.id];
        e.dataTransfer?.setData("application/x-things-ids", JSON.stringify(ids));
        e.dataTransfer?.setData("text/plain", task.title);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
        (e.currentTarget as HTMLElement).classList.add("dragging");
      }}
      onDragEnd={(e) => (e.currentTarget as HTMLElement).classList.remove("dragging")}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) select(task.id, "toggle");
        else if (e.shiftKey) select(task.id, "range", ctx.visibleIds);
        else if (window.matchMedia("(max-width: 760px)").matches) open();
        else select(task.id);
      }}
      onDblClick={open}
    >
      <Checkbox task={task} onToggle={() => (isProject ? navigate({ kind: "project", id: task.id }) : toggleComplete(task.id))} />
      <div class="row-main">
        <div class="row-line">
          {ctx.showWhen && status === "open" && <WhenChip task={task} />}
          <span class={`row-title${task.title ? "" : " empty"}`} style={isProject ? { fontWeight: 600 } : undefined}>
            {task.title || (isProject ? "New Project" : "New To-Do")}
          </span>
          <span class="row-icons">
            {task.repeating && <IconRepeat />}
            {task.notes && <IconNotes />}
            {task.checklist.length > 0 && <IconChecklist />}
          </span>
          <span class="row-right">
            {tags.slice(0, 3).map((t) => (
              <span key={t} class="tag">
                {t}
              </span>
            ))}
            {tags.length > 3 && <span class="tag">+{tags.length - 3}</span>}
            {task.deadline && status === "open" && <Deadline day={task.deadline} />}
            {ctx.logbook && task.completedAt && <span class="logged-time">{shortWhen(isoToDay(task.completedAt), currentDay())}</span>}
          </span>
        </div>
        {parent && <div class="row-parent">{parent}</div>}
      </div>
    </div>
  );
}

// ---------- expanded card ----------

type Pop = { kind: "when" | "deadline" | "tags" | "move"; anchor: Anchor } | null;

function autosize(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function useClickOutside(ref: { current: HTMLElement | null }, onOutside: () => void, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Element;
      if (ref.current?.contains(t) || t.closest(".popover, .popover-backdrop, .toast-stack")) return;
      onOutside();
    };
    // Defer so the click that opened the card doesn't close it.
    const id = setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [enabled, onOutside]);
}

export function TodoCard({ task }: { task: Task }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitleText] = useState(task.title);
  const [notes, setNotesText] = useState(task.notes);
  const [items, setItems] = useState(task.checklist);
  const [pop, setPop] = useState<Pop>(null);
  const ix = index();
  const today = currentDay();

  useLayoutEffect(() => autosize(notesRef.current), [notes]);
  useEffect(() => {
    titleRef.current?.focus();
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  // Live updates from the Mac when not editing that field.
  useEffect(() => {
    if (document.activeElement !== titleRef.current) setTitleText(task.title);
    if (document.activeElement !== notesRef.current) setNotesText(task.notes);
  }, [task.title, task.notes]);
  useEffect(() => setItems(task.checklist), [JSON.stringify(task.checklist)]);

  const save = () => {
    if (title.trim() && title !== task.title) setTitle(task.id, title.trim());
    if (notes !== task.notes) setNotes(task.id, notes);
  };
  const close = () => {
    save();
    set({ expanded: null });
  };
  useClickOutside(ref, close, !pop);

  const commitChecklist = (next: typeof items) => {
    setItems(next);
    setChecklist(task.id, next);
  };
  const open = (kind: NonNullable<Pop>["kind"], el: EventTarget | null) => setPop({ kind, anchor: anchorOf(el as Element) });
  const tags = task.tags.map((id) => ix.tag(id)).filter(Boolean);
  const status = displayStatus(task);

  return (
    <div
      class="card"
      ref={ref}
      data-id={task.id}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pop) {
          e.stopPropagation();
          close();
        }
      }}
    >
      <div class="card-top">
        <Checkbox task={task} onToggle={() => toggleComplete(task.id)} />
        <input
          ref={titleRef}
          class="card-title"
          value={title}
          placeholder="New To-Do"
          style={status !== "open" ? { color: "var(--text-3)" } : undefined}
          onInput={(e) => setTitleText((e.target as HTMLInputElement).value)}
          onBlur={() => title.trim() && title !== task.title && setTitle(task.id, title.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              close();
            }
          }}
        />
      </div>
      <textarea
        ref={notesRef}
        class="card-notes"
        rows={1}
        placeholder="Notes"
        value={notes}
        onInput={(e) => {
          setNotesText((e.target as HTMLTextAreaElement).value);
          autosize(e.target as HTMLTextAreaElement);
        }}
        onBlur={() => notes !== task.notes && setNotes(task.id, notes)}
      />
      {items.length > 0 && (
        <div class="checklist">
          {items.map((item, i) => (
            <div key={item.id} class={`check-item${item.done ? " done" : ""}`}>
              <button class={`mini-check${item.done ? " on" : ""}`} aria-label="Toggle" onClick={() => commitChecklist(items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))}>
                <IconCheck />
              </button>
              <input
                value={item.title}
                data-check-index={i}
                onInput={(e) => setItems(items.map((x, j) => (j === i ? { ...x, title: (e.target as HTMLInputElement).value } : x)))}
                onBlur={() => JSON.stringify(items) !== JSON.stringify(task.checklist) && commitChecklist(items)}
                onKeyDown={(e) => {
                  const input = e.target as HTMLInputElement;
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const next = [...items.slice(0, i + 1), { id: `new_${Date.now()}`, title: "", done: false }, ...items.slice(i + 1)];
                    setItems(next);
                    setTimeout(() => (ref.current?.querySelector(`[data-check-index="${i + 1}"]`) as HTMLInputElement | null)?.focus(), 0);
                  } else if (e.key === "Backspace" && input.value === "") {
                    e.preventDefault();
                    const next = items.filter((_, j) => j !== i);
                    commitChecklist(next);
                    setTimeout(() => (ref.current?.querySelector(`[data-check-index="${Math.max(0, i - 1)}"]`) as HTMLInputElement | null)?.focus(), 0);
                  }
                }}
              />
            </div>
          ))}
        </div>
      )}
      {(task.deadline || tags.length > 0) && (
        <div class="card-chips">
          {tags.map((t) => (
            <span key={t!.id} class="chip">
              <IconTag /> {t!.title}
              <button class="x" aria-label={`Remove ${t!.title}`} onClick={() => setTags(task.id, task.tags.filter((x) => x !== t!.id))}>
                <IconX style={{ width: "8px", height: "8px" }} />
              </button>
            </span>
          ))}
          {task.deadline && (
            <span class="chip deadline-chip">
              <IconFlag /> Deadline: {shortWhen(task.deadline, today)}
              <button class="x" aria-label="Clear deadline" onClick={() => setDeadline(task.id, null)}>
                <IconX style={{ width: "8px", height: "8px" }} />
              </button>
            </span>
          )}
        </div>
      )}
      <div class="card-bar">
        <span class="when-label">
          {task.when || task.start === "someday" ? (
            <button class="chip" onClick={(e) => open("when", e.currentTarget)}>
              {task.when && task.when <= today ? (task.evening ? <IconEvening /> : <IconToday />) : task.when ? <IconCalendar /> : <IconSomeday />}
              {task.when ? (task.when <= today ? (task.evening ? "This Evening" : "Today") : shortWhen(task.when, today)) : "Someday"}
              <span
                class="x"
                role="button"
                aria-label="Clear when"
                onClick={(e) => {
                  e.stopPropagation();
                  setWhen([task.id], "anytime");
                }}
              >
                <IconX style={{ width: "8px", height: "8px" }} />
              </span>
            </button>
          ) : null}
        </span>
        <button class="tool" title="Tags" aria-label="Tags" onClick={(e) => open("tags", e.currentTarget)}>
          <IconTag />
        </button>
        <button
          class="tool"
          title="Checklist"
          aria-label="Add checklist"
          onClick={() => {
            if (items.length) return;
            setItems([{ id: `new_${Date.now()}`, title: "", done: false }]);
            setTimeout(() => (ref.current?.querySelector('[data-check-index="0"]') as HTMLInputElement | null)?.focus(), 0);
          }}
        >
          <IconChecklist />
        </button>
        <button class={`tool${task.deadline ? " on" : ""}`} title="Deadline" aria-label="Deadline" onClick={(e) => open("deadline", e.currentTarget)}>
          <IconFlag />
        </button>
        <button class="tool" title="Move" aria-label="Move" onClick={(e) => open("move", e.currentTarget)}>
          <IconMove />
        </button>
        <button class={`tool${task.when ? " on" : ""}`} title="When" aria-label="When" onClick={(e) => open("when", e.currentTarget)}>
          <IconCalendar />
        </button>
      </div>
      {pop?.kind === "when" && <WhenPicker anchor={pop.anchor} task={task} onPick={(c) => setWhen([task.id], c)} onClose={() => setPop(null)} />}
      {pop?.kind === "deadline" && <DeadlinePicker anchor={pop.anchor} value={task.deadline} onPick={(d) => setDeadline(task.id, d)} onClose={() => setPop(null)} />}
      {pop?.kind === "tags" && <TagPicker anchor={pop.anchor} value={task.tags} onChange={(ids) => setTags(task.id, ids)} onClose={() => setPop(null)} />}
      {pop?.kind === "move" && <MovePicker anchor={pop.anchor} onPick={(d) => moveTo([task.id], d)} onClose={() => setPop(null)} />}
    </div>
  );
}

// ---------- new to-do ----------

export function DraftCard({ draft }: { draft: Draft }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const [title, setTitleText] = useState("");
  const [notes, setNotesText] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const [tagIds, setTagIds] = useState<string[]>(draft.defaults.tagIds ?? []);
  const [when, setWhenChoice] = useState<{ when?: string; evening?: boolean; start?: Task["start"] }>({
    when: draft.defaults.when,
    evening: draft.defaults.evening,
    start: draft.defaults.start,
  });
  const [pop, setPop] = useState<Pop>(null);
  const ix = index();
  const today = currentDay();

  useEffect(() => titleRef.current?.focus(), [draft.key]);
  useLayoutEffect(() => autosize(notesRef.current), [notes]);

  const finish = (another = false) => {
    const t = title.trim();
    if (t) {
      void createTodo({
        ...draft.defaults,
        ...when,
        title: t,
        notes: notes.trim() || undefined,
        checklist: items.map((s) => s.trim()).filter(Boolean),
        tagIds,
      });
    }
    set({ draft: another && t ? { ...draft, key: draft.key + 1 } : null });
    if (another && t) {
      setTitleText("");
      setNotesText("");
      setItems([]);
    }
  };
  useClickOutside(ref, () => finish(false), !pop);

  const fake: Task = {
    id: "draft",
    kind: "todo",
    title,
    notes,
    status: "open",
    start: when.start ?? "inbox",
    when: when.evening ? today : (when.when ?? null),
    evening: Boolean(when.evening),
    deadline: null,
    reminder: null,
    areaId: null,
    projectId: null,
    headingId: null,
    tags: tagIds,
    checklist: [],
    index: 0,
    todayIndex: 0,
    repeating: false,
    trashed: false,
    createdAt: null,
    modifiedAt: null,
    completedAt: null,
  };
  const open = (kind: NonNullable<Pop>["kind"], el: EventTarget | null) => setPop({ kind, anchor: anchorOf(el as Element) });

  return (
    <div
      class="card"
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !pop) {
          e.stopPropagation();
          finish(false);
        }
      }}
    >
      <div class="card-top">
        <span class="check" style={{ pointerEvents: "none" }} />
        <input
          ref={titleRef}
          class="card-title"
          value={title}
          placeholder="New To-Do"
          onInput={(e) => setTitleText((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              finish(e.shiftKey || e.metaKey);
            }
          }}
        />
      </div>
      <textarea
        ref={notesRef}
        class="card-notes"
        rows={1}
        placeholder="Notes"
        value={notes}
        onInput={(e) => setNotesText((e.target as HTMLTextAreaElement).value)}
      />
      {items.length > 0 && (
        <div class="checklist">
          {items.map((item, i) => (
            <div key={i} class="check-item">
              <span class="mini-check" />
              <input
                value={item}
                data-check-index={i}
                onInput={(e) => setItems(items.map((x, j) => (j === i ? (e.target as HTMLInputElement).value : x)))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    setItems([...items.slice(0, i + 1), "", ...items.slice(i + 1)]);
                    setTimeout(() => (ref.current?.querySelector(`[data-check-index="${i + 1}"]`) as HTMLInputElement | null)?.focus(), 0);
                  } else if (e.key === "Backspace" && item === "") {
                    e.preventDefault();
                    setItems(items.filter((_, j) => j !== i));
                    setTimeout(() => (ref.current?.querySelector(`[data-check-index="${Math.max(0, i - 1)}"]`) as HTMLInputElement | null)?.focus(), 0);
                  }
                }}
              />
            </div>
          ))}
        </div>
      )}
      {tagIds.length > 0 && (
        <div class="card-chips">
          {tagIds.map((id) => (
            <span key={id} class="chip">
              <IconTag /> {ix.tag(id)?.title}
            </span>
          ))}
        </div>
      )}
      <div class="card-bar">
        <span class="when-label">
          {(fake.when || fake.start === "someday") && (
            <span class="chip">
              {fake.when ? (fake.when <= today ? (fake.evening ? <IconEvening /> : <IconToday />) : <IconCalendar />) : <IconSomeday />}
              {fake.when ? (fake.when <= today ? (fake.evening ? "This Evening" : "Today") : shortWhen(fake.when, today)) : "Someday"}
            </span>
          )}
        </span>
        <button class="tool" title="Tags" aria-label="Tags" onClick={(e) => open("tags", e.currentTarget)}>
          <IconTag />
        </button>
        <button
          class="tool"
          title="Checklist"
          aria-label="Add checklist"
          onClick={() => {
            if (!items.length) setItems([""]);
            setTimeout(() => (ref.current?.querySelector('[data-check-index="0"]') as HTMLInputElement | null)?.focus(), 0);
          }}
        >
          <IconChecklist />
        </button>
        <button class="tool" title="When" aria-label="When" onClick={(e) => open("when", e.currentTarget)}>
          <IconCalendar />
        </button>
      </div>
      {pop?.kind === "when" && (
        <WhenPicker
          anchor={pop.anchor}
          task={fake}
          onPick={(c) =>
            setWhenChoice(
              c === "today"
                ? { when: today, start: "anytime" }
                : c === "evening"
                  ? { evening: true, start: "anytime" }
                  : c === "anytime"
                    ? { start: "anytime" }
                    : c === "someday"
                      ? { start: "someday" }
                      : c === "inbox"
                        ? { start: "inbox" }
                        : { when: c.day, start: c.day > today ? "someday" : "anytime" },
            )
          }
          onClose={() => setPop(null)}
        />
      )}
      {pop?.kind === "tags" && <TagPicker anchor={pop.anchor} value={tagIds} onChange={setTagIds} onClose={() => setPop(null)} />}
    </div>
  );
}
