import { allClients, launchCommand, type ClientTarget, type ServerTarget } from "./clients.js";
import { checkThingsAccess, nodeVersionOk, thingsInstalled } from "./checks.js";
import { c, confirm, fail, info, ok, warn } from "./ui.js";
import { loadCloudConfig, normalizeUrl, saveCloudConfig } from "../cloud/config.js";

export interface SetupFlags {
  yes: boolean;
  /** Set up the hosted Things remote MCP instead of the local server (uses the saved address). */
  hosted?: boolean;
  /** Address of a hosted Things; implies hosted. */
  url?: string;
}

const HOSTED_EXAMPLE = "things3pp mcp setup --url https://things.example.com";

/** `https://host[/mcp]` → `https://host/mcp`. Throws a friendly error for anything else. */
export function hostedMcpUrl(input: string): string {
  const address = input.trim();
  const url = new URL(/^https?:\/\//i.test(address) ? address : `https://${address}`);
  const path = url.pathname.replace(/\/+$/, "").toLowerCase();
  if (url.username || url.password || url.search || url.hash || (path && path !== "/mcp")) {
    throw new Error("Use just the address of your hosted Things, like https://things.example.com.");
  }
  return `${normalizeUrl(url.origin)}/mcp`;
}

/** The hosted address this computer already knows from `things3pp connect` / `cloud deploy`, if any. */
function savedHostedUrl(): string | undefined {
  try {
    return loadCloudConfig().url;
  } catch {
    return undefined;
  }
}

/** Saves the hosted address (nothing secret) so `doctor` and later runs know it. Never touches a linked Mac's config. */
function rememberHosted(origin: string) {
  try {
    const cfg = loadCloudConfig();
    if (cfg.device || cfg.url === origin) return;
    cfg.url = origin;
    saveCloudConfig(cfg);
  } catch {
    /* not essential */
  }
}

/** Checks the address is a hosted Things (its OAuth metadata names this /mcp endpoint). Never sends anything private. */
export async function probeHosted(mcpUrl: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const origin = new URL(mcpUrl).origin;
  try {
    const res = await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { ok: false, message: `${origin} answered ${res.status}. Is this the address of your hosted Things?` };
    const meta = (await res.json().catch(() => ({}))) as { resource?: string };
    if (meta.resource !== mcpUrl) return { ok: false, message: `${origin} doesn't look like a hosted Things.` };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: `Couldn't reach ${origin}: ${(e as Error).message}` };
  }
}

export async function setup(flags: SetupFlags): Promise<number> {
  console.log(`\n${c.bold("Things 3 for AI apps")} ${c.dim("— setup")}\n`);

  if (!nodeVersionOk()) {
    fail(`Node.js 20 or newer is required (you have ${process.versions.node}).`);
    return 1;
  }

  if (flags.hosted || flags.url !== undefined) return hostedSetup(flags);

  const hasThings = process.platform === "darwin" && thingsInstalled();
  if (!hasThings) {
    const saved = savedHostedUrl();
    if (saved) {
      info(`Things 3 isn't on this ${process.platform === "darwin" ? "Mac" : "computer"}, so I'll connect your AI apps to your hosted Things at ${saved}.`);
      return hostedSetup({ ...flags, url: saved });
    }
    if (process.platform !== "darwin") fail("Things 3 runs on macOS, so the local server has to run on your Mac.");
    else fail("Things 3 isn't installed in /Applications. Install it from the Mac App Store, then run this again.");
    console.log(`\n  Using hosted Things? Connect this computer's AI apps to it instead (no Things or pairing needed here):`);
    console.log(`    ${c.cyan(HOSTED_EXAMPLE)}\n`);
    return 1;
  }
  return localSetup(flags);
}

