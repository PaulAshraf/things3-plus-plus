import "./styles.css";
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Sidebar } from "./components/Sidebar.tsx";
import { buildView, ListPage, newTodo, Toolbar, visibleIds, type View } from "./components/ListPage.tsx";
import { QuickFind } from "./components/QuickFind.tsx";
import { Consent, Pair, readConsent, SignIn } from "./components/Onboarding.tsx";
import { applyTheme, savedTheme, Settings } from "./components/Settings.tsx";
import { DeadlinePicker, MovePicker, TagPicker, WhenPicker } from "./components/Pickers.tsx";
import { anchorOf, type Anchor } from "./components/Popover.tsx";
import { IconChevronLeft } from "./icons.tsx";
import {
  index,
  loadState,
  moveTo,
  startDemo,
  navigate,
  set,
  setDeadline,
  setTags,
  setWhen,
  state,
  subscribe,
  toggleComplete,
  type ListId,
} from "./store.ts";

applyTheme(savedTheme());

type GlobalPop = { kind: "when" | "deadline" | "tags" | "move"; ids: string[]; anchor: Anchor } | null;
let setGlobalPop: (p: GlobalPop) => void = () => {};
let quickFindSeed = "";

const LIST_KEYS: ListId[] = ["inbox", "today", "upcoming", "anytime", "someday", "logbook", "trash"];

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return Boolean(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable));
}

function anchorForSelection(): Anchor {
  const id = state.selected[state.selected.length - 1];
  const el = id ? document.querySelector(`[data-id="${CSS.escape(id)}"]`) : null;
  return anchorOf(el);
}

function onKey(e: KeyboardEvent, view: View | null) {
  if (state.auth.status !== "signedIn" || state.quickFind) return;
  const mod = e.metaKey || e.ctrlKey;
  const sel = state.selected.filter((id) => !id.startsWith("tmp_"));

  // ⌘F: Quick Find (works even while typing).
  if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
    e.preventDefault();
    quickFindSeed = "";
    set({ quickFind: true });
    return;
  }
  if (isTyping(e)) return;

  // ⌥1–7: jump to a list.
  if (e.altKey && !mod && /^Digit[1-7]$/.test(e.code)) {
    e.preventDefault();
    navigate({ kind: "list", list: LIST_KEYS[Number(e.code.slice(5)) - 1]! });
    return;
  }

  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    const ids = visibleIds(view);
    if (!ids.length) return;
    e.preventDefault();
    const cur = state.selected[state.selected.length - 1];
    const i = cur ? ids.indexOf(cur) : -1;
    const next = ids[Math.max(0, Math.min(ids.length - 1, i < 0 ? 0 : i + (e.key === "ArrowDown" ? 1 : -1)))]!;
    set({ selected: e.shiftKey ? [...new Set([...state.selected, next])] : [next], expanded: null });
    document.querySelector(`[data-id="${CSS.escape(next)}"]`)?.scrollIntoView({ block: "nearest" });
    return;
  }
  if (e.key === "Escape") {
    set({ selected: [], expanded: null });
    return;
  }
  if (e.key === "Enter" && sel.length === 1 && !state.expanded) {
    e.preventDefault();
    const t = index().task(sel[0]!);
    if (t?.kind === "project") navigate({ kind: "project", id: t.id });
    else set({ expanded: sel[0]! });
    return;
  }
  if (e.key === " " && !mod) {
    e.preventDefault();
    newTodo(view);
    return;
  }
  if (mod && e.key.toLowerCase() === "k" && sel.length) {
    e.preventDefault();
    for (const id of sel) toggleComplete(id, { cancel: e.altKey });
    return;
  }
  if (mod && e.key.toLowerCase() === "s" && sel.length) {
    e.preventDefault();
    setGlobalPop({ kind: "when", ids: sel, anchor: anchorForSelection() });
    return;
  }
  if (e.altKey && !mod && sel.length) {
    const code = e.code;
    const actions: Record<string, () => void> = {
      KeyT: () => setWhen(sel, "today"),
      KeyE: () => setWhen(sel, "evening"),
      KeyA: () => setWhen(sel, "anytime"),
      KeyO: () => setWhen(sel, "someday"),
      KeyD: () => setGlobalPop({ kind: "deadline", ids: sel, anchor: anchorForSelection() }),
      KeyG: () => setGlobalPop({ kind: "tags", ids: sel, anchor: anchorForSelection() }),
      KeyM: () => setGlobalPop({ kind: "move", ids: sel, anchor: anchorForSelection() }),
    };
    if (actions[code]) {
      e.preventDefault();
      actions[code]!();
      return;
    }
  }
  // Start typing anywhere to find.
  if (!mod && !e.altKey && e.key.length === 1 && /\S/.test(e.key)) {
    e.preventDefault();
    quickFindSeed = e.key;
    set({ quickFind: true });
  }
}

