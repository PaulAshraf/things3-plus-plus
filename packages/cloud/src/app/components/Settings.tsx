import { startRegistration } from "@simplewebauthn/browser";
import { useState } from "preact/hooks";
import { IconChevronLeft, IconGear, IconKey, IconLaptop } from "../icons.tsx";
import { api, loadState, navigate, signOut, state, toast } from "../store.ts";

type Theme = "auto" | "light" | "dark";

export function applyTheme(theme: Theme) {
  if (theme === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}
export function savedTheme(): Theme {
  try {
    const t = localStorage.getItem("things3pp-theme");
    return t === "light" || t === "dark" ? t : "auto";
  } catch {
    return "auto";
  }
}

export function Settings() {
  const [theme, setTheme] = useState<Theme>(savedTheme());
  const mcpUrl = `${location.origin}/mcp`;
  const isPhone = window.matchMedia("(max-width: 760px)").matches;

  const changeTheme = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
    try {
      localStorage.setItem("things3pp-theme", t);
    } catch {
      /* private mode */
    }
  };

  const addPasskey = async () => {
    try {
      const optionsJSON = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/api/passkeys/options", {});
      const credential = await startRegistration({ optionsJSON });
      await api("/api/passkeys/add", { credential });
      toast("Passkey added.");
    } catch (e) {
      const name = (e as { name?: string }).name;
      toast(name === "NotAllowedError" ? "Cancelled." : name === "InvalidStateError" ? "This device already has a passkey here." : e instanceof Error ? e.message : "Couldn't add the passkey.");
    }
  };

  const removeDevice = async (id: string, name: string) => {
    if (!confirm(`Unlink "${name}"? It stops syncing until you run things3pp connect on it again.`)) return;
    await api("/api/devices/remove", { id }).catch((e: Error) => toast(e.message));
    await loadState();
  };

  return (
    <div class="page settings">
      {isPhone && (
        <button class="mobile-back" onClick={() => navigate({ kind: "home" })}>
          <IconChevronLeft /> Lists
        </button>
      )}
      <div class="list-head">
        <span class="icon">
          <IconGear style={{ color: "var(--text-2)" }} />
        </span>
        <h1 class="list-title">Settings</h1>
      </div>

      <div style={{ height: "24px" }} />
      <h2>Your Mac</h2>
      <div class="settings-list">
        {state.devices.length === 0 && (
          <div class="settings-row">
            <div class="grow sub">No Mac linked. Run things3pp connect on your Mac.</div>
          </div>
        )}
        {state.devices.map((d) => (
          <div key={d.id} class="settings-row">
            <IconLaptop style={{ width: "20px", height: "20px", color: "var(--text-2)" }} />
            <div class="grow">
              <div>{d.name}</div>
              <div class="sub">
                {d.online ? "Connected" : d.lastSeenAt ? `Last seen ${new Date(d.lastSeenAt).toLocaleString()}` : "Never connected"}
                {state.mac?.problem && d.online ? ` · ${state.mac.problem}` : ""}
              </div>
            </div>
            <button class="danger-btn" onClick={() => removeDevice(d.id, d.name)}>
              Unlink
            </button>
          </div>
        ))}
      </div>

      <h2>Use Things from Claude, ChatGPT and other AI apps</h2>
      <div class="settings-list">
        <div class="settings-row">
          <div class="grow">
            <div>Remote MCP server</div>
            <div class="sub">Add this as a custom connector. You'll approve it here with your passkey.</div>
          </div>
        </div>
        <div class="settings-row">
          <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{mcpUrl}</code>
          <button
            class="link-btn"
            onClick={() =>
              navigator.clipboard.writeText(mcpUrl).then(
                () => toast("Copied."),
                () => toast("Couldn't copy. Select the address instead."),
              )
            }
          >
            Copy
          </button>
        </div>
      </div>

      <h2>Appearance</h2>
      <div class="settings-list">
        {(["auto", "light", "dark"] as Theme[]).map((t) => (
          <label key={t} class="settings-row" style={{ cursor: "default" }}>
            <input type="radio" name="theme" checked={theme === t} onChange={() => changeTheme(t)} />
            <div class="grow">{t === "auto" ? "Match system" : t === "light" ? "Light" : "Dark"}</div>
          </label>
        ))}
      </div>

      <h2>Account</h2>
      <div class="settings-list">
        <div class="settings-row">
          <IconKey style={{ width: "20px", height: "20px", color: "var(--text-2)" }} />
          <div class="grow">
            <div>Passkeys</div>
            <div class="sub">Add one for another device or password manager.</div>
          </div>
          <button class="link-btn" onClick={addPasskey}>
            Add passkey
          </button>
        </div>
        <div class="settings-row">
          <div class="grow">Sign out of this browser</div>
          <button class="danger-btn" onClick={() => void signOut()}>
            Sign Out
          </button>
        </div>
      </div>
      <p class="sub" style={{ color: "var(--text-3)", fontSize: "12.5px" }}>
        Keyboard: Space new to-do · Return open · ⌘K complete · ⌘S when · ⌥T today · ⌥E this evening · ⌥A anytime · ⌥O someday · ⌥D deadline · ⌥G tags · ⌥M move · ⌘F or just start typing to find · ⌥1–7 lists
      </p>
    </div>
  );
}
