// Messages between the Mac connector, the hosted Worker (Durable Object) and the web app.
//
// SECURITY: the Worker can only ask the Mac to run one of the `Action`s below, validated with zod
// on the Mac before anything runs. There is no delete/trash action, and nothing here is ever
// turned into script source: actions map to fixed ThingsClient methods or Things URL-scheme fields.

import { z } from "zod";
import type { Snapshot, SnapshotPatch } from "../model/types.js";

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const id = z.string().min(1).max(200);
const title = z.string().trim().min(1).max(1000);
const notes = z.string().max(10_000);
const day = z.string().regex(DAY_RE, "Use YYYY-MM-DD");
/** Already resolved: today | anytime | someday | inbox | YYYY-MM-DD. */
const when = z.union([z.enum(["today", "anytime", "someday", "inbox"]), day]);
const tags = z.array(z.string().min(1).max(100)).max(50);
const ref = z.string().min(1).max(500);
const checklist = z.array(z.object({ title: z.string().trim().min(1).max(1000), done: z.boolean() })).max(200);

export const ActionSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("addTodo"),
    args: z.object({
      title,
      notes: notes.optional(),
      when: when.optional(),
      evening: z.boolean().optional(),
      deadline: day.optional(),
      tags: tags.optional(),
      project: ref.optional(),
      area: ref.optional(),
      headingId: id.optional(),
      checklist: z.array(z.string().trim().min(1).max(1000)).max(200).optional(),
    }),
  }),
  z.object({
    op: z.literal("addProject"),
    args: z.object({
      title,
      notes: notes.optional(),
      when: when.optional(),
      deadline: day.optional(),
      tags: tags.optional(),
      area: ref.optional(),
      todos: z.array(title).max(100).optional(),
    }),
  }),
  z.object({
    op: z.literal("update"),
    args: z.object({
      id,
      title: title.optional(),
      notes: notes.optional(),
      when: when.optional(),
      evening: z.boolean().optional(),
      deadline: day.nullable().optional(),
      tags: tags.optional(),
      project: ref.optional(),
      area: ref.optional(),
      headingId: id.optional(),
    }),
  }),
  z.object({ op: z.literal("setStatus"), args: z.object({ id, status: z.enum(["open", "completed", "canceled"]) }) }),
  z.object({ op: z.literal("setChecklist"), args: z.object({ id, items: checklist }) }),
  /** Re-read the database now. */
  z.object({ op: z.literal("refresh"), args: z.object({}).optional() }),
]);

export type Action = z.infer<typeof ActionSchema>;
export type ActionOp = Action["op"];

export interface ActionResult {
  ok: boolean;
  /** For creates and updates: the id of the affected item. */
  id?: string;
  data?: unknown;
  error?: string;
  code?: string;
}

// ----- Mac ⇄ Durable Object (WebSocket /device/connect) -----

export type MacToHub =
  | { t: "auth"; deviceId: string; signature: string; version: string }
  | { t: "snapshot"; snapshot: Snapshot }
  | { t: "patch"; patch: SnapshotPatch }
  | { t: "result"; callId: string; result: ActionResult }
  | { t: "status"; ok: boolean; message?: string }
  | { t: "pong" };

export type HubToMac =
  | { t: "challenge"; nonce: string }
  | { t: "ready"; rev: number }
  | { t: "call"; callId: string; action: Action }
  | { t: "resync" }
  | { t: "ping" }
  | { t: "revoked" };

// ----- Durable Object → browser (WebSocket /api/live) -----

export interface MacState {
  online: boolean;
  lastSeen: string | null;
  name: string | null;
  /** Last problem the Mac reported (e.g. Things not running, Full Disk Access missing). */
  problem: string | null;
}

export type HubToBrowser =
  | { t: "snapshot"; snapshot: Snapshot; mac: MacState }
  | { t: "patch"; patch: SnapshotPatch }
  | { t: "mac"; mac: MacState }
  | { t: "ping" };

/** Text the Mac signs to prove it holds the device key. */
export function challengeText(nonce: string, deviceId: string): string {
  return `things3pp-device-auth\n${deviceId}\n${nonce}`;
}

/** Text a paired Mac signs to ask for a new passkey on its account. */
export function recoverText(deviceId: string, ts: number): string {
  return `things3pp-recover\n${deviceId}\n${ts}`;
}
