import { state } from "../store.ts";

function ago(iso: string | null): string {
  if (!iso) return "a while ago";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

/** A small banner when your Mac can't be reached or reported a problem. Silent when all is well. */
export function MacStatus() {
  if (!state.connected && state.snapshot) {
    return (
      <div class="mac-pill warn" role="status">
        <span class="dot" /> Reconnecting…
      </div>
    );
  }
  const mac = state.mac;
  if (!mac) return null;
  if (!mac.online) {
    return (
      <div class="mac-pill" role="status" title="Your lists are from the last time your Mac was online. Changes need it to be awake.">
        <span class="dot" />
        <span>
          {mac.name ?? "Your Mac"} is offline · updated {ago(mac.lastSeen)}
        </span>
      </div>
    );
  }
  if (!mac.problem && state.snapshot?.capabilities.database === false) {
    return (
      <div class="mac-pill info" role="status" title="Your Mac is reading Things through AppleScript. Give the things3pp agent access to Things' data (Full Disk Access) to add checklists, headings and This Evening.">
        <span class="dot" />
        <span>Basic mode · checklists, headings and This Evening need access to Things' data on your Mac</span>
      </div>
    );
  }
  if (mac.problem) {
    return (
      <div class="mac-pill warn" role="status" title={mac.problem}>
        <span class="dot" />
        <span>{mac.problem.length > 110 ? `${mac.problem.slice(0, 110)}…` : mac.problem}</span>
      </div>
    );
  }
  return null;
}
