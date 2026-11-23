// `things3pp agent`: keep this Mac connected to your hosted Things, via a launchd user agent.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { c, fail, info, ok, warn } from "../cli/ui.js";
import { thingsInstalled } from "../cli/checks.js";
import { DatabaseError, findThingsDatabase } from "things3pp-core/things/db";
import { loadCloudConfig } from "./config.js";
import { Connector, requireWebSocket } from "./connector.js";

export const LABEL = "dev.things3pp.agent";
const plistPath = () => join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);
const logPath = () => join(homedir(), "Library/Logs/things3pp-agent.log");

function sh(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 20_000 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim() }));
  });
}

function entryScript(): string {
  // dist/index.js, wherever this chunk lives (dist/ or dist/chunks/).
  for (const rel of ["./index.js", "../index.js"]) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(p)) return p;
  }
  throw new Error("Couldn't find things3pp's entry script.");
}

function xml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function linked() {
  const cfg = loadCloudConfig();
  if (!cfg.url || !cfg.device?.deviceId || !cfg.device.accountId) return null;
  return { url: cfg.url, device: cfg.device };
}

/** Explains what a Mac without Things should do instead of syncing. */
function noThingsHelp(url: string | undefined) {
  console.log(`  Only the Mac that has Things syncs. This Mac can still use your hosted Things:`);
  console.log(`    • Web app: open ${c.cyan(url ?? "your hosted Things")} in your browser and sign in with your passkey.`);
  console.log(`    • AI apps: ${c.cyan(`things3pp mcp setup --url ${url ?? "<address>"}`)}`);
  console.log(`  If you linked this Mac by mistake, run ${c.cyan("things3pp disconnect")}.\n`);
}

export async function install(): Promise<number> {
  if (!thingsInstalled()) {
    fail("Things 3 isn't installed on this Mac, so there's nothing for the agent to sync.");
    noThingsHelp(loadCloudConfig().url);
    return 1;
  }
  if (!linked()) {
    fail(`This Mac isn't linked yet. Run ${c.cyan("things3pp connect")} first.`);
    return 1;
  }
  const entry = entryScript();
  if (/[\\/]_npx[\\/]/.test(entry)) {
    fail("You're running things3pp through npx, which uses a temporary folder the agent can't rely on.");
    console.log(`  Install it once with ${c.cyan("npm install -g things3pp")}, then run ${c.cyan("things3pp agent install")} again.`);
    return 1;
  }
  const node = process.execPath;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(node)}</string><string>${xml(entry)}</string><string>agent</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(logPath())}</string>
  <key>StandardErrorPath</key><string>${xml(logPath())}</string>
</dict>
</plist>
`;
  mkdirSync(dirname(plistPath()), { recursive: true });
  mkdirSync(dirname(logPath()), { recursive: true });
  await sh("/bin/launchctl", ["bootout", `gui/${process.getuid?.()}`, plistPath()]);
  writeFileSync(plistPath(), plist);
  const res = await sh("/bin/launchctl", ["bootstrap", `gui/${process.getuid?.()}`, plistPath()]);
  if (!res.ok) {
    fail(`launchctl couldn't start the agent: ${res.out}`);
    return 1;
  }
  ok("The agent is running and will start again when you log in.");
  console.log(`
  ${c.bold("One more step: let it read Things.")}
  macOS needs to allow ${c.cyan(node)} to read the Things database:
    1. System Settings → Privacy & Security → ${c.bold("Full Disk Access")} → +
    2. Press ⌘⇧G, paste the path above, and add it.
  The first time it changes something, macOS also asks to let it control Things. Click OK.

  Logs: ${c.dim(logPath())}
`);
  await sh("/usr/bin/open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles"]);
  return 0;
}

export function isInstalled(): boolean {
  return existsSync(plistPath());
}

export async function uninstall(): Promise<number> {
  await sh("/bin/launchctl", ["bootout", `gui/${process.getuid?.()}`, plistPath()]);
  if (existsSync(plistPath())) rmSync(plistPath());
  ok("The agent is stopped and removed.");
  return 0;
}

export async function agentStatus(): Promise<number> {
  const res = await sh("/bin/launchctl", ["print", `gui/${process.getuid?.()}/${LABEL}`]);
  if (!res.ok) {
    info(`The agent isn't installed. Install it with ${c.cyan("things3pp agent install")}.`);
    return 1;
  }
  const state = /state = (\w+)/.exec(res.out)?.[1] ?? "unknown";
  const pid = /pid = (\d+)/.exec(res.out)?.[1];
  if (state === "running") ok(`The agent is running${pid ? ` (pid ${pid})` : ""}.`);
  else warn(`The agent is installed but ${state}. Check the log: ${logPath()}`);
  return state === "running" ? 0 : 1;
}

/** Resolves once Things is installed (checked every 5 minutes). Stops cleanly on SIGINT/SIGTERM. */
function waitForThings(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!thingsInstalled()) return;
      clearInterval(timer);
      process.off("SIGINT", quit);
      process.off("SIGTERM", quit);
      resolve();
    }, 5 * 60_000);
    const quit = () => process.exit(0);
    process.on("SIGINT", quit);
    process.on("SIGTERM", quit);
  });
}

export async function run(): Promise<number> {
  requireWebSocket();
  const link = linked();
  if (!link) {
    fail(`This Mac isn't linked yet. Run ${c.cyan("things3pp connect")} first.`);
    return 1;
  }
  if (!thingsInstalled()) {
    // A Mac without Things must never sync: it would take the connection away from the Mac that has
    // Things, and changes from the web app and AI apps would fail. Wait quietly in case Things arrives.
    warn("Things 3 isn't installed on this Mac, so it won't sync. Waiting until Things is installed.");
    noThingsHelp(link.url);
    await waitForThings();
    ok("Things 3 is installed now. Starting to sync.");
  }
  try {
    findThingsDatabase();
  } catch (e) {
    if (!(e instanceof DatabaseError)) throw e;
    info("Starting in basic mode (no access to Things' data yet). Give this node Full Disk Access to add checklists, headings and This Evening.");
  }
  const connector = new Connector({ config: link });
  connector.start();
  const stop = () => {
    connector.stop();
    setTimeout(() => process.exit(0), 200);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  return await new Promise<number>(() => {});
}
