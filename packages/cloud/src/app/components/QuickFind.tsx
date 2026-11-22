import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import {
  IconAnytime,
  IconArea,
  IconCheck,
  IconInbox,
  IconLogbook,
  IconSearch,
  IconSomeday,
  IconTag,
  IconToday,
  IconTrash,
  IconUpcoming,
  Pie,
} from "../icons.tsx";
import { index, navigate, set, state, type Route } from "../store.ts";

interface Result {
  key: string;
  icon: ComponentChildren;
  title: string;
  sub?: string;
  go: () => void;
}

const LISTS: { id: "inbox" | "today" | "upcoming" | "anytime" | "someday" | "logbook" | "trash"; title: string; icon: () => ComponentChildren }[] = [
  { id: "inbox", title: "Inbox", icon: () => <IconInbox /> },
  { id: "today", title: "Today", icon: () => <IconToday /> },
  { id: "upcoming", title: "Upcoming", icon: () => <IconUpcoming /> },
  { id: "anytime", title: "Anytime", icon: () => <IconAnytime /> },
  { id: "someday", title: "Someday", icon: () => <IconSomeday /> },
  { id: "logbook", title: "Logbook", icon: () => <IconLogbook /> },
  { id: "trash", title: "Trash", icon: () => <IconTrash /> },
];

/** Type anywhere to find lists, projects, areas, tags and to-dos. */
export function QuickFind({ initial }: { initial: string }) {
  const [q, setQ] = useState(initial);
  const [hot, setHot] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const close = () => set({ quickFind: false });
  const go = (route: Route, expand?: string) => {
    close();
    navigate(route);
    if (expand) setTimeout(() => set({ selected: [expand], expanded: expand }), 30);
  };

  const results = useMemo<Result[]>(() => {
    const ix = index();
    const needle = q.trim().toLowerCase();
    const out: Result[] = [];
    const match = (s: string) => !needle || s.toLowerCase().includes(needle);
    for (const l of LISTS) if (match(l.title)) out.push({ key: l.id, icon: l.icon(), title: l.title, go: () => go({ kind: "list", list: l.id }) });
    for (const a of ix.areas) if (needle && match(a.title)) out.push({ key: a.id, icon: <IconArea />, title: a.title, go: () => go({ kind: "area", id: a.id }) });
    for (const p of ix.projects()) {
      if (!needle || !match(p.title)) continue;
      const prog = ix.progress(p.id);
      out.push({ key: p.id, icon: <Pie done={prog.done} total={prog.total} class="icon" />, title: p.title || "New Project", sub: p.areaId ? ix.area(p.areaId)?.title : undefined, go: () => go({ kind: "project", id: p.id }) });
    }
    for (const t of ix.tags) if (needle && match(t.title)) out.push({ key: t.id, icon: <IconTag />, title: t.title, go: () => go({ kind: "tag", id: t.id }) });
    if (needle) {
      for (const t of ix.search(needle, { includeCompleted: true, limit: 30 })) {
        if (t.kind === "project") continue;
        const pid = ix.projectIdOf(t);
        const where = pid ? ix.task(pid)?.title : t.areaId ? ix.area(t.areaId)?.title : t.start === "inbox" ? "Inbox" : undefined;
        const route: Route = pid ? { kind: "project", id: pid } : t.areaId ? { kind: "area", id: t.areaId } : t.status !== "open" ? { kind: "list", list: "logbook" } : t.when && t.when <= ix.today ? { kind: "list", list: "today" } : t.start === "inbox" ? { kind: "list", list: "inbox" } : t.when ? { kind: "list", list: "upcoming" } : t.start === "someday" ? { kind: "list", list: "someday" } : { kind: "list", list: "anytime" };
        out.push({
          key: t.id,
          icon: t.status === "open" ? <span class="check" style={{ width: "14px", height: "14px", margin: 0 }} /> : <IconCheck color="var(--blue)" />,
          title: t.title || "New To-Do",
          sub: where,
          go: () => go(route, t.id),
        });
      }
    }
    return out.slice(0, 60);
  }, [q, state.snapshot]);

  useEffect(() => {
    listRef.current?.querySelector(".hot")?.scrollIntoView({ block: "nearest" });
  }, [hot]);

  return (
    <div class="overlay" onMouseDown={close}>
      <div class="finder" role="dialog" aria-label="Quick Find" onMouseDown={(e) => e.stopPropagation()}>
        <div class="finder-input">
          <IconSearch />
          <input
            ref={inputRef}
            value={q}
            placeholder="Quick Find"
            onInput={(e) => {
              setQ((e.target as HTMLInputElement).value);
              setHot(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") (e.preventDefault(), close());
              if (e.key === "ArrowDown") (e.preventDefault(), setHot(Math.min(hot + 1, results.length - 1)));
              if (e.key === "ArrowUp") (e.preventDefault(), setHot(Math.max(hot - 1, 0)));
              if (e.key === "Enter") results[hot]?.go();
            }}
          />
        </div>
        <div class="finder-results" ref={listRef}>
          {results.length === 0 && <div class="finder-empty">No results for “{q}”</div>}
          {results.map((r, i) => (
            <button key={r.key} class={`menu-item${i === hot ? " hot" : ""}`} onMouseEnter={() => setHot(i)} onClick={r.go}>
              {r.icon}
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.title}
                {r.sub && <span class="sub">{r.sub}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
