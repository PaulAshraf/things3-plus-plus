import { allClients, launchCommand } from "./clients.js";
import { checkThingsAccess, nodeVersionOk, thingsInstalled } from "./checks.js";
import { c, confirm, fail, info, ok, warn } from "./ui.js";

export async function setup(flags: { yes: boolean }): Promise<number> {
  console.log(`\n${c.bold("Things 3 for AI apps")} ${c.dim("— setup")}\n`);

  if (process.platform !== "darwin") {
    fail("Things 3 runs on macOS, so this server has to run on your Mac.");
    return 1;
  }
  if (!nodeVersionOk()) {
    fail(`Node.js 20 or newer is required (you have ${process.versions.node}).`);
    return 1;
  }
  if (!thingsInstalled()) {
    fail("Things 3 isn't installed in /Applications. Install it from the Mac App Store, then run this again.");
    return 1;
  }
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
  let added = 0;
  let failed = 0;
  for (const client of detected) {
    let configured = false;
    try {
      configured = client.isConfigured();
    } catch (err) {
      fail(`${client.name}: ${(err as Error).message}`);
      failed++;
      continue;
    }
    const question = configured ? `${client.name} already has Things. Update it?` : `Add Things to ${client.name}?`;
    if (!(flags.yes || (await confirm(question, !configured)))) {
      info(`Skipped ${client.name}`);
      continue;
    }
    try {
      const result = await client.install(launch);
      ok(`${client.name}: ${result}`);
      added++;
    } catch (err) {
      fail(`${client.name}: ${(err as Error).message}`);
      failed++;
    }
  }

  console.log(`\n${c.bold("Next steps")}`);
  if (added) console.log(`  1. ${c.bold("Restart")} the apps you just set up.`);
  console.log(`  ${added ? "2" : "1"}. Ask something like ${c.cyan("“What's on my Things today?”")}`);
  console.log(`  ${added ? "3" : "2"}. The first time, macOS asks ${c.dim("“<App> wants to control Things3”")} — click ${c.bold("OK")}.`);
  console.log(`\n  Using an AI app on another computer? Run ${c.cyan("things3pp mcp serve")} on this Mac.`);
  console.log(`  Something off? Run ${c.cyan("things3pp doctor")}.\n`);
  return failed ? 1 : 0;
}
