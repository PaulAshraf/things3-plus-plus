import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allClients, launchCommand, removeOwnCodexBlock } from "../src/cli/clients.js";
import { isTailscaleIPv4 } from "../src/tailscale.js";

let home: string;
const realHome = process.env.HOME;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "things3pp-home-"));
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = realHome;
  rmSync(home, { recursive: true, force: true });
});

const launch = { command: "/usr/local/bin/node", args: ["/x/dist/index.js"] };
const byId = (id: string) => allClients().find((c) => c.id === id)!;

describe("client config writers", () => {
  it("adds to Claude Desktop without losing existing servers, and backs up first", async () => {
    const dir = join(home, "Library", "Application Support", "Claude");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "claude_desktop_config.json");
    writeFileSync(file, JSON.stringify({ mcpServers: { other: { command: "x" } }, theme: "dark" }));

    const desktop = byId("claude-desktop");
    expect(desktop.detected).toBe(true);
    expect(desktop.isConfigured()).toBe(false);
    await desktop.install(launch);

    const cfg = JSON.parse(readFileSync(file, "utf8"));
    expect(cfg.theme).toBe("dark");
    expect(cfg.mcpServers.other).toEqual({ command: "x" });
    expect(cfg.mcpServers.things).toEqual({ command: launch.command, args: launch.args });
    expect(readdirSync(dir).some((f) => f.startsWith("claude_desktop_config.json.backup-"))).toBe(true);
    expect(desktop.isConfigured()).toBe(true);
  });

  it("refuses to overwrite a broken JSON config", async () => {
    const dir = join(home, ".cursor");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "mcp.json"), "{ not json");
    await expect(byId("cursor").install(launch)).rejects.toThrow(/isn't valid JSON/);
    expect(readFileSync(join(dir, "mcp.json"), "utf8")).toBe("{ not json");
  });

  it("uses VS Code's servers key with an explicit stdio type", async () => {
    mkdirSync(join(home, "Library", "Application Support", "Code", "User"), { recursive: true });
    await byId("vscode").install(launch);
    const cfg = JSON.parse(readFileSync(join(home, "Library", "Application Support", "Code", "User", "mcp.json"), "utf8"));
    expect(cfg.servers.things).toMatchObject({ type: "stdio", command: launch.command });
  });

  it("appends a valid block to Codex config.toml and won't duplicate it", async () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    const file = join(home, ".codex", "config.toml");
    writeFileSync(file, 'model = "gpt"\n');
    const codex = byId("codex");
    await codex.install({ ...launch, env: { PATH: "/a b:/c" } });
    const toml = readFileSync(file, "utf8");
    expect(toml).toContain('model = "gpt"');
    expect(toml).toContain("[mcp_servers.things]");
    expect(toml).toContain('command = "/usr/local/bin/node"');
    expect(toml).toContain('args = ["/x/dist/index.js"]');
    expect(toml).toContain('PATH = "/a b:/c"');
    expect(codex.isConfigured()).toBe(true);

    // Re-running replaces our own block (and its env sub-table) instead of duplicating it.
    await codex.install({ command: "/opt/node", args: ["/y/index.js"] });
    const again = readFileSync(file, "utf8");
    expect(again.split("[mcp_servers.things]").length).toBe(2);
    expect(again).toContain('command = "/opt/node"');
    expect(again).not.toContain("PATH =");
    expect(again.startsWith('model = "gpt"\n')).toBe(true);
  });

  it("never edits a Codex block the user wrote by hand", async () => {
    mkdirSync(join(home, ".codex"), { recursive: true });
    const file = join(home, ".codex", "config.toml");
    const mine = '[mcp_servers.things]\ncommand = "mine"\n\n[other]\nx = 1\n';
    writeFileSync(file, mine);
    await expect(byId("codex").install(launch)).rejects.toThrow(/added yourself/);
    expect(readFileSync(file, "utf8")).toBe(mine);
  });

  it("keeps tables that follow our Codex block", () => {
    const toml = 'a = 1\n\n# Added by things3pp setup\n[mcp_servers.things]\ncommand = "x"\n[mcp_servers.things.env]\nPATH = "p"\n\n[profiles.work]\nmodel = "m"\n';
    expect(removeOwnCodexBlock(toml)).toBe('a = 1\n[profiles.work]\nmodel = "m"\n');
  });

  it("points at this checkout with an absolute node path when not run via npx", () => {
    const cmd = launchCommand();
    expect(cmd.command).toBe(process.execPath);
    expect(cmd.args[0]).toMatch(/index\.js$/);
  });
});

describe("tailscale", () => {
  it("recognises Tailscale's address range only", () => {
    expect(isTailscaleIPv4("100.64.0.1")).toBe(true);
    expect(isTailscaleIPv4("100.127.255.255")).toBe(true);
    expect(isTailscaleIPv4("100.128.0.1")).toBe(false);
    expect(isTailscaleIPv4("192.168.1.10")).toBe(false);
    expect(isTailscaleIPv4("100.64.0")).toBe(false);
  });
});
