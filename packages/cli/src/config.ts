import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** ~/.config/things3pp (honours XDG_CONFIG_HOME, overridable with THINGS3PP_CONFIG_DIR for tests). */
export function configDir(): string {
  if (process.env.THINGS3PP_CONFIG_DIR) return process.env.THINGS3PP_CONFIG_DIR;
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(base, "things3pp");
}

export function tokenPath(): string {
  return join(configDir(), "token");
}

function ensureDir(): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

/** 256-bit random token, URL-safe. */
export function generateToken(): string {
  return `t3pp_${randomBytes(32).toString("base64url")}`;
}

export function writeToken(token: string): void {
  ensureDir();
  writeFileSync(tokenPath(), `${token}\n`, { mode: 0o600 });
  chmodSync(tokenPath(), 0o600);
}

/** Returns the stored token, creating one on first use. Refuses a token file others can read. */
export function loadOrCreateToken(): { token: string; created: boolean } {
  const path = tokenPath();
  if (existsSync(path)) {
    const mode = statSync(path).mode & 0o777;
    if (mode & 0o077) {
      throw new Error(`${path} is readable by other users (mode ${mode.toString(8)}). Run: chmod 600 "${path}"`);
    }
    const token = readFileSync(path, "utf8").trim();
    if (token.length >= 32) return { token, created: false };
  }
  const token = generateToken();
  writeToken(token);
  return { token, created: true };
}

export function rotateToken(): string {
  const token = generateToken();
  writeToken(token);
  return token;
}
