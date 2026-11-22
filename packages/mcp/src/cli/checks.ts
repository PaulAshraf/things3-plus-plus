import { existsSync } from "node:fs";
import { ThingsClient, ThingsError } from "../things/client.js";

export const THINGS_APP_PATHS = ["/Applications/Things3.app", `${process.env.HOME}/Applications/Things3.app`];

export function thingsInstalled(): boolean {
  return THINGS_APP_PATHS.some((p) => existsSync(p));
}

export type AccessResult =
  | { ok: true; version: string }
  | { ok: false; code: ThingsError["code"] | "unknown"; message: string };

/** Talks to Things once. The first time, this makes macOS ask for permission. */
export async function checkThingsAccess(client = new ThingsClient()): Promise<AccessResult> {
  try {
    const { version } = await client.ping();
    return { ok: true, version };
  } catch (err) {
    if (err instanceof ThingsError) return { ok: false, code: err.code, message: err.message };
    return { ok: false, code: "unknown", message: String(err) };
  }
}

export function nodeVersionOk(): boolean {
  return Number(process.versions.node.split(".")[0]) >= 20;
}
