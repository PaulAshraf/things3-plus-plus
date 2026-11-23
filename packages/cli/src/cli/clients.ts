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

/**
 * A hosted Things deployment's remote MCP endpoint (`https://…/mcp`). Apps reach it over HTTP and sign
 * in with OAuth (a passkey in the browser), so no token, pairing or device key is ever written here.
 */
export interface RemoteServer {
  url: string;
}

/** What setup writes into an app: a local stdio command, or a hosted remote URL. */
export type ServerTarget = LaunchCommand | RemoteServer;

export function isRemote(target: ServerTarget): target is RemoteServer {
  return "url" in target;
}

export interface ClientTarget {
  id: string;
  name: string;
  detected: boolean;
  /** Where the config lives (for messages). */
  location: string;
  /** False when the app can't take a remote server from its config file (it's added in the app instead). */
  supportsRemote: boolean;
  /** For remote servers: how to finish signing in, or (when unsupported) how to add it by hand. */
  remoteHint(url: string): string;
  isConfigured(): boolean;
  install(target: ServerTarget): Promise<string>;
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

interface JsonClientOptions {
  key?: string;
  /** Extra fields for a stdio entry (VS Code wants `type: "stdio"`). */
  stdioExtra?: object;
  /** Builds the entry for a remote server, or null if the app's config file can't hold one. */
  remoteEntry?: ((url: string) => object) | null;
  remoteHint: (url: string) => string;
}

/** Apps that use the common `{ "mcpServers": { name: { command, args, env } } }` shape. */
function jsonClient(id: string, name: string, path: string, appDir: string, opts: JsonClientOptions): ClientTarget {
  const key = opts.key ?? "mcpServers";
  const remoteEntry = opts.remoteEntry ?? null;
  return {
    id,
    name,
    location: path,
    detected: existsSync(appDir),
    supportsRemote: Boolean(remoteEntry),
    remoteHint: opts.remoteHint,
    isConfigured() {
      const servers = readJson(path)[key] as Record<string, unknown> | undefined;
      return Boolean(servers && SERVER_NAME in servers);
    },
    async install(target) {
      let entry: object;
      if (isRemote(target)) {
        if (!remoteEntry) throw new Error(opts.remoteHint(target.url));
        entry = remoteEntry(target.url);
      } else {
        entry = { ...opts.stdioExtra, command: target.command, args: target.args, ...(target.env ? { env: target.env } : {}) };
      }
      const config = readJson(path);
      const servers = (config[key] as Record<string, unknown> | undefined) ?? {};
      servers[SERVER_NAME] = entry;
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
    supportsRemote: true,
    remoteHint: () => `In Claude Code, run ${"`/mcp`"}, pick "${SERVER_NAME}" and choose Authenticate.`,
    isConfigured() {
      const servers = readJson(userConfig).mcpServers as Record<string, unknown> | undefined;
      return Boolean(servers && SERVER_NAME in servers);
    },
    async install(target) {
      if (!cli) throw new Error("claude CLI not found");
      readJson(userConfig);
      backup(userConfig);
      await run(cli, ["mcp", "remove", SERVER_NAME, "--scope", "user"]);
      const args = isRemote(target)
        ? ["mcp", "add", "--transport", "http", "--scope", "user", SERVER_NAME, target.url]
        : [
            "mcp",
            "add",
            SERVER_NAME,
            "--scope",
            "user",
            ...Object.entries(target.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
            "--",
            target.command,
            ...target.args,
          ];
      const res = await run(cli, args);
      if (!res.ok) throw new Error(res.out || "claude mcp add failed");
      return isRemote(target) ? "added with `claude mcp add --transport http --scope user`" : "added with `claude mcp add --scope user`";
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
    supportsRemote: true,
    remoteHint: () => `Run ${"`codex mcp login " + SERVER_NAME + "`"} to sign in.`,
    isConfigured() {
      return existsSync(path) && readFileSync(path, "utf8").split("\n").some((l) => l.trim() === header);
    },
    async install(target) {
      const before = existsSync(path) ? readFileSync(path, "utf8") : "";
      const cleaned = removeOwnCodexBlock(before);
      if (cleaned === null) {
        throw new Error(`${path} already has a ${header} block you added yourself, so I left it alone. Remove it to let setup manage it.`);
      }
      const lines = ["", CODEX_MARKER, header];
      if (isRemote(target)) {
        // Streamable HTTP; Codex signs in with OAuth via `codex mcp login`.
        lines.push(`url = ${tomlString(target.url)}`);
      } else {
        lines.push(`command = ${tomlString(target.command)}`, `args = [${target.args.map(tomlString).join(", ")}]`);
        if (target.env) {
          lines.push(`[mcp_servers.${SERVER_NAME}.env]`);
          for (const [k, v] of Object.entries(target.env)) lines.push(`${k} = ${tomlString(v)}`);
        }
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
    jsonClient("claude-desktop", "Claude Desktop", join(appSupport, "Claude", "claude_desktop_config.json"), join(appSupport, "Claude"), {
      // Its config file only runs local (stdio) servers. Remote ones are custom connectors, which do OAuth.
      remoteEntry: null,
      remoteHint: (url) => `Add it in Claude Desktop: Settings → Connectors → Add custom connector, and paste ${url}`,
    }),
    claudeCode(),
    codex(),
    jsonClient("cursor", "Cursor", join(home, ".cursor", "mcp.json"), join(home, ".cursor"), {
      remoteEntry: (url) => ({ url }),
      remoteHint: () => `In Cursor, open Settings → MCP and click Connect next to "${SERVER_NAME}".`,
    }),
    jsonClient("vscode", "VS Code", join(appSupport, "Code", "User", "mcp.json"), join(appSupport, "Code"), {
      key: "servers",
      stdioExtra: { type: "stdio" },
      remoteEntry: (url) => ({ type: "http", url }),
      remoteHint: () => `VS Code asks you to sign in the first time it starts "${SERVER_NAME}". Click Allow.`,
    }),
  ];
}
