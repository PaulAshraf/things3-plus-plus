// The Mac side of the relay: keeps one WebSocket open to your hosted Things, streams database
// changes up, and runs the changes the web app / remote MCP ask for.
//
// SECURITY: the Worker can only send `call` messages carrying an Action. MacActions validates it
// against ActionSchema before anything runs; there's no delete, and nothing becomes code.

import { diffSnapshots, type Snapshot, type Task } from "things3pp-core/model/types";
import { readSnapshotViaAppleScript } from "things3pp-core/things/applescript-snapshot";
import type { HubToMac, MacToHub } from "things3pp-core/relay/protocol";
import { challengeText } from "things3pp-core/relay/protocol";
import { MacActions, macUrlScheme } from "things3pp-core/things/actions";
import { ThingsClient } from "things3pp-core/things/client";
import { DatabaseError, findThingsDatabase, readSnapshot, readUrlSchemeToken, watchDatabase } from "things3pp-core/things/db";
import { VERSION } from "../version.js";
import { signWithDevice, type CloudConfig } from "./config.js";

const POLL_MS = 30_000;
const PING_MS = 30_000;

export interface ConnectorOptions {
  config: Required<Pick<CloudConfig, "url">> & { device: NonNullable<CloudConfig["device"]> };
  log?: (line: string) => void;
}

export class Connector {
  private ws: WebSocket | null = null;
  private stopped = false;
  private backoff = 1000;
  private last: Snapshot | null = null;
  private rev = 0;
  private dbPath: string | null = null;
  private watcher: { close(): void } | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reading: Promise<void> | null = null;
  private rereadQueued = false;
  private tokenCache: { value: string | null; at: number } | null = null;
  private readonly actions: MacActions;
  private readonly client = new ThingsClient();
  /** "database" = full detail from SQLite; "basic" = AppleScript only (no access to Things' data yet). */
  private mode: "database" | "basic" | null = null;
  private basicLogbook: Task[] = [];
  private basicReads = 0;
  private logbookDue = false;
  private readonly log: (line: string) => void;

  constructor(private readonly opts: ConnectorOptions) {
    this.log = opts.log ?? ((l) => console.log(`${new Date().toISOString()} ${l}`));
    this.actions = new MacActions(this.client, macUrlScheme(() => this.urlToken()));
  }

  start() {
    this.connect();
    this.pollTimer = setInterval(() => void this.refresh(), POLL_MS);
  }

  stop() {
    this.stopped = true;
    this.watcher?.close();
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close(1000, "Stopping");
  }

  private async urlToken(): Promise<string | null> {
    if (this.tokenCache && Date.now() - this.tokenCache.at < 60_000) return this.tokenCache.value;
    const value = this.dbPath ? await readUrlSchemeToken(this.dbPath).catch(() => null) : null;
    this.tokenCache = { value, at: Date.now() };
    return value;
  }

  private nextRev(): number {
    this.rev = Math.max(this.rev + 1, Date.now());
    return this.rev;
  }

