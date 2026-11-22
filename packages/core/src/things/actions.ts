// Runs relay actions on this Mac. Node only.
// Basic fields go through AppleScript (ThingsClient). What AppleScript can't do (This Evening,
// checklists, headings) goes through the Things URL scheme's JSON command, which needs
// "Enable Things URLs" in Things → Settings → General.
//
// SECURITY: `action` is validated against ActionSchema first. Values only ever become fields of
// a JSON payload for Things or argv for osascript. Nothing is turned into code.

import { execFile } from "node:child_process";
import { ActionSchema, type Action, type ActionResult } from "../relay/protocol.js";
import { ThingsClient, ThingsError } from "./client.js";

export interface UrlScheme {
  /** The Things URL-scheme auth token, or null if Things URLs are turned off. */
  token(): Promise<string | null>;
  open(url: string): Promise<void>;
}

export const macUrlScheme = (token: () => Promise<string | null>): UrlScheme => ({
  token,
  open: (url) =>
    new Promise((resolve, reject) => {
      // -g: don't bring Things to the front.
      execFile("/usr/bin/open", ["-g", url], { timeout: 15_000 }, (err) => (err ? reject(err) : resolve()));
    }),
});

const URL_SCHEME_HELP =
  'This change needs Things URLs. In Things, open Settings → General, turn on "Enable Things URLs", and try again.';

type JsonAttributes = Record<string, unknown>;

export class MacActions {
  constructor(
    private readonly things: ThingsClient,
    private readonly urls: UrlScheme,
  ) {}

  /** Validates and runs one action. Never throws; errors come back as { ok: false }. */
  async run(input: unknown): Promise<ActionResult> {
    const parsed = ActionSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: `Invalid request: ${parsed.error.issues[0]?.message ?? "unknown"}`, code: "invalid" };
    try {
      return await this.dispatch(parsed.data);
    } catch (e) {
      const code = e instanceof ThingsError ? e.code : "things_error";
      return { ok: false, error: e instanceof Error ? e.message : String(e), code };
    }
  }

  private async jsonUpdate(type: "to-do" | "project", id: string, attributes: JsonAttributes): Promise<void> {
    const token = await this.urls.token();
    if (!token) throw new ThingsError(URL_SCHEME_HELP, "things_error");
    const data = JSON.stringify([{ type, operation: "update", id, attributes }]);
    await this.urls.open(`things:///json?auth-token=${encodeURIComponent(token)}&data=${encodeURIComponent(data)}`);
  }

  private async dispatch(action: Action): Promise<ActionResult> {
    switch (action.op) {
      case "addTodo": {
        const { evening, headingId, checklist, ...basic } = action.args;
        const todo = await this.things.addTodo({ ...basic, when: evening ? "today" : basic.when });
        const extra: JsonAttributes = {};
        if (evening) extra.when = "evening";
        if (headingId) extra["heading-id"] = headingId;
        if (checklist?.length) extra["checklist-items"] = checklist.map((title) => ({ type: "checklist-item", attributes: { title } }));
        if (Object.keys(extra).length) await this.jsonUpdate("to-do", todo.id, extra);
        return { ok: true, id: todo.id, data: todo };
      }
      case "addProject": {
        const project = await this.things.addProject(action.args);
        return { ok: true, id: project.id, data: project };
      }
      case "update": {
        const { evening, headingId, ...basic } = action.args;
        const extra: JsonAttributes = {};
        if (evening === true) extra.when = "evening";
        // Back to the day part of Today: only the URL scheme resets the evening flag.
        else if (evening === false && (basic.when === undefined || basic.when === "today") && (await this.urls.token())) extra.when = "today";
        if (headingId) extra["heading-id"] = headingId;
        const when = extra.when ? undefined : evening === false && basic.when === undefined ? "today" : basic.when;
        const changes = Object.entries(basic).some(([k, v]) => k !== "id" && k !== "when" && v !== undefined);
        let data: unknown;
        if (changes || when !== undefined) data = await this.things.update({ ...basic, when });
        if (Object.keys(extra).length) await this.jsonUpdate("to-do", basic.id, extra);
        return { ok: true, id: basic.id, data };
      }
      case "setStatus": {
        const item = await this.things.setStatus(action.args.id, action.args.status);
        return { ok: true, id: item.id, data: item };
      }
      case "setChecklist": {
        await this.jsonUpdate("to-do", action.args.id, {
          "checklist-items": action.args.items.map((i) => ({ type: "checklist-item", attributes: { title: i.title, completed: i.done } })),
        });
        return { ok: true, id: action.args.id };
      }
      case "refresh":
        return { ok: true };
    }
  }
}
