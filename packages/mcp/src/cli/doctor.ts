import { existsSync } from "node:fs";
import { tokenPath } from "../config.js";
import { detectTailscale } from "../tailscale.js";
import { VERSION } from "../version.js";
import { allClients } from "./clients.js";
import { checkThingsAccess, nodeVersionOk, thingsInstalled } from "./checks.js";
import { c, fail, info, ok, warn } from "./ui.js";

export async function doctor(): Promise<number> {
  console.log(`\n${c.bold("things3pp doctor")} ${c.dim(`v${VERSION}`)}\n`);
  let problems = 0;

  if (process.platform === "darwin") ok("macOS");
  else (fail("Not macOS — Things only runs on a Mac."), problems++);

  if (nodeVersionOk()) ok(`Node.js ${process.versions.node}`);
  else (fail(`Node.js ${process.versions.node} — version 20 or newer is required.`), problems++);

  if (thingsInstalled()) ok("Things 3 installed");
  else (fail("Things 3 not found in /Applications."), problems++);

  const access = await checkThingsAccess();
  if (access.ok) ok(`Things ${access.version} is reachable from this terminal`);
  else (fail(access.message), problems++);

  console.log(`\n${c.bold("AI apps")}`);
  for (const client of allClients()) {
    if (!client.detected) {
      info(`${client.name}: not installed`);
      continue;
    }
    try {
      if (client.isConfigured()) ok(`${client.name}: configured ${c.dim(`(${client.location})`)}`);
      else warn(`${client.name}: installed but not set up — run ${c.cyan("things3pp setup")}`);
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

  console.log(
    `\n${c.dim("Note: macOS grants Things access per app. If an AI app says it can't reach Things, open")}\n${c.dim("System Settings → Privacy & Security → Automation and enable Things3 under that app.")}\n`,
  );
  return problems ? 1 : 0;
}
