import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { cli, connectStdio, enabled, entry } from "./support.js";

function filesUnder(dir: string) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile())
    .map((item) => relative(dir, join(item.parentPath, item.name)));
}

describe.runIf(enabled)("built CLI", () => {
  it("handles help, version, unknown commands and a real TTY", () => {
    const help = cli(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Run as an MCP server over stdio");
    const version = cli(["--version"]);
    expect(version.status).toBe(0);
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
    const unknown = cli(["unexpected"]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain("Unknown command: unexpected");
    const stdin = openSync("/dev/null", "r");
    try {
      const tty = spawnSync("/usr/bin/script", ["-q", "/dev/null", process.execPath, entry], {
        stdio: [stdin, "pipe", "pipe"], encoding: "utf8", timeout: 10_000,
      });
      expect(tty.status, tty.stderr).toBe(0);
      expect(tty.stdout).toContain("Run as an MCP server over stdio");
    } finally {
      closeSync(stdin);
    }
  });

  it("runs doctor and verifies setup, backups, and the generated launch config", async () => {
    const home = mkdtempSync(join(tmpdir(), "things-e2e-home-"));
    const env = { ...process.env, HOME: home, PATH: "/usr/bin:/bin", THINGS3PP_CONFIG_DIR: join(home, "token-dir") };
    const desktop = "Library/Application Support/Claude/claude_desktop_config.json";
    const codex = ".codex/config.toml";
    const paths = [desktop, ".cursor/mcp.json", "Library/Application Support/Code/User/mcp.json"];
    const config = (path: string) => join(home, path);
    const other = { command: "/usr/bin/true" };
    const key = (path: string) => path.includes("/Code/") ? "servers" : "mcpServers";
    const read = (path: string) => readFileSync(config(path), "utf8");
    const json = (path: string) => JSON.parse(read(path));
    const backups = (path: string) => filesUnder(home).filter((p) => p.startsWith(`${path}.backup-`));
    const originalToml = '[mcp_servers.unrelated]\ncommand = "/usr/bin/true"\n';
    try {
      const doctor = cli(["doctor"], env);
      expect(doctor.status, doctor.stdout).toBe(0);
      expect(doctor.stdout).toMatch(/Things \d+\.\d+.*reachable/);
      expect(doctor.stdout).toContain("Remote access");

      for (const path of paths) {
        mkdirSync(dirname(config(path)), { recursive: true });
        writeFileSync(config(path), JSON.stringify({ [key(path)]: { unrelated: other } }));
      }
      mkdirSync(dirname(config(codex)), { recursive: true });
      writeFileSync(config(codex), originalToml);

      const setup = cli(["mcp", "setup", "--yes"], env);
      expect(setup.status, setup.stdout).toBe(0);
      expect(setup.stdout).toContain("Connected to Things");
      const launch = json(desktop).mcpServers.things;
      expect(launch).toMatchObject({ command: process.execPath, args: [entry, "mcp"] });
      for (const path of paths) {
        expect(backups(path)).toHaveLength(1);
        expect(json(backups(path)[0])[key(path)]).toEqual({ unrelated: other });
        expect(json(path)[key(path)]).toEqual({
          unrelated: other, things: path.includes("/Code/") ? { ...launch, type: "stdio" } : launch,
        });
        writeFileSync(config(path), JSON.stringify({ [key(path)]: { unrelated: other, things: other } }));
      }
      const firstToml = read(codex);
      expect(firstToml).toContain(originalToml);
      expect(firstToml).toContain(`[mcp_servers.things]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(entry)}]`);
      expect(backups(codex)).toHaveLength(1);
      expect(read(backups(codex)[0])).toBe(originalToml);

      // A second run updates setup's own Codex block in place instead of duplicating it.
      const second = cli(["mcp", "setup", "--yes"], env);
      expect(second.status, second.stdout).toBe(0);
      expect(read(codex)).toBe(firstToml);
      expect(read(codex).split("[mcp_servers.things]").length).toBe(2);
      expect(backups(codex)).toHaveLength(2);
      for (const path of paths) {
        expect(json(path)[key(path)].things.command).toBe(launch.command);
        expect(json(path)[key(path)].unrelated).toEqual(other);
        expect(backups(path)).toHaveLength(2);
        expect(backups(path).some((p) => json(p)[key(path)].things?.command === other.command)).toBe(true);
      }
      expect(filesUnder(home)).toHaveLength(12); // includes the second Codex backup
      expect(existsSync(config(".claude.json"))).toBe(false);
      const client = await connectStdio({ ...json(desktop).mcpServers.things, env: { ...env, ...launch.env } });
      try {
        expect((await client.listTools()).tools).toHaveLength(13);
      } finally {
        await client.close();
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 125_000);
});
