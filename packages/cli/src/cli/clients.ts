// Knows where each AI app keeps its MCP config and how to add this server to it.
import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const SERVER_NAME = "things";
export const PACKAGE_NAME = "things3pp";

export interface LaunchCommand {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * How AI apps should start this server. Uses absolute paths because GUI apps (Claude Desktop, Cursor…)
 * don't inherit your shell PATH, which breaks nvm/fnm/Homebrew installs.
 */
export function launchCommand(): LaunchCommand {
  const entry = fileURLToPath(new URL("../index.js", import.meta.url));
  const nodeDir = dirname(process.execPath);
  const isEphemeral = /[\\/]_npx[\\/]/.test(entry);
  if (!isEphemeral) {
    // Running from a checkout or a global install: point straight at this file.
    return { command: process.execPath, args: [entry, "mcp"] };
  }
  const npx = join(nodeDir, "npx");
  return {
    command: existsSync(npx) ? npx : "npx",
    args: ["-y", PACKAGE_NAME, "mcp"],
    env: { PATH: [nodeDir, "/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"].join(delimiter) },
  };
}

export interface ClientTarget {
  id: string;
  name: string;
  detected: boolean;
  /** Where the config lives (for messages). */
  location: string;
  isConfigured(): boolean;
  install(launch: LaunchCommand): Promise<string>;
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error(`${path} isn't valid JSON, so I won't touch it. Fix it or add the server manually.`);
  }
}

function backup(path: string): string | null {
  if (!existsSync(path)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${path}.backup-${stamp}`;
  copyFileSync(path, dest);
  return dest;
}

function writeJson(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

/** Apps that use the common `{ "mcpServers": { name: { command, args, env } } }` shape. */
function jsonClient(id: string, name: string, path: string, appDir: string, key = "mcpServers", extra: object = {}): ClientTarget {
  return {
    id,
    name,
    location: path,
    detected: existsSync(appDir),
    isConfigured() {
      const servers = readJson(path)[key] as Record<string, unknown> | undefined;
      return Boolean(servers && SERVER_NAME in servers);
    },
    async install(launch) {
      const config = readJson(path);
      const servers = (config[key] as Record<string, unknown> | undefined) ?? {};
      servers[SERVER_NAME] = { ...extra, command: launch.command, args: launch.args, ...(launch.env ? { env: launch.env } : {}) };
      config[key] = servers;
      const saved = backup(path);
      writeJson(path, config);
      return saved ? `updated ${path} (backup: ${saved})` : `created ${path}`;
    },
  };
}

function run(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 20_000 }, (err, stdout, stderr) => resolve({ ok: !err, out: `${stdout}${stderr}`.trim() }));
  });
}

function which(bin: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const p = join(dir, bin);
    if (dir && existsSync(p)) return p;
  }
  return null;
}

function claudeCode(): ClientTarget {
  const cli = which("claude");
  const userConfig = join(homedir(), ".claude.json");
  return {
    id: "claude-code",
    name: "Claude Code",
    location: "claude mcp (user scope)",
    detected: Boolean(cli),
    isConfigured() {
      const servers = readJson(userConfig).mcpServers as Record<string, unknown> | undefined;
      return Boolean(servers && SERVER_NAME in servers);
    },
    async install(launch) {
      if (!cli) throw new Error("claude CLI not found");
      const envArgs = Object.entries(launch.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
      await run(cli, ["mcp", "remove", SERVER_NAME, "--scope", "user"]);
      const res = await run(cli, ["mcp", "add", SERVER_NAME, "--scope", "user", ...envArgs, "--", launch.command, ...launch.args]);
      if (!res.ok) throw new Error(res.out || "claude mcp add failed");
      return "added with `claude mcp add --scope user`";
    },
  };
}

const CODEX_MARKER = `# Added by ${PACKAGE_NAME} setup`;

/**
 * Removes the block a previous setup run wrote (marker comment + [mcp_servers.things] + its sub-tables).
 * Returns null if a [mcp_servers.things] block exists that we didn't write — we never edit those.
 */
export function removeOwnCodexBlock(toml: string): string | null {
  const lines = toml.split("\n");
  const header = `[mcp_servers.${SERVER_NAME}]`;
  const start = lines.findIndex((l) => l.trim() === header);
  if (start === -1) return toml;
  if (lines[start - 1]?.trim() !== CODEX_MARKER) return null;
  let end = start + 1;
  while (end < lines.length) {
    const t = lines[end]!.trim();
    if (t.startsWith("[") && !t.startsWith(`[mcp_servers.${SERVER_NAME}.`)) break;
    if (t === CODEX_MARKER) break;
    end++;
  }
  let from = start - 1;
  while (from > 0 && lines[from - 1]!.trim() === "") from--;
  return [...lines.slice(0, from), ...lines.slice(end)].join("\n");
}

function codex(): ClientTarget {
  const dir = join(homedir(), ".codex");
  const path = join(dir, "config.toml");
  const header = `[mcp_servers.${SERVER_NAME}]`;
  const tomlString = (s: string) => JSON.stringify(s); // JSON strings are valid TOML basic strings
  return {
    id: "codex",
    name: "Codex",
    location: path,
    detected: existsSync(dir) || Boolean(which("codex")),
    isConfigured() {
      return existsSync(path) && readFileSync(path, "utf8").split("\n").some((l) => l.trim() === header);
    },
    async install(launch) {
      const before = existsSync(path) ? readFileSync(path, "utf8") : "";
      const cleaned = removeOwnCodexBlock(before);
      if (cleaned === null) {
        throw new Error(`${path} already has a ${header} block you added yourself, so I left it alone. Remove it to let setup manage it.`);
      }
      const lines = [
        "",
        CODEX_MARKER,
        header,
        `command = ${tomlString(launch.command)}`,
        `args = [${launch.args.map(tomlString).join(", ")}]`,
      ];
      if (launch.env) {
        lines.push(`[mcp_servers.${SERVER_NAME}.env]`);
        for (const [k, v] of Object.entries(launch.env)) lines.push(`${k} = ${tomlString(v)}`);
      }
      const saved = backup(path);
      mkdirSync(dir, { recursive: true });
      const base = cleaned.replace(/\s*$/, "");
      writeFileSync(path, `${base ? `${base}\n` : ""}${lines.join("\n")}\n`);
      return saved ? `updated ${path} (backup: ${saved})` : `created ${path}`;
    },
  };
}

export function allClients(): ClientTarget[] {
  const home = homedir();
  const appSupport = join(home, "Library", "Application Support");
  return [
    jsonClient("claude-desktop", "Claude Desktop", join(appSupport, "Claude", "claude_desktop_config.json"), join(appSupport, "Claude")),
    claudeCode(),
    codex(),
    jsonClient("cursor", "Cursor", join(home, ".cursor", "mcp.json"), join(home, ".cursor")),
    jsonClient("vscode", "VS Code", join(appSupport, "Code", "User", "mcp.json"), join(appSupport, "Code"), "servers", { type: "stdio" }),
  ];
}
