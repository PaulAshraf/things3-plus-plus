// Small helpers shared by the Worker and its Durable Objects.

export function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Human-friendly pairing code: 8 characters without look-alikes, shown as XXXX-XXXX. */
export function pairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4).join("")}`;
}

export function normalizeCode(code: string): string {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

export async function sha256(value: string): Promise<string> {
  return b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

/** Constant-time string comparison (compares SHA-256 digests so lengths don't leak). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [da, db] = await Promise.all([a, b].map((v) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))));
  const x = new Uint8Array(da!);
  const y = new Uint8Array(db!);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set("content-type", "application/json; charset=utf-8");
  h.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function problem(status: number, error: string, message: string): Response {
  return json({ error, message }, status);
}

export async function verifyEd25519(publicKeyB64url: string, signatureB64url: string, text: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", fromB64url(publicKeyB64url), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, fromB64url(signatureB64url), new TextEncoder().encode(text));
  } catch {
    return false;
  }
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A Mac socket with no ping or message for this long is treated as gone (Macs ping every 30 s). */
export const MAC_STALE_MS = 75_000;

export interface MacSocketInfo {
  deviceId?: string;
  name?: string;
  /** The device's last reported problem (null when healthy). */
  problem: string | null;
  /** Newest of: socket opened, last message, last keep-alive ping. */
  lastActive: number;
}

/**
 * Who keeps the account's one Mac connection when `deviceId` authenticates. Returns the name of a
 * different Mac that is connected, recently active and healthy (the newcomer must wait), or null
 * (the newcomer takes over). The same Mac reconnecting always replaces its old socket.
 */
export function macHolder(sockets: MacSocketInfo[], deviceId: string, now: number): string | null {
  for (const s of sockets) {
    if (!s.deviceId || s.deviceId === deviceId || s.problem !== null) continue;
    if (now - s.lastActive < MAC_STALE_MS) return s.name ?? "another Mac";
  }
  return null;
}