async function localSetup(flags: SetupFlags): Promise<number> {
  ok("Things 3 is installed");

  info("Checking access to Things (macOS may ask you to allow this — click OK)…");
  const access = await checkThingsAccess();
  if (access.ok) ok(`Connected to Things ${access.version}`);
  else warn(`${access.message}\n  ${c.dim("You can keep going; each AI app gets its own permission prompt anyway.")}`);

  const launch = launchCommand();
  const clients = allClients();
  const detected = clients.filter((cl) => cl.detected);
  if (detected.length === 0) {
    warn("I couldn't find any supported AI apps. Add this to your app's MCP config by hand:");
    console.log(JSON.stringify({ mcpServers: { things: { command: launch.command, args: launch.args, ...(launch.env ? { env: launch.env } : {}) } } }, null, 2));
    return 0;
  }

  console.log(`\nFound: ${detected.map((cl) => c.bold(cl.name)).join(", ")}\n`);
  const { added, failed } = await installAll(detected, launch, flags.yes);

  console.log(`\n${c.bold("Next steps")}`);
  if (added) console.log(`  1. ${c.bold("Restart")} the apps you just set up.`);
  console.log(`  ${added ? "2" : "1"}. Ask something like ${c.cyan("“What's on my Things today?”")}`);
  console.log(`  ${added ? "3" : "2"}. The first time, macOS asks ${c.dim("“<App> wants to control Things3”")} — click ${c.bold("OK")}.`);
  console.log(`\n  Using an AI app on another computer? Run ${c.cyan("things3pp mcp serve")} on this Mac.`);
  console.log(`  Something off? Run ${c.cyan("things3pp doctor")}.\n`);
  return failed ? 1 : 0;
}

/** Asks before each app (unless --yes), then writes the config. */
async function installAll(clients: ClientTarget[], target: ServerTarget, yes: boolean): Promise<{ added: number; failed: number; done: ClientTarget[] }> {
  let added = 0;
  let failed = 0;
  const done: ClientTarget[] = [];
  for (const client of clients) {
    let configured = false;
    try {
      configured = client.isConfigured();
    } catch (err) {
      fail(`${client.name}: ${(err as Error).message}`);
      failed++;
      continue;
    }
    const question = configured ? `${client.name} already has Things. Update it?` : `Add Things to ${client.name}?`;
    if (!(yes || (await confirm(question, !configured)))) {
      info(`Skipped ${client.name}`);
      continue;
    }
    try {
      const result = await client.install(target);
      ok(`${client.name}: ${result}`);
      added++;
      done.push(client);
    } catch (err) {
      fail(`${client.name}: ${(err as Error).message}`);
      failed++;
    }
  }
  return { added, failed, done };
}

/**
 * Points this computer's AI apps at a hosted Things' remote MCP. Needs no Things, no pairing and no
 * device key: each app signs in through the deployment's OAuth (a passkey) the first time it connects.
 */
async function hostedSetup(flags: SetupFlags): Promise<number> {
  let raw = flags.url;
  if (raw === undefined) {
    try {
      raw = loadCloudConfig().url;
    } catch (e) {
      fail((e as Error).message);
      return 1;
    }
  }
  if (!raw) {
    fail("I don't know the address of your hosted Things yet.");
    console.log(`  Pass it like this: ${c.cyan(HOSTED_EXAMPLE)}`);
    console.log(`  ${c.dim("It's shown in your hosted Things under Settings.")}\n`);
    return 1;
  }
  let url: string;
  try {
    url = hostedMcpUrl(raw);
  } catch (e) {
    fail((e as Error).message);
    return 1;
  }

  info(`Checking ${new URL(url).origin}…`);
  const probe = await probeHosted(url);
  if (probe.ok) {
    ok(`Found your hosted Things: ${c.cyan(url)}`);
    rememberHosted(new URL(url).origin);
  } else warn(`${probe.message}\n  ${c.dim("Setting it up anyway; run this again with the right --url if needed.")}`);

  const clients = allClients();
  const detected = clients.filter((cl) => cl.detected);
  const writable = detected.filter((cl) => cl.supportsRemote);
  const manual = detected.filter((cl) => !cl.supportsRemote);

  if (detected.length === 0) {
    warn("I couldn't find any supported AI apps. Add this remote MCP server in your app (it signs in with your passkey):");
    console.log(`  ${c.cyan(url)}\n`);
    return 0;
  }

  console.log(`\nFound: ${detected.map((cl) => c.bold(cl.name)).join(", ")}\n`);
  const { added, failed, done } = await installAll(writable, { url }, flags.yes);
  for (const client of manual) info(`${client.name}: ${client.remoteHint(url)}`);

  console.log(`\n${c.bold("Next steps")}`);
  let step = 1;
  if (added) console.log(`  ${step++}. ${c.bold("Restart")} the apps you just set up.`);
  if (done.length) {
    console.log(`  ${step++}. Sign in with your passkey when the app opens your browser:`);
    for (const client of done) console.log(`       ${c.bold(client.name)}: ${client.remoteHint(url)}`);
  }
  console.log(`  ${step}. Ask something like ${c.cyan("“What's on my Things today?”")}`);
  console.log(`\n  Claude.ai or ChatGPT on the web? Add ${c.cyan(url)} as a custom connector.`);
  console.log(`  Changes need the Mac that runs Things to be awake and connected.\n`);
  return failed ? 1 : 0;
}
