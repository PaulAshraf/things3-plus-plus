// Where this Mac keeps its link to your hosted Things: ~/.config/things3pp/cloud.json (0600).
// Holds the Worker URL, the deploy-time setup key, and this Mac's device key (Ed25519).
import { generateKeyPairSync, type KeyObject, createPrivateKey, sign } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { configDir } from "../config.js";

export interface CloudConfig {
  /** e.g. https://things3pp.you.workers.dev */
  url?: string;
  /** Lets this Mac claim a fresh deployment. Set by `things3pp cloud deploy`. */
  setupKey?: string;
  workerName?: string;
  device?: {
    name: string;
    /** PKCS#8 PEM. Never leaves this Mac. */
    privateKey: string;
    /** Raw Ed25519 public key, base64url. */
    publicKey: string;
    /** Set once paired. */
    accountId?: string;
    deviceId?: string;
  };
}

export function cloudConfigPath(): string {
  return join(configDir(), "cloud.json");
}

export function loadCloudConfig(): CloudConfig {
  const path = cloudConfigPath();
  if (!existsSync(path)) return {};
  const mode = statSync(path).mode & 0o777;
  if (mode & 0o077) throw new Error(`${path} is readable by other users (mode ${mode.toString(8)}). Run: chmod 600 "${path}"`);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as CloudConfig;
  } catch {
    throw new Error(`${path} isn't valid JSON. Fix it, or delete it and run things3pp connect again.`);
  }
}

export function saveCloudConfig(cfg: CloudConfig): void {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const path = cloudConfigPath();
  writeFileSync(path, `${JSON.stringify(cfg, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function normalizeUrl(input: string): string {
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s);
  if (u.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(u.hostname)) {
    throw new Error("Use an https:// address (http is only allowed for localhost while developing).");
  }
  return u.origin;
}

/** A friendly name for this Mac, e.g. "Paul's MacBook Pro". */
export function macName(): string {
  const name = hostname().replace(/\.local$/, "").replace(/-/g, " ");
  return name.replace(/[^\p{L}\p{N} ’'._()-]/gu, "").slice(0, 64) || "Mac";
}

export function ensureDeviceKey(cfg: CloudConfig): NonNullable<CloudConfig["device"]> {
  if (cfg.device?.privateKey && cfg.device.publicKey) return cfg.device;
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  cfg.device = {
    name: macName(),
    privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKey: jwk.x,
  };
  return cfg.device;
}

let keyCache: { pem: string; key: KeyObject } | undefined;
export function signWithDevice(device: NonNullable<CloudConfig["device"]>, text: string): string {
  if (keyCache?.pem !== device.privateKey) keyCache = { pem: device.privateKey, key: createPrivateKey(device.privateKey) };
  return sign(null, Buffer.from(text), keyCache.key).toString("base64url");
}
