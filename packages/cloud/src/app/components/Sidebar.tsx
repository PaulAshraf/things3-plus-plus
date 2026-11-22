import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import {
  IconAnytime,
  IconArea,
  IconGear,
  IconInbox,
  IconLogbook,
  IconSearch,
  IconSomeday,
  IconToday,
  IconTrash,
  IconUpcoming,
  Pie,
} from "../icons.tsx";
import { index, moveTo, navigate, set, setWhen, state, type ListId, type Route, type WhenChoice } from "../store.ts";
import { MacStatus } from "./MacStatus.tsx";

type DropAction = { when: WhenChoice } | { projectId: string } | { areaId: string } | null;

function NavItem({
  route,
  icon,
  label,
  count,
  badge,
  drop,
  class: cls = "",
}: {
  route: Route;
  icon: ComponentChildren;
  label: string;
  count?: number;
  badge?: number;
  drop?: DropAction;
  class?: string;
}) {
  const [over, setOver] = useState(false);
  const active =
    (state.route.kind === route.kind &&
      ((route.kind === "list" && state.route.kind === "list" && route.list === state.route.list) ||
        (route.kind !== "list" && "id" in route && "id" in state.route && route.id === state.route.id))) ||
    false;
  return (
    <button
      class={`nav-item ${cls}${active ? " active" : ""}${over ? " drop" : ""}`}
      onClick={() => navigate(route)}
      onDragOver={(e) => {
        if (!drop || !e.dataTransfer?.types.includes("application/x-things-ids")) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        if (!drop) return;
        e.preventDefault();
        const ids = JSON.parse(e.dataTransfer?.getData("application/x-things-ids") || "[]") as string[];
        if (!ids.length) return;
        if ("when" in drop) setWhen(ids, drop.when);
        else moveTo(ids, drop);
        set({ selected: [] });
      }}
    >
      <span class="icon">{icon}</span>
      <span class="label">{label}</span>
      {badge ? <span class="count badge">{badge}</span> : null}
      {count ? <span class="count">{count}</span> : null}
    </button>
  );
}

const list = (l: ListId): Route => ({ kind: "list", list: l });

export function Sidebar() {
  const ix = index();
  const counts = ix.counts();
  return (
    <nav class="sidebar" aria-label="Lists">
      <div class="sidebar-scroll">
        <MacStatus />
        <div class="nav-group">
          <NavItem route={list("inbox")} icon={<IconInbox />} label="Inbox" count={counts.inbox} drop={{ when: "inbox" }} />
        </div>
        <div class="nav-group">
          <NavItem route={list("today")} icon={<IconToday />} label="Today" count={counts.today - counts.overdue} badge={counts.overdue} drop={{ when: "today" }} />
          <NavItem route={list("upcoming")} icon={<IconUpcoming />} label="Upcoming" />
          <NavItem route={list("anytime")} icon={<IconAnytime />} label="Anytime" drop={{ when: "anytime" }} />
          <NavItem route={list("someday")} icon={<IconSomeday />} label="Someday" drop={{ when: "someday" }} />
        </div>
        <div class="nav-group">
          <NavItem route={list("logbook")} icon={<IconLogbook />} label="Logbook" />
          <NavItem route={list("trash")} icon={<IconTrash />} label="Trash" />
        </div>

        {ix.projects(null).length > 0 && (
          <div class="nav-area">
            {ix.projects(null).map((p) => {
              const prog = ix.progress(p.id);
              return (
                <NavItem
                  key={p.id}
                  class="nav-project"
                  route={{ kind: "project", id: p.id }}
                  icon={<Pie done={prog.done} total={prog.total} />}
                  label={p.title || "New Project"}
                  drop={{ projectId: p.id }}
                />
              );
            })}
          </div>
        )}
        {ix.areas.map((a) => (
          <div key={a.id} class="nav-area">
            <NavItem route={{ kind: "area", id: a.id }} icon={<IconArea />} label={a.title} drop={{ areaId: a.id }} />
            {ix.projects(a.id).map((p) => {
              const prog = ix.progress(p.id);
              return (
                <NavItem
                  key={p.id}
                  class="nav-project"
                  route={{ kind: "project", id: p.id }}
                  icon={<Pie done={prog.done} total={prog.total} />}
                  label={p.title || "New Project"}
                  drop={{ projectId: p.id }}
                />
              );
            })}
          </div>
        ))}
      </div>
      <div class="sidebar-footer">
        <button class="footer-btn" onClick={() => set({ quickFind: true })} title="Quick Find (⌘F or just start typing)">
          <IconSearch class="icon" /> Quick Find
        </button>
        <span class="footer-spacer" />
        <button class="footer-btn" onClick={() => navigate({ kind: "settings" })} aria-label="Settings" title="Settings">
          <IconGear class="icon" />
        </button>
      </div>
    </nav>
  );
}