function Toasts() {
  return (
    <div class="toast-stack" aria-live="polite">
      {state.toasts.map((t) => (
        <div key={t.id} class="toast">
          <span>{t.text}</span>
          {t.action && (
            <button
              onClick={() => {
                t.action!.run();
                set({ toasts: state.toasts.filter((x) => x.id !== t.id) });
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function Shell() {
  const [showLogged, setShowLogged] = useState(false);
  const [pop, setPop] = useState<GlobalPop>(null);
  setGlobalPop = setPop;
  const route = state.route;
  const view = route.kind === "settings" || route.kind === "home" || route.kind === "pair" ? null : buildView(route, showLogged);

  useEffect(() => setShowLogged(false), [route.kind === "project" ? route.id : ""]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => onKey(e, view);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  useEffect(() => {
    document.title = view ? `${view.title} · Things` : route.kind === "settings" ? "Settings · Things" : "Things";
  }, [view?.title, route.kind]);

  const ix = index();
  const one = pop && pop.ids.length === 1 ? ix.task(pop.ids[0]!) : undefined;
  const loading = !state.snapshot;
  const missing = !loading && !view && (route.kind === "project" || route.kind === "area" || route.kind === "tag");

  return (
    <div class={`shell${state.mobileDetail ? " detail" : ""}`}>
      <Sidebar />
      <main class="main">
        <div class="main-scroll" onClick={(e) => e.target === e.currentTarget && set({ selected: [], expanded: null })}>
          {loading ? (
            <div class="loading">
              <div class="spinner" />
            </div>
          ) : route.kind === "settings" ? (
            <Settings />
          ) : view ? (
            <ListPage view={view} showLogged={showLogged} onToggleLogged={() => setShowLogged(!showLogged)} />
          ) : missing ? (
            <div class="page">
              <button class="mobile-back" onClick={() => navigate({ kind: "home" })}>
                <IconChevronLeft /> Lists
              </button>
              <div class="empty">
                <p>This list doesn't exist anymore. It may have been completed or deleted in Things.</p>
              </div>
            </div>
          ) : null}
        </div>
        {view && <Toolbar view={view} />}
      </main>
      {state.quickFind && <QuickFind initial={quickFindSeed} />}
      {pop?.kind === "when" && <WhenPicker anchor={pop.anchor} task={one} onPick={(c) => setWhen(pop.ids, c)} onClose={() => setPop(null)} />}
      {pop?.kind === "deadline" && (
        <DeadlinePicker anchor={pop.anchor} value={one?.deadline ?? null} onPick={(d) => pop.ids.forEach((id) => setDeadline(id, d))} onClose={() => setPop(null)} />
      )}
      {pop?.kind === "tags" && one && <TagPicker anchor={pop.anchor} value={one.tags} onChange={(ids) => setTags(one.id, ids)} onClose={() => setPop(null)} />}
      {pop?.kind === "move" && <MovePicker anchor={pop.anchor} onPick={(d) => moveTo(pop.ids, d)} onClose={() => setPop(null)} />}
    </div>
  );
}

function App() {
  const [, force] = useState(0);
  useEffect(() => {
    const unsubscribe = subscribe(() => force((n) => n + 1));
    // State may have changed before we subscribed (e.g. demo/session loaded during first render).
    force((n) => n + 1);
    return unsubscribe;
  }, []);

  const consent = location.pathname === "/authorize" ? readConsent() : null;
  if (consent) return <Consent data={consent} />;
  if (state.route.kind === "pair") return <Pair key={state.route.code} code={state.route.code} />;

  if (state.auth.status === "loading") {
    return (
      <div class="loading">
        <div class="spinner" />
      </div>
    );
  }
  if (state.auth.status === "signedOut") return <SignIn setUp={state.auth.setUp} />;
  return (
    <>
      <Shell />
      <Toasts />
    </>
  );
}

// Desktop opens on Today; phones start at the list of lists.
if (state.route.kind === "home" && !window.matchMedia("(max-width: 760px)").matches && location.pathname !== "/authorize") {
  navigate({ kind: "list", list: "today" }, { replace: true });
} else if (state.route.kind !== "home") {
  set({ mobileDetail: true });
}
void startDemo().then((isDemo) => {
  if (!isDemo && location.pathname !== "/authorize") void loadState();
});

render(<App />, document.getElementById("app")!);
