import { existsSync } from "node:fs";
import { tokenPath } from "../config.js";
import { detectTailscale } from "../tailscale.js";
import { VERSION } from "../version.js";
import { allClients } from "./clients.js";
import { checkThingsAccess, nodeVersionOk, thingsInstalled } from "./checks.js";
import { c, fail, info, ok, warn } from "./ui.js";
import { DatabaseError, findThingsDatabase, readSnapshot } from "things3pp-core/things/db";
import { loadCloudConfig } from "../cloud/config.js";

async function cloudChecks(): Promise<number> {
  console.log(`\n${c.bold("Hosted Things")} ${c.dim("(web app + remote MCP on Cloudflare)")}`);
  let problems = 0;
  let cfg;
  try {
    cfg = loadCloudConfig();
  } catch (e) {
    fail((e as Error).message);
    return 1;
  }
  if (!cfg.url) {
    info(`Not set up — create it with ${c.cyan("things3pp cloud deploy")}`);
    return 0;
  }
  ok(`Deployment: ${cfg.url}`);
  if (!thingsInstalled()) {
    // Not the Things Mac: it should use the web app and remote MCP, and must not be linked.
    if (cfg.device?.deviceId) {
      warn(`This Mac is linked as "${cfg.device.name}" but has no Things, so it can't sync. Run ${c.cyan("things3pp disconnect")} and ${c.cyan("things3pp agent uninstall")}.`);
      problems++;
    } else ok("This Mac uses the web app and remote MCP (only the Mac with Things syncs)");
  } else if (cfg.device?.deviceId) ok(`This Mac is linked as "${cfg.device.name}"`);
  else (warn(`This Mac isn't linked — run ${c.cyan("things3pp connect")}`), problems++);
  if (thingsInstalled()) {
    try {
      const db = findThingsDatabase();
      const snap = await readSnapshot(db);
      ok(`Things database readable (${snap.tasks.length} items${snap.capabilities.urlScheme ? "" : ", Things URLs off"})`);
      if (!snap.capabilities.urlScheme) {
        warn('Turn on Things → Settings → General → "Enable Things URLs" so the web app can edit checklists and This Evening.');
      }
    } catch (e) {
      fail(e instanceof DatabaseError ? e.message : `Couldn't read the Things database: ${(e as Error).message}`);
      problems++;
    }
  }
  try {
    const res = await fetch(`${cfg.url}/api/state`);
    if (res.ok) ok("Deployment is reachable");
    else (warn(`Deployment answered ${res.status}`), problems++);
  } catch (e) {
    fail(`Couldn't reach the deployment: ${(e as Error).message}`);
    problems++;
  }
  return problems;
}

export async function doctor(opts: { cloud?: boolean } = {}): Promise<number> {
  console.log(`\n${c.bold("things3pp doctor")} ${c.dim(`v${VERSION}`)}\n`);
  let problems = 0;

  if (process.platform === "darwin") ok("macOS");
  else (fail("Not macOS — Things only runs on a Mac."), problems++);

  if (nodeVersionOk()) ok(`Node.js ${process.versions.node}`);
  else (fail(`Node.js ${process.versions.node} — version 20 or newer is required.`), problems++);

  const hasThings = thingsInstalled();
  let hostedUrl: string | undefined;
  try {
    hostedUrl = loadCloudConfig().url;
  } catch {
    /* reported in the hosted section */
  }
  if (hasThings) {
    ok("Things 3 installed");
    const access = await checkThingsAccess();
    if (access.ok) ok(`Things ${access.version} is reachable from this terminal`);
    else (fail(access.message), problems++);
  } else if (hostedUrl) {
    // A second Mac: no Things here, it uses the hosted Things (web app + remote MCP).
    info(`Things 3 isn't on this Mac. It uses your hosted Things at ${hostedUrl}.`);
  } else {
    fail("Things 3 not found in /Applications.");
    problems++;
  }

  console.log(`\n${c.bold("AI apps")}`);
  for (const client of allClients()) {
    if (!client.detected) {
      info(`${client.name}: not installed`);
      continue;
    }
    try {
      if (client.isConfigured()) ok(`${client.name}: configured ${c.dim(`(${client.location})`)}`);
      else warn(`${client.name}: installed but not set up — run ${c.cyan("things3pp mcp setup")}`);
    } catch (err) {
      fail(`${client.name}: ${(err as Error).message}`);
    }
  }

  console.log(`\n${c.bold("Remote access")} ${c.dim("(only needed for AI apps on other computers)")}`);
  const ts = await detectTailscale();
  if (ts) ok(`Tailscale connected — this Mac is ${ts.dnsName ?? ts.ip}`);
  else info("Tailscale not connected");
  if (existsSync(tokenPath())) ok(`Access token exists ${c.dim(`(${tokenPath()})`)}`);
  else info("No access token yet — created the first time you run `serve`");

  if (opts.cloud) problems += await cloudChecks();

  console.log(
    `\n${c.dim("Note: macOS grants Things access per app. If an AI app says it can't reach Things, open")}\n${c.dim("System Settings → Privacy & Security → Automation and enable Things3 under that app.")}\n`,
  );
  return problems ? 1 : 0;
}
