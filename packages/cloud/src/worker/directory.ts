// Directory: one per deployment. Knows who owns this deployment, holds pending Mac pairings,
// and one-time WebAuthn challenges. Everything per-account lives in the Account object.

import { DurableObject } from "cloudflare:workers";
import { pairingCode, randomToken, sha256 } from "./util.ts";

const PAIRING_TTL_MS = 10 * 60_000;
const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_PENDING_PAIRINGS = 500;
const MAX_PENDING_PER_CLIENT = 5;

export interface PairingInfo {
  pairingId: string;
  code: string;
  deviceName: string;
  publicKey: string;
  /** Started with the deployment's setup key, so it may create the owner account. */
  setupOk: boolean;
  status: "pending" | "approved";
  /** A paired Mac asking to add a passkey to its account (lost-passkey recovery). */
  recover: { accountId: string; deviceId: string } | null;
  /** Reserved for a new owner account during first-time setup. */
  newAccountId: string | null;
  accountId: string | null;
  deviceId: string | null;
  expiresAt: number;
}

export type ChallengePurpose = "register" | "login" | "consent" | "add-passkey";

export class Directory extends DurableObject {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env as never);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS pairings (
        pairing_id TEXT PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        poll_hash TEXT NOT NULL,
        device_name TEXT NOT NULL,
        public_key TEXT NOT NULL,
        setup_ok INTEGER NOT NULL,
        status TEXT NOT NULL,
        new_account_id TEXT,
        account_id TEXT,
        device_id TEXT,
        recover_account_id TEXT,
        recover_device_id TEXT,
        client TEXT,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS challenges (
        challenge TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        subject TEXT,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  private sweep() {
    const now = Date.now();
    this.sql.exec("DELETE FROM pairings WHERE expires_at < ?", now);
    this.sql.exec("DELETE FROM challenges WHERE expires_at < ?", now);
  }

  ownerAccountId(): string | null {
    const row = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'owner'").toArray()[0];
    return row?.value ?? null;
  }

  /** Makes `accountId` the owner, only if nobody owns this deployment yet. */
  claimOwner(accountId: string): boolean {
    if (this.ownerAccountId()) return false;
    this.sql.exec("INSERT INTO meta (key, value) VALUES ('owner', ?)", accountId);
    return true;
  }

  // ----- pairing -----

  async startPairing(input: { publicKey: string; deviceName: string; setupOk: boolean; recover?: { accountId: string; deviceId: string }; client?: string }) {
    this.sweep();
    const pending = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM pairings WHERE status = 'pending'").one().n;
    if (pending >= MAX_PENDING_PAIRINGS) throw new Error("Too many pairing attempts. Wait a few minutes and try again.");
    const clientHash = input.client ? await sha256(input.client) : null;
    if (clientHash) {
      const mine = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM pairings WHERE status = 'pending' AND client = ?", clientHash).one().n;
      if (mine >= MAX_PENDING_PER_CLIENT) throw new Error("Too many pairing attempts from this network. Wait a few minutes and try again.");
    }
    const pairingId = randomToken(16);
    const pollToken = randomToken(32);
    let code = pairingCode();
    while (this.sql.exec("SELECT 1 FROM pairings WHERE code = ?", code).toArray().length) code = pairingCode();
    const expiresAt = Date.now() + PAIRING_TTL_MS;
    this.sql.exec(
      `INSERT INTO pairings (pairing_id, code, poll_hash, device_name, public_key, setup_ok, status, recover_account_id, recover_device_id, client, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
      pairingId,
      code,
      await sha256(pollToken),
      input.deviceName,
      input.publicKey,
      input.setupOk ? 1 : 0,
      input.recover?.accountId ?? null,
      input.recover?.deviceId ?? null,
      clientHash,
      expiresAt,
    );
    return { pairingId, code, pollToken, expiresAt };
  }

  getPairing(code: string): PairingInfo | null {
    this.sweep();
    const r = this.sql
      .exec<Record<string, string | number | null>>("SELECT * FROM pairings WHERE code = ?", code)
      .toArray()[0];
    if (!r) return null;
    return {
      pairingId: String(r.pairing_id),
      code: String(r.code),
      deviceName: String(r.device_name),
      publicKey: String(r.public_key),
      setupOk: r.setup_ok === 1,
      status: r.status === "approved" ? "approved" : "pending",
      recover: r.recover_account_id ? { accountId: String(r.recover_account_id), deviceId: String(r.recover_device_id) } : null,
      newAccountId: (r.new_account_id as string | null) ?? null,
      accountId: (r.account_id as string | null) ?? null,
      deviceId: (r.device_id as string | null) ?? null,
      expiresAt: Number(r.expires_at),
    };
  }

  /**
   * Reserves the id a new account will get, so the passkey can be bound to it. Owner-only
   * deployments allow this once (with the setup key); open ones allow it for every new Mac.
   */
  reserveAccountId(code: string, openSignups = false): string | null {
    const p = this.getPairing(code);
    if (!p || p.status !== "pending" || p.recover) return null;
    if (!openSignups && (!p.setupOk || this.ownerAccountId())) return null;
    if (p.newAccountId) return p.newAccountId;
    const id = `acc_${randomToken(12)}`;
    this.sql.exec("UPDATE pairings SET new_account_id = ? WHERE code = ?", id, code);
    return id;
  }

  approvePairing(code: string, accountId: string, deviceId: string): boolean {
    const p = this.getPairing(code);
    if (!p || p.status !== "pending") return false;
    this.sql.exec(
      "UPDATE pairings SET status = 'approved', account_id = ?, device_id = ?, expires_at = ? WHERE code = ?",
      accountId,
      deviceId,
      Date.now() + PAIRING_TTL_MS,
      code,
    );
    return true;
  }

  /** What the Mac sees while it waits. The poll token proves it's the Mac that started this pairing. */
  async pollPairing(pairingId: string, pollToken: string) {
    this.sweep();
    const r = this.sql
      .exec<Record<string, string | number | null>>("SELECT * FROM pairings WHERE pairing_id = ?", pairingId)
      .toArray()[0];
    if (!r || r.poll_hash !== (await sha256(pollToken))) return { status: "expired" as const };
    if (r.status !== "approved") return { status: "pending" as const };
    // Hand the result over once.
    this.sql.exec("DELETE FROM pairings WHERE pairing_id = ?", pairingId);
    return { status: "approved" as const, accountId: String(r.account_id), deviceId: String(r.device_id) };
  }

  // ----- one-time WebAuthn challenges -----

  createChallenge(purpose: ChallengePurpose, subject: string | null): string {
    this.sweep();
    const challenge = randomToken(32);
    this.sql.exec(
      "INSERT INTO challenges (challenge, purpose, subject, expires_at) VALUES (?, ?, ?, ?)",
      challenge,
      purpose,
      subject,
      Date.now() + CHALLENGE_TTL_MS,
    );
    return challenge;
  }

  /** Uses up a challenge. Returns its subject (or "" when it had none), or null if it's unknown/expired/wrong purpose. */
  consumeChallenge(challenge: string, purpose: ChallengePurpose): string | null {
    this.sweep();
    const r = this.sql
      .exec<{ purpose: string; subject: string | null }>("SELECT purpose, subject FROM challenges WHERE challenge = ?", challenge)
      .toArray()[0];
    if (!r || r.purpose !== purpose) return null;
    this.sql.exec("DELETE FROM challenges WHERE challenge = ?", challenge);
    return r.subject ?? "";
  }
}
