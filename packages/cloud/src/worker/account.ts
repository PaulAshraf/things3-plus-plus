// Account: one per user. Holds passkeys, browser sessions, paired Macs, the latest snapshot of
// their Things data, and the live WebSockets (one Mac, any number of browser tabs).

import { DurableObject } from "cloudflare:workers";
import { applyPatch, emptySnapshot, type Area, type Snapshot, type SnapshotPatch, type Tag, type Task } from "things3pp-core/model/types";
import {
  ActionSchema,
  challengeText,
  type ActionResult,
  type HubToBrowser,
  type HubToMac,
  type MacState,
  type MacToHub,
} from "things3pp-core/relay/protocol";
import { macHolder, randomToken, sha256, verifyEd25519 } from "./util.ts";

const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const CALL_TIMEOUT_MS = 30_000;
const AUTH_TIMEOUT_MS = 15_000;
const MAX_SESSIONS = 50;

export interface StoredCredential {
  id: string;
  publicKey: string;
  counter: number;
  transports: string[];
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export interface DeviceInfo {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
  online: boolean;
}

interface SocketMeta {
  kind: "mac" | "mac-pending" | "browser";
  nonce?: string;
  deviceId?: string;
  openedAt: number;
}

export class Account extends DurableObject {
  private readonly sql: SqlStorage;
  private cache: Snapshot | null = null;
  private readonly pending = new Map<string, { resolve: (r: ActionResult) => void; timer: ReturnType<typeof setTimeout> }>();

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS credentials (
        id TEXT PRIMARY KEY, public_key TEXT NOT NULL, counter INTEGER NOT NULL, transports TEXT NOT NULL,
        name TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS sessions (
        hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, user_agent TEXT
      );
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY, public_key TEXT NOT NULL, name TEXT NOT NULL, created_at INTEGER NOT NULL,
        last_seen_at INTEGER, problem TEXT
      );
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS areas (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, data TEXT NOT NULL);
    `);
    // Answer keep-alive pings without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));
  }

  // ----- passkeys -----

  hasCredentials(): boolean {
    return this.sql.exec("SELECT 1 FROM credentials LIMIT 1").toArray().length > 0;
  }

  credential(id: string): StoredCredential | null {
    const r = this.sql.exec<Record<string, string | number | null>>("SELECT * FROM credentials WHERE id = ?", id).toArray()[0];
    if (!r) return null;
    return {
      id: String(r.id),
      publicKey: String(r.public_key),
      counter: Number(r.counter),
      transports: JSON.parse(String(r.transports)) as string[],
      name: String(r.name),
      createdAt: Number(r.created_at),
      lastUsedAt: r.last_used_at === null ? null : Number(r.last_used_at),
    };
  }

  credentialIds(): string[] {
    return this.sql.exec<{ id: string }>("SELECT id FROM credentials").toArray().map((r) => r.id);
  }

  addCredential(c: { id: string; publicKey: string; counter: number; transports: string[]; name: string }) {
    this.sql.exec(
      "INSERT OR REPLACE INTO credentials (id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      c.id,
      c.publicKey,
      c.counter,
      JSON.stringify(c.transports),
      c.name,
      Date.now(),
    );
  }

  touchCredential(id: string, counter: number) {
    this.sql.exec("UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?", counter, Date.now(), id);
  }

  // ----- browser sessions -----

  async createSession(userAgent: string | null): Promise<{ token: string; expiresAt: number }> {
    const token = randomToken(32);
    const expiresAt = Date.now() + SESSION_TTL_MS;
    this.sql.exec("DELETE FROM sessions WHERE expires_at < ?", Date.now());
    this.sql.exec(
      "DELETE FROM sessions WHERE hash IN (SELECT hash FROM sessions ORDER BY created_at DESC LIMIT -1 OFFSET ?)",
      MAX_SESSIONS - 1,
    );
    this.sql.exec(
      "INSERT INTO sessions (hash, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?)",
      await sha256(token),
      Date.now(),
      expiresAt,
      userAgent?.slice(0, 300) ?? null,
    );
    return { token, expiresAt };
  }

  async checkSession(token: string): Promise<boolean> {
    const hash = await sha256(token);
    const r = this.sql.exec<{ expires_at: number }>("SELECT expires_at FROM sessions WHERE hash = ?", hash).toArray()[0];
    if (!r || r.expires_at < Date.now()) return false;
    // Sliding expiry, at most once a day.
    if (r.expires_at - Date.now() < SESSION_TTL_MS - 86_400_000) {
      this.sql.exec("UPDATE sessions SET expires_at = ? WHERE hash = ?", Date.now() + SESSION_TTL_MS, hash);
    }
    return true;
  }

  async endSession(token: string) {
    this.sql.exec("DELETE FROM sessions WHERE hash = ?", await sha256(token));
  }

  // ----- Macs -----

  addDevice(d: { id: string; publicKey: string; name: string }) {
    this.sql.exec(
      "INSERT OR REPLACE INTO devices (id, public_key, name, created_at) VALUES (?, ?, ?, ?)",
      d.id,
      d.publicKey,
      d.name,
      Date.now(),
    );
  }

  devices(): DeviceInfo[] {
    const online = new Set(this.macSockets().map((ws) => (ws.deserializeAttachment() as SocketMeta).deviceId));
    return this.sql
      .exec<{ id: string; name: string; created_at: number; last_seen_at: number | null }>(
        "SELECT id, name, created_at, last_seen_at FROM devices ORDER BY created_at",
      )
      .toArray()
      .map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at, lastSeenAt: r.last_seen_at, online: online.has(r.id) }));
  }

  removeDevice(id: string) {
    this.sql.exec("DELETE FROM devices WHERE id = ?", id);
    for (const ws of this.macSockets()) {
      if ((ws.deserializeAttachment() as SocketMeta).deviceId === id) {
        this.send(ws, { t: "revoked" });
        ws.close(4003, "Device removed");
      }
    }
    this.broadcastMac();
  }

  devicePublicKey(id: string): string | null {
    return this.sql.exec<{ public_key: string }>("SELECT public_key FROM devices WHERE id = ?", id).toArray()[0]?.public_key ?? null;
  }

  macState(): MacState {
    const sock = this.macSockets()[0];
    const deviceId = sock ? (sock.deserializeAttachment() as SocketMeta).deviceId : undefined;
    const row = this.sql
      .exec<{ name: string; last_seen_at: number | null; problem: string | null }>(
        deviceId
          ? "SELECT name, last_seen_at, problem FROM devices WHERE id = ?"
          : "SELECT name, last_seen_at, problem FROM devices ORDER BY last_seen_at DESC LIMIT 1",
        ...(deviceId ? [deviceId] : []),
      )
      .toArray()[0];
    return {
      online: Boolean(sock),
      lastSeen: row?.last_seen_at ? new Date(row.last_seen_at).toISOString() : null,
      name: row?.name ?? null,
      problem: row?.problem ?? null,
    };
  }

  // ----- snapshot -----

  snapshot(): Snapshot {
    if (this.cache) return this.cache;
    const meta = Object.fromEntries(this.sql.exec<{ key: string; value: string }>("SELECT key, value FROM meta").toArray().map((r) => [r.key, r.value]));
    const base = emptySnapshot();
    const read = <T>(table: string) => this.sql.exec<{ data: string }>(`SELECT data FROM ${table}`).toArray().map((r) => JSON.parse(r.data) as T);
    this.cache = {
      rev: meta.rev ? Number(meta.rev) : 0,
      generatedAt: meta.generatedAt ?? base.generatedAt,
      timeZone: meta.timeZone ?? base.timeZone,
      capabilities: meta.capabilities ? (JSON.parse(meta.capabilities) as Snapshot["capabilities"]) : base.capabilities,
      tasks: read<Task>("tasks"),
      areas: read<Area>("areas"),
      tags: read<Tag>("tags"),
    };
    return this.cache;
  }

  private writeMeta(s: Pick<Snapshot, "rev" | "generatedAt" | "timeZone" | "capabilities">) {
    for (const [k, v] of [
      ["rev", String(s.rev)],
      ["generatedAt", s.generatedAt],
      ["timeZone", s.timeZone],
      ["capabilities", JSON.stringify(s.capabilities)],
    ] as const) {
      this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", k, v);
    }
  }

  private replaceSnapshot(s: Snapshot) {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM tasks");
      this.sql.exec("DELETE FROM areas");
      this.sql.exec("DELETE FROM tags");
      for (const t of s.tasks) this.sql.exec("INSERT INTO tasks (id, data) VALUES (?, ?)", t.id, JSON.stringify(t));
      for (const a of s.areas) this.sql.exec("INSERT INTO areas (id, data) VALUES (?, ?)", a.id, JSON.stringify(a));
      for (const t of s.tags) this.sql.exec("INSERT INTO tags (id, data) VALUES (?, ?)", t.id, JSON.stringify(t));
      this.writeMeta(s);
    });
    this.cache = s;
    this.broadcast({ t: "snapshot", snapshot: s, mac: this.macState() });
  }

  private storePatch(p: SnapshotPatch): boolean {
    const current = this.snapshot();
    let next: Snapshot;
    try {
      next = applyPatch(current, p);
    } catch {
      return false;
    }
    this.ctx.storage.transactionSync(() => {
      for (const id of p.remove.tasks) this.sql.exec("DELETE FROM tasks WHERE id = ?", id);
      for (const id of p.remove.areas) this.sql.exec("DELETE FROM areas WHERE id = ?", id);
      for (const id of p.remove.tags) this.sql.exec("DELETE FROM tags WHERE id = ?", id);
      for (const t of p.upsert.tasks) this.sql.exec("INSERT OR REPLACE INTO tasks (id, data) VALUES (?, ?)", t.id, JSON.stringify(t));
      for (const a of p.upsert.areas) this.sql.exec("INSERT OR REPLACE INTO areas (id, data) VALUES (?, ?)", a.id, JSON.stringify(a));
      for (const t of p.upsert.tags) this.sql.exec("INSERT OR REPLACE INTO tags (id, data) VALUES (?, ?)", t.id, JSON.stringify(t));
      this.writeMeta(next);
    });
    this.cache = next;
    this.broadcast({ t: "patch", patch: p });
    return true;
  }

  // ----- actions (web app + remote MCP → Mac) -----

  async call(input: unknown): Promise<ActionResult> {
    const parsed = ActionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: `Invalid request: ${parsed.error.issues[0]?.message ?? "unknown"}`, code: "invalid" };
    const mac = this.macSockets()[0];
    if (!mac) {
      const state = this.macState();
      const since = state.lastSeen ? ` (last seen ${state.lastSeen})` : "";
      return {
        ok: false,
        code: "mac_offline",
        error: `Your Mac is offline${since}, so changes can't reach Things right now. Wake it, or check that the things3pp agent is running ("things3pp agent status").`,
      };
    }
    const callId = randomToken(12);
    return new Promise<ActionResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        resolve({ ok: false, code: "timeout", error: "Your Mac didn't answer in time. Is Things running?" });
      }, CALL_TIMEOUT_MS);
      this.pending.set(callId, { resolve, timer });
      this.send(mac, { t: "call", callId, action: parsed.data });
    });
  }

  // ----- WebSockets -----

  /** Authenticated Mac sockets (the "mac" tag also holds ones still answering the challenge). */
  private macSockets(): WebSocket[] {
    return this.ctx.getWebSockets("mac").filter((ws) => (ws.deserializeAttachment() as SocketMeta | null)?.kind === "mac");
  }

  /** Name of a different Mac whose socket is alive and healthy, if any (see macHolder). */
  private liveOtherMac(deviceId: string): string | null {
    const holders = this.macSockets().map((ws) => {
      const meta = ws.deserializeAttachment() as SocketMeta;
      const row = meta.deviceId
        ? this.sql
            .exec<{ name: string; last_seen_at: number | null; problem: string | null }>("SELECT name, last_seen_at, problem FROM devices WHERE id = ?", meta.deviceId)
            .toArray()[0]
        : undefined;
      return {
        deviceId: meta.deviceId,
        name: row?.name,
        problem: row ? row.problem : "unknown device",
        lastActive: Math.max(meta.openedAt, row?.last_seen_at ?? 0, this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0),
      };
    });
    return macHolder(holders, deviceId, Date.now());
  }

  private send(ws: WebSocket, msg: HubToMac | HubToBrowser) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // Closed underneath us; the close handler tidies up.
    }
  }

  private broadcast(msg: HubToBrowser) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets("browser")) {
      try {
        ws.send(data);
      } catch {
        /* closing */
      }
    }
  }

  private broadcastMac() {
    this.broadcast({ t: "mac", mac: this.macState() });
  }

  /** The Worker forwards /device/connect (Mac) and /api/live (browser, already authenticated) here. */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const kind = new URL(request.url).pathname === "/device/connect" ? "mac-pending" : "browser";
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server, [kind === "browser" ? "browser" : "mac"]);
    if (kind === "mac-pending") {
      const nonce = randomToken(24);
      server.serializeAttachment({ kind, nonce, openedAt: Date.now() } satisfies SocketMeta);
      this.send(server, { t: "challenge", nonce });
      // Drop sockets that never authenticate. The timer covers the awake case; the alarm survives hibernation.
      setTimeout(() => this.closeUnauthenticated(), AUTH_TIMEOUT_MS + 50);
      await this.ctx.storage.setAlarm(Date.now() + AUTH_TIMEOUT_MS + 50);
    } else {
      server.serializeAttachment({ kind, openedAt: Date.now() } satisfies SocketMeta);
      this.send(server, { t: "snapshot", snapshot: this.snapshot(), mac: this.macState() });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Closes Mac sockets that didn't answer the challenge in time. Returns when the next one is due. */
  private closeUnauthenticated(): number | null {
    let next: number | null = null;
    for (const ws of this.ctx.getWebSockets("mac")) {
      const meta = ws.deserializeAttachment() as SocketMeta | null;
      if (meta?.kind !== "mac-pending") continue;
      const due = meta.openedAt + AUTH_TIMEOUT_MS;
      if (Date.now() >= due) {
        try {
          ws.close(4001, "Authentication timed out");
        } catch {
          /* already closing */
        }
      } else next = next === null ? due : Math.min(next, due);
    }
    return next;
  }

  override async alarm() {
    const next = this.closeUnauthenticated();
    if (next !== null) await this.ctx.storage.setAlarm(next + 50);
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    const meta = ws.deserializeAttachment() as SocketMeta;
    if (meta.kind === "browser") return; // Browsers only listen; changes go through POST /api/action.
    let msg: MacToHub;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as MacToHub;
    } catch {
      ws.close(4000, "Bad message");
      return;
    }

    if (meta.kind === "mac-pending") {
      if (msg.t !== "auth" || !meta.nonce) {
        ws.close(4001, "Authenticate first");
        return;
      }
      const key = this.devicePublicKey(msg.deviceId);
      if (!key || !(await verifyEd25519(key, msg.signature, challengeText(meta.nonce, msg.deviceId)))) {
        ws.close(4003, "Unknown device or bad signature");
        return;
      }
      // One live Mac connection per account. The same Mac reconnecting replaces its old socket. A
      // different Mac only takes over when the current one has gone quiet or reports a problem;
      // otherwise two linked Macs would keep kicking each other off and writes would fail.
      const holder = this.liveOtherMac(msg.deviceId);
      if (holder) {
        // Close reasons are capped at 123 bytes; trim the name by characters until it fits.
        let name = holder.slice(0, 60);
        const reason = () => `Another Mac (${name}) is already connected`;
        while (new TextEncoder().encode(reason()).length > 120) name = name.slice(0, -1);
        ws.close(4010, reason());
        return;
      }
      for (const old of this.macSockets()) old.close(4009, "Replaced by a newer connection");
      ws.serializeAttachment({ kind: "mac", deviceId: msg.deviceId, openedAt: meta.openedAt } satisfies SocketMeta);
      this.sql.exec("UPDATE devices SET last_seen_at = ?, problem = NULL WHERE id = ?", Date.now(), msg.deviceId);
      this.send(ws, { t: "ready", rev: this.snapshot().rev });
      this.broadcastMac();
      return;
    }

    // Authenticated Mac.
    switch (msg.t) {
      case "snapshot":
        this.replaceSnapshot(msg.snapshot);
        break;
      case "patch":
        if (!this.storePatch(msg.patch)) this.send(ws, { t: "resync" });
        break;
      case "result": {
        const p = this.pending.get(msg.callId);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(msg.callId);
          p.resolve(msg.result);
        }
        break;
      }
      case "status":
        if (meta.deviceId) {
          this.sql.exec("UPDATE devices SET problem = ?, last_seen_at = ? WHERE id = ?", msg.ok ? null : (msg.message || "Problem on the Mac").slice(0, 500), Date.now(), meta.deviceId);
          this.broadcastMac();
        }
        break;
      default:
        break;
    }
    if (meta.deviceId) this.sql.exec("UPDATE devices SET last_seen_at = ? WHERE id = ?", Date.now(), meta.deviceId);
  }

  override async webSocketClose(ws: WebSocket) {
    const meta = ws.deserializeAttachment() as SocketMeta | null;
    if (meta?.kind === "mac") {
      if (meta.deviceId) this.sql.exec("UPDATE devices SET last_seen_at = ? WHERE id = ?", Date.now(), meta.deviceId);
      queueMicrotask(() => this.broadcastMac());
    }
  }

  override async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }
}
