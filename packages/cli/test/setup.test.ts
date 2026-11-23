import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Pretend Things 3 isn't installed (this is the client-only computer).
const things = vi.hoisted(() => ({ installed: false }));
vi.mock("../src/cli/checks.js", async (orig) => ({
  ...(await orig<typeof import("../src/cli/checks.js")>()),
  thingsInstalled: () => things.installed,
  checkThingsAccess: async () => ({ ok: true, version: "3.test" }),
}));

const { hostedMcpUrl, setup } = await import("../src/cli/setup.js");

let home: string;
const saved = { HOME: process.env.HOME, PATH: process.env.PATH, CFG: process.env.THINGS3PP_CONFIG_DIR };
const metadata = (url: string) =>
  vi.fn(async () => new Response(JSON.stringify({ resource: url, authorization_servers: [new URL(url).origin] }), { status: 200 }));

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "things3pp-setup-"));
  process.env.HOME = home;
  process.env.THINGS3PP_CONFIG_DIR = join(home, "cfg");
  // A fake `claude` that records its arguments instead of touching the real Claude Code config.
  const bin = join(home, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), `#!/bin/sh\necho "$@" >> "${home}/claude-args"\n`);
  chmodSync(join(bin, "claude"), 0o755);
  process.env.PATH = bin;
  mkdirSync(join(home, ".cursor"), { recursive: true });
  mkdirSync(join(home, ".codex"), { recursive: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  things.installed = false;
});
afterEach(() => {
  process.env.HOME = saved.HOME;
  process.env.PATH = saved.PATH;
  if (saved.CFG === undefined) delete process.env.THINGS3PP_CONFIG_DIR;
  else process.env.THINGS3PP_CONFIG_DIR = saved.CFG;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  rmSync(home, { recursive: true, force: true });
});

function writeCloudConfig(cfg: object) {
  const dir = process.env.THINGS3PP_CONFIG_DIR!;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "cloud.json"), JSON.stringify(cfg), { mode: 0o600 });
}

const output = () => (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.join(" ")).join("\n");

describe("hostedMcpUrl", () => {
  it("accepts a bare host, an origin or the /mcp address", () => {
    expect(hostedMcpUrl("things.example.com")).toBe("https://things.example.com/mcp");
    expect(hostedMcpUrl("https://things.example.com/")).toBe("https://things.example.com/mcp");
    expect(hostedMcpUrl("https://things.example.com/mcp")).toBe("https://things.example.com/mcp");
  });
  it("refuses plain http and other paths", () => {
    expect(() => hostedMcpUrl("http://things.example.com")).toThrow(/https/);
    expect(() => hostedMcpUrl("https://things.example.com/today")).toThrow(/just the address/);
  });
});

describe("mcp setup with hosted Things", () => {
  it("--url configures Codex, Claude Code and Cursor with the remote URL only, no Things or pairing", async () => {
    const fetchMock = metadata("https://things.example.com/mcp");
    vi.stubGlobal("fetch", fetchMock);
    expect(await setup({ yes: true, url: "https://things.example.com" })).toBe(0);

    expect(fetchMock).toHaveBeenCalledWith("https://things.example.com/.well-known/oauth-protected-resource/mcp", expect.anything());
    expect(JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8")).mcpServers.things).toEqual({ url: "https://things.example.com/mcp" });
    expect(readFileSync(join(home, ".codex", "config.toml"), "utf8")).toContain('url = "https://things.example.com/mcp"');
    const claudeArgs = readFileSync(join(home, "claude-args"), "utf8");
    expect(claudeArgs).toContain("mcp add --transport http --scope user things https://things.example.com/mcp");
    expect(claudeArgs).not.toMatch(/--header|Authorization/);
    // Only the address is remembered (for doctor and later runs): no device key on a client-only computer.
    const cloud = JSON.parse(readFileSync(join(process.env.THINGS3PP_CONFIG_DIR!, "cloud.json"), "utf8"));
    expect(cloud).toEqual({ url: "https://things.example.com" });
    expect(output()).toContain("codex mcp login things");
  });

  it("uses the saved hosted address when Things 3 isn't installed", async () => {
    writeCloudConfig({ url: "https://saved.example.com" });
    vi.stubGlobal("fetch", metadata("https://saved.example.com/mcp"));
    expect(await setup({ yes: true })).toBe(0);
    expect(JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8")).mcpServers.things).toEqual({ url: "https://saved.example.com/mcp" });
  });

  it("without Things or a saved address, explains how to pass --url and changes nothing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await setup({ yes: true })).toBe(1);
    expect(output()).toContain("things3pp mcp setup --url");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(false);
  });

  it("--hosted with no saved address asks for --url", async () => {
    expect(await setup({ yes: true, hosted: true })).toBe(1);
    expect(output()).toContain("--url");
  });

  it("keeps local setup when Things 3 is installed, even if a hosted address is saved", async () => {
    if (process.platform !== "darwin") return;
    things.installed = true;
    writeCloudConfig({ url: "https://saved.example.com" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await setup({ yes: true })).toBe(0);
    const entry = JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8")).mcpServers.things;
    expect(entry.url).toBeUndefined();
    expect(entry.args).toContain("mcp");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still writes the config when the address can't be checked, with a warning", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    expect(await setup({ yes: true, url: "things.example.com" })).toBe(0);
    expect(output()).toMatch(/answered 404/);
    expect(JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8")).mcpServers.things).toEqual({ url: "https://things.example.com/mcp" });
  });
});