  private send(msg: MacToHub) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private connect() {
    if (this.stopped) return;
    const { url, device } = this.opts.config;
    const wsUrl = new URL("/device/connect", url);
    wsUrl.protocol = wsUrl.protocol === "http:" ? "ws:" : "wss:";
    wsUrl.searchParams.set("account", device.accountId ?? "");
    this.log(`Connecting to ${url}…`);
    const ws = new WebSocket(wsUrl);
    this.ws = ws;
    let authed = false;

    ws.addEventListener("message", (ev) => {
      let msg: HubToMac;
      try {
        msg = JSON.parse(String(ev.data)) as HubToMac;
      } catch {
        return;
      }
      void this.onMessage(msg, () => {
        authed = true;
      });
    });
    ws.addEventListener("close", (ev) => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.ws = null;
      if (this.stopped) return;
      if (ev.code === 4003) {
        this.log("This Mac isn't recognised anymore (removed, or a different deployment). Run things3pp connect again.");
        this.stop();
        process.exitCode = 1;
        return;
      }
      if (authed) this.backoff = 1000;
      const wait = Math.min(this.backoff, 60_000);
      this.backoff = Math.min(this.backoff * 2, 60_000);
      this.log(`Disconnected${ev.reason ? ` (${ev.reason})` : ""}. Reconnecting in ${Math.round(wait / 1000)}s.`);
      setTimeout(() => this.connect(), wait);
    });
    ws.addEventListener("error", () => {
      // "close" follows and handles reconnecting.
    });
  }

  private async onMessage(msg: HubToMac, markAuthed: () => void) {
    const { device } = this.opts.config;
    switch (msg.t) {
      case "challenge":
        this.send({ t: "auth", deviceId: device.deviceId ?? "", signature: signWithDevice(device, challengeText(msg.nonce, device.deviceId ?? "")), version: VERSION });
        break;
      case "ready":
        markAuthed();
        this.log("Connected.");
        // Keep-alive; the hub answers this without waking up.
        this.pingTimer = setInterval(() => this.ws?.readyState === WebSocket.OPEN && this.ws.send('{"t":"ping"}'), PING_MS);
        this.ensureWatching();
        await this.sendFull();
        break;
      case "resync":
        await this.sendFull();
        break;
      case "call": {
        const result = await this.actions.run(msg.action);
        this.log(`${msg.action.op}: ${result.ok ? "done" : `failed (${result.error})`}`);
        // Let Things finish writing, then push the change before answering so readers see it.
        if (msg.action.op === "setStatus") this.logbookDue = true;
        if (result.ok) {
          await new Promise((r) => setTimeout(r, msg.action.op === "setChecklist" || "evening" in (msg.action.args ?? {}) ? 400 : 120));
          await this.refresh();
        }
        this.send({ t: "result", callId: msg.callId, result });
        break;
      }
      case "revoked":
        this.log("This Mac was removed from your hosted Things.");
        this.stop();
        break;
      case "ping":
        this.send({ t: "pong" });
        break;
    }
  }

  private ensureWatching() {
    if (this.watcher) return;
    try {
      this.dbPath = findThingsDatabase();
      this.watcher = watchDatabase(this.dbPath, () => void this.refresh());
    } catch {
      // No access yet: basic mode polls instead (see read()).
    }
  }

  private reportProblem(e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    this.log(message);
    this.send({ t: "status", ok: false, message });
  }

  /** Reads Things: the database when we can (full detail), otherwise AppleScript (basic mode). */
  private async read(): Promise<Snapshot | null> {
    try {
      this.dbPath ??= findThingsDatabase();
      const snap = await readSnapshot(this.dbPath);
      if (this.mode !== "database") {
        this.mode = "database";
        this.log("Reading the Things database (full detail).");
        this.watcher?.close();
        this.watcher = null;
        this.ensureWatching();
      }
      return snap;
    } catch (e) {
      if (!(e instanceof DatabaseError) || e.code === "read_failed") {
        this.log(e instanceof Error ? e.message : String(e));
      }
    }
    try {
      const readLogbook = this.mode !== "basic" || this.logbookDue || ++this.basicReads % 10 === 0;
      this.logbookDue = false;
      const { snapshot, logbook } = await readSnapshotViaAppleScript(this.client, { readLogbook, previousLogbook: this.basicLogbook });
      this.basicLogbook = logbook;
      if (this.mode !== "basic") {
        this.mode = "basic";
        this.log("Basic mode: reading Things through AppleScript. Allow access to Things' data to add checklists, headings and This Evening.");
      }
      return snapshot;
    } catch (e) {
      this.reportProblem(new Error(`Couldn't read Things: ${(e as Error).message}`));
      return null;
    }
  }

  private async sendFull() {
    const snap = await this.read();
    if (!snap) return;
    snap.rev = this.nextRev();
    this.last = snap;
    this.send({ t: "snapshot", snapshot: snap });
    this.send({ t: "status", ok: true });
    this.log(`Sent ${snap.tasks.length} items.`);
  }

  /** Re-reads the database and sends what changed. Calls that overlap are merged into one extra read. */
  refresh(): Promise<void> {
    // Nothing sent yet (e.g. Full Disk Access was granted after connecting): start over with a full snapshot.
    if (!this.last && this.ws?.readyState === WebSocket.OPEN && !this.reading) {
      this.reading = (async () => {
        await this.sendFull();
        if (this.last) {
          this.watcher?.close();
          this.watcher = null;
          this.ensureWatching();
        }
      })().finally(() => {
        this.reading = null;
      });
      return this.reading;
    }
    if (this.reading) {
      this.rereadQueued = true;
      return this.reading;
    }
    this.reading = (async () => {
      do {
        this.rereadQueued = false;
        const next = await this.read();
        if (!next || !this.last) continue;
        const patch = diffSnapshots(this.last, next);
        if (!patch) continue;
        const rev = this.nextRev();
        patch.rev = rev;
        patch.baseRev = this.last.rev;
        this.last = { ...next, rev };
        this.send({ t: "patch", patch });
      } while (this.rereadQueued);
    })().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }
}

export function requireWebSocket(): void {
  if (typeof WebSocket === "undefined") {
    throw new Error(`Staying connected needs Node.js 22 or newer (you have ${process.versions.node}). Update Node, then try again.`);
  }
}
