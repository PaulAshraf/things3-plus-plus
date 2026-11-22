import { useMemo, useRef, useState } from "preact/hooks";
import type { Task } from "things3pp-core/model/types";
import { addDays, dayOf, parseDay, parseWhenText, shortWhen, monthTitle } from "../dates.ts";
import {
  IconArea,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconEvening,
  IconInbox,
  IconSomeday,
  IconTag,
  IconToday,
  IconAnytime,
  Pie,
} from "../icons.tsx";
import { currentDay, index, type WhenChoice } from "../store.ts";
import { Popover, type Anchor } from "./Popover.tsx";

// ---------- calendar ----------

function Calendar({ picked, onPick, allowPast = false }: { picked: string | null; onPick: (day: string) => void; allowPast?: boolean }) {
  const today = currentDay();
  const [month, setMonth] = useState(() => {
    const d = parseDay(picked && picked > today ? picked : today);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const cells = useMemo(() => {
    const first = new Date(month);
    const offset = (first.getDay() + 6) % 7; // weeks start on Monday
    const start = new Date(first);
    start.setDate(1 - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return { day: dayOf(d), num: d.getDate(), other: d.getMonth() !== month.getMonth() };
    });
  }, [month]);
  let rows = cells[35]!.other && cells[28]!.other ? cells.slice(0, 28) : cells[35]!.other ? cells.slice(0, 35) : cells;
  // Skip weeks that are entirely in the past, like the Mac app's picker.
  if (!allowPast) while (rows.length > 7 && rows[6]!.day < today) rows = rows.slice(7);
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  return (
    <div class="cal">
      <div class="cal-head">
        <button class="cal-nav" onClick={() => shift(-1)} aria-label="Previous month">
          <IconChevronLeft />
        </button>
        <span>{monthTitle(month)}</span>
        <button class="cal-nav" onClick={() => shift(1)} aria-label="Next month">
          <IconChevronRight />
        </button>
      </div>
      <div class="cal-grid">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div key={i} class="cal-dow">
            {d}
          </div>
        ))}
        {rows.map((c) => {
          const past = c.day < today;
          return (
            <button
              key={c.day}
              class={`cal-day${c.other ? " other" : ""}${past ? " past" : ""}${c.day === today ? " today" : ""}${c.day === picked ? " picked" : ""}`}
              disabled={past && !allowPast}
              onClick={() => onPick(c.day)}
              aria-label={c.day}
            >
              {c.day === today && c.day !== picked ? <IconToday /> : c.num}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---------- When ----------

export function WhenPicker({ anchor, task, onPick, onClose }: { anchor: Anchor; task?: Task; onPick: (c: WhenChoice) => void; onClose: () => void }) {
  const today = currentDay();
  const [text, setText] = useState("");
  const guess = text ? parseWhenText(text, today) : null;
  const pick = (c: WhenChoice) => {
    onPick(c);
    onClose();
  };
  const pickGuess = () => {
    if (!guess) return;
    if (guess === "someday" || guess === "anytime" || guess === "evening") pick(guess);
    else pick(guess === today ? "today" : { day: guess });
  };
  const picked = task?.when ?? null;
  return (
    <Popover anchor={anchor} onClose={onClose} width={250}>
      <div class="popover-title">When</div>
      <input
        class="pop-field"
        placeholder="Type a date: fri, in 3 days, dec 24…"
        value={text}
        autoFocus={!window.matchMedia("(max-width: 760px)").matches}
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => e.key === "Enter" && pickGuess()}
      />
      {text && (
        <button class={`menu-item${guess ? " hot" : ""}`} disabled={!guess} onClick={pickGuess}>
          {guess ? (guess === "someday" ? "Someday" : guess === "anytime" ? "Anytime" : guess === "evening" ? "This Evening" : shortWhen(guess, today)) : "Not a date I understand"}
        </button>
      )}
      <button class="menu-item" onClick={() => pick("today")}>
        <IconToday /> Today
      </button>
      <button class="menu-item" onClick={() => pick("evening")}>
        <IconEvening /> This Evening
      </button>
      <Calendar picked={picked} onPick={(d) => pick(d === today ? "today" : { day: d })} />
      <button class="menu-item" onClick={() => pick("anytime")}>
        <IconAnytime /> Anytime
      </button>
      <button class="menu-item" onClick={() => pick("someday")}>
        <IconSomeday /> Someday
      </button>
      {task && task.start !== "inbox" && (
        <>
          <div class="menu-sep" />
          <button class="menu-item" onClick={() => pick("inbox")}>
            <IconInbox /> Back to Inbox
          </button>
        </>
      )}
    </Popover>
  );
}

// ---------- Deadline ----------

export function DeadlinePicker({ anchor, value, onPick, onClose }: { anchor: Anchor; value: string | null; onPick: (d: string | null) => void; onClose: () => void }) {
  return (
    <Popover anchor={anchor} onClose={onClose} width={250}>
      <div class="popover-title">Deadline</div>
      <Calendar
        picked={value}
        allowPast
        onPick={(d) => {
          onPick(d);
          onClose();
        }}
      />
      {value && (
        <>
          <div class="menu-sep" />
          <button
            class="menu-item"
            onClick={() => {
              onPick(null);
              onClose();
            }}
          >
            Clear deadline
          </button>
        </>
      )}
    </Popover>
  );
}

// ---------- Tags ----------

export function TagPicker({ anchor, value, onChange, onClose }: { anchor: Anchor; value: string[]; onChange: (ids: string[]) => void; onClose: () => void }) {
  const ix = index();
  const [q, setQ] = useState("");
  const [hot, setHot] = useState(0);
  const tags = ix.tags.filter((t) => !q || t.title.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <Popover anchor={anchor} onClose={onClose} width={240}>
      <input
        class="pop-field"
        placeholder="Tags"
        value={q}
        autoFocus={!window.matchMedia("(max-width: 760px)").matches}
        onInput={(e) => {
          setQ((e.target as HTMLInputElement).value);
          setHot(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setHot(Math.min(hot + 1, tags.length - 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setHot(Math.max(hot - 1, 0)));
          if (e.key === "Enter" && tags[hot]) toggle(tags[hot]!.id);
        }}
      />
      <div style={{ maxHeight: "260px", overflowY: "auto" }}>
        {tags.length === 0 && <div class="finder-empty">{ix.tags.length ? "No matching tags" : "No tags yet. Create tags in Things on your Mac."}</div>}
        {tags.map((t, i) => (
          <button key={t.id} class={`menu-item${i === hot ? " hot" : ""}`} onMouseEnter={() => setHot(i)} onClick={() => toggle(t.id)}>
            <IconTag />
            <span style={{ paddingLeft: t.parentId ? "10px" : 0 }}>{t.title}</span>
            {value.includes(t.id) && <IconCheck class="icon right" />}
          </button>
        ))}
      </div>
    </Popover>
  );
}

// ---------- Move ----------

export function MovePicker({ anchor, onPick, onClose }: { anchor: Anchor; onPick: (dest: { projectId?: string; areaId?: string }) => void; onClose: () => void }) {
  const ix = index();
  const [q, setQ] = useState("");
  const [hot, setHot] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const options = [
    ...ix.projects(null).map((p) => ({ kind: "project" as const, id: p.id, title: p.title || "New Project", indent: false })),
    ...ix.areas.flatMap((a) => [
      { kind: "area" as const, id: a.id, title: a.title, indent: false },
      ...ix.projects(a.id).map((p) => ({ kind: "project" as const, id: p.id, title: p.title || "New Project", indent: true })),
    ]),
  ].filter((o) => !q || o.title.toLowerCase().includes(q.toLowerCase()));
  const choose = (o: (typeof options)[number]) => {
    onPick(o.kind === "project" ? { projectId: o.id } : { areaId: o.id });
    onClose();
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={260}>
      <input
        ref={inputRef}
        class="pop-field"
        placeholder="Move to…"
        value={q}
        autoFocus={!window.matchMedia("(max-width: 760px)").matches}
        onInput={(e) => {
          setQ((e.target as HTMLInputElement).value);
          setHot(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setHot(Math.min(hot + 1, options.length - 1)));
          if (e.key === "ArrowUp") (e.preventDefault(), setHot(Math.max(hot - 1, 0)));
          if (e.key === "Enter" && options[hot]) choose(options[hot]!);
        }}
      />
      <div style={{ maxHeight: "300px", overflowY: "auto" }}>
        {options.length === 0 && <div class="finder-empty">No projects or areas</div>}
        {options.map((o, i) => (
          <button key={o.id} class={`menu-item${i === hot ? " hot" : ""}`} style={{ paddingLeft: o.indent ? "26px" : undefined }} onMouseEnter={() => setHot(i)} onClick={() => choose(o)}>
            {o.kind === "area" ? <IconArea /> : <Pie class="icon" done={ix.progress(o.id).done} total={ix.progress(o.id).total} />}
            <span style={{ fontWeight: o.kind === "area" ? 600 : 500 }}>{o.title}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}

export { addDays };
