// Only the Mac with Things syncs: on a Mac without Things the agent must never connect, and
// `agent install` / `disconnect` behave accordingly.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const things = vi.hoisted(() => ({ installed: false }));
const connectors = vi.hoisted(() => ({ started: 0 }));
const launchctl = vi.hoisted(() => ({ calls: [] as string[][] }));

vi.mock("../src/cli/checks.js", async (orig) => ({
  ...(await orig<typeof import("../src/cli/checks.js")>()),
  thingsInstalled: () => things.installed,
}));
vi.mock("../src/cloud/connector.js", () => ({
  requireWebSocket: () => {},
  Connector: class {
    start() {
      connectors.started++;
    }
    stop() {}
  },
}));
vi.mock("node:child_process", async (orig) => ({
  ...(await orig<typeof import("node:child_process")>()),
  execFile: (cmd: string, args: string[], _opts: unknown, cb: (err: null, out: string, err2: string) => void) => {
    launchctl.calls.push([cmd, ...args]);
    cb(null, "", "");
  },
}));

const { ensureDeviceKey, loadCloudConfig, saveCloudConfig } = await import("../src/cloud/config.js");
const agent = await import("../src/cloud/agent.js");
const { disconnect } = await import("../src/cloud/connect.js");

let home: string;
const saved = { HOME: process.env.HOME, CFG: process.env.THINGS3PP_CONFIG_DIR };

function link() {
  const cfg = { url: "https://things.example.com" } as Parameters<typeof saveCloudConfig>[0];
  const device = ensureDeviceKey(cfg);
  device.deviceId = "dev_test";
  device.accountId = "acc_test";
  saveCloudConfig(cfg);
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "things3pp-agent-"));
  process.env.HOME = home;
  process.env.THINGS3PP_CONFIG_DIR = join(home, "cfg");
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  things.installed = false;
  connectors.started = 0;
  launchctl.calls = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env.HOME = saved.HOME;
  if (saved.CFG === undefined) delete process.env.THINGS3PP_CONFIG_DIR;
  else process.env.THINGS3PP_CONFIG_DIR = saved.CFG;
  rmSync(home, { recursive: true, force: true });
});

describe("agent on a Mac without Things", () => {
  it("refuses to install", async () => {
    link();
    expect(await agent.install()).toBe(1);
    expect(launchctl.calls).toEqual([]);
  });

  it("never connects, and starts syncing once Things is installed", async () => {
    vi.useFakeTimers();
    link();
    void agent.run();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(connectors.started).toBe(0);
    things.installed = true;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(connectors.started).toBe(1);
  });
});

describe("agent on the Things Mac", () => {
  it("connects straight away", async () => {
    things.installed = true;
    link();
    void agent.run();
    await new Promise((r) => setTimeout(r, 10));
    expect(connectors.started).toBe(1);
  });
});

describe("disconnect", () => {
  it("unlinks and removes the background agent", async () => {
    link();
    const plist = join(home, "Library/LaunchAgents", `${agent.LABEL}.plist`);
    mkdirSync(join(home, "Library/LaunchAgents"), { recursive: true });
    writeFileSync(plist, "<plist/>");
    expect(await disconnect()).toBe(0);
    expect(loadCloudConfig().device).toBeUndefined();
    expect(existsSync(plist)).toBe(false);
    expect(launchctl.calls.some((c) => c.includes("bootout"))).toBe(true);
  });
});
