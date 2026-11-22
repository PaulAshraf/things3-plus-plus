import { execFile, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

export const entry = fileURLToPath(new URL("../../dist/index.js", import.meta.url));
export const exec = promisify(execFile);
export const enabled = process.env.THINGS_E2E === "1";
export const prefix = "[things3pp e2e";
export const marker = `${prefix} ${process.pid}-${Date.now()}]`;

export function cli(args: string[], env = process.env) {
  return spawnSync(process.execPath, [entry, ...args], { env, encoding: "utf8", timeout: 40_000 });
}

export async function connectStdio(launch = { command: process.execPath, args: [entry, "mcp"], env: undefined as Record<string, string> | undefined }) {
  const client = new Client({ name: "things-e2e", version: "1" });
  await client.connect(new StdioClientTransport({ ...launch, stderr: "pipe" }));
  return client;
}

// Batch only ids and titles, including the full Logbook, without printing user data.
const scanScript = `
function run(argv) {
  var things = Application("Things3");
  var ids = ["TMInboxListSource", "TMTodayListSource", "TMNextListSource",
    "TMSomedayListSource", "TMCalendarListSource", "TMLogbookListSource"];
  var hits = {};
  function scan(label, collection) {
    var names = collection.name(), ids = collection.id();
    hits[label] = names.flatMap(function (name, i) {
      return name && name.indexOf(argv[0]) === 0 ? [{ id: ids[i], title: name }] : [];
    });
  }
  ids.forEach(function (id) { scan(id, things.lists.byId(id).toDos); });
  scan("projects", things.projects);
  // Verify against the Trash separately so all-project enumeration can exclude trashed projects.
  scan("trash", things.lists.byId("TMTrashListSource").toDos);
  return JSON.stringify(hits);
}`;

export async function scan() {
  const { stdout } = await exec("/usr/bin/osascript", ["-l", "JavaScript", "-e", scanScript, prefix], { timeout: 35_000 });
  const { trash, ...lists } = JSON.parse(stdout) as Record<string, { id: string; title: string }[]>;
  const trashed = new Set(trash?.map(({ id }) => id));
  return { ...lists, projects: lists.projects.filter(({ id }) => !trashed.has(id)) };
}
