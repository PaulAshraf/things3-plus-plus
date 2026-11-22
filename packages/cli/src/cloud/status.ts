// `things3pp cloud status` / `things3pp cloud open`.
import { execFile } from "node:child_process";
import { c, fail, info, ok, warn } from "../cli/ui.js";
import { loadCloudConfig } from "./config.js";

export async function status(): Promise<number> {
  const cfg = loadCloudConfig();
  if (!cfg.url) {
    info(`No hosted Things yet. Create one with ${c.cyan("things3pp cloud deploy")}.`);
    return 1;
  }
  ok(`Hosted Things: ${c.cyan(cfg.url)}`);
  if (cfg.device?.deviceId) ok(`This Mac is linked as "${cfg.device.name}"`);
  else warn(`This Mac isn't linked. Run ${c.cyan("things3pp connect")}.`);
  try {
    const res = await fetch(`${cfg.url}/api/state`);
    if (res.ok) ok("Reachable");
    else warn(`It answered ${res.status}.`);
  } catch (e) {
    fail(`Couldn't reach it: ${(e as Error).message}`);
    return 1;
  }
  console.log(`  Remote MCP server: ${c.cyan(`${cfg.url}/mcp`)} ${c.dim("(add it as a custom connector in Claude or ChatGPT)")}`);
  return 0;
}

export async function openWebApp(): Promise<number> {
  const cfg = loadCloudConfig();
  if (!cfg.url) {
    info(`No hosted Things yet. Create one with ${c.cyan("things3pp cloud deploy")}.`);
    return 1;
  }
  execFile("/usr/bin/open", [cfg.url]);
  return 0;
}
