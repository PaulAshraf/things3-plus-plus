#!/usr/bin/env node
import { parseArgs } from "node:util";
import { VERSION } from "./version.js";

const HELP = `things3pp ${VERSION} — Things 3 for AI apps and the web

Usage
  things3pp mcp …        Use Things from AI apps on this Mac (run "things3pp mcp help")
  things3pp cloud …      Your own hosted Things web app + remote MCP on Cloudflare (run "things3pp cloud help")
  things3pp connect      Link this Mac to your hosted Things (shows a pairing code)
  things3pp agent …      Keep this Mac connected in the background (install, uninstall, status)
  things3pp doctor       Check that everything is working

Docs: https://github.com/PaulAshraf/things3-plus-plus/tree/master/packages/cli`;

const MCP_HELP = `things3pp mcp — use Things from AI apps

Usage
  things3pp mcp              Run as an MCP server over stdio (what AI apps call)
  things3pp mcp setup        Connect Things to the AI apps on this Mac
      -y, --yes                  Don't ask before changing each app's settings
  things3pp mcp doctor       Check the local MCP setup
  things3pp mcp serve        Share Things with AI apps on your other computers (via Tailscale)
      --port <n>                 Port to listen on (default 7766)
      --local                    Listen on this Mac only (127.0.0.1), for testing
      --show-token               Include the access token in the printed setup snippets
  things3pp mcp token        Print the Tailscale access token
      --rotate                   Replace it (old token stops working after restarting serve)`;

const CLOUD_HELP = `things3pp cloud — your own hosted Things, on your Cloudflare account

Usage
  things3pp cloud deploy     Deploy the web app + remote MCP server with the Cloudflare CLI (cf)
      --domain <host>            Also serve it on a custom domain from your Cloudflare account
                                 (e.g. things.example.com; remembered for later deploys)
      --shared                   Run it as a shared service: any Mac can create its own account
  things3pp cloud status     Show the linked web address and whether this Mac is connected
  things3pp cloud open       Open your hosted Things in the browser

After deploying: run "things3pp connect", then "things3pp agent install".`;

const AGENT_HELP = `things3pp agent — keep this Mac connected to your hosted Things

Usage
  things3pp agent install    Start at login and stay connected (launchd)
  things3pp agent uninstall  Stop and remove the background agent
  things3pp agent status     Is it running?
  things3pp agent run        Run in the foreground (what launchd calls)`;

async function stdio(): Promise<number> {
  const { StdioServerTransport } = await import("@modelcontextprotocol/server/stdio");
  const { createLocalServer } = await import("./local.js");
  await createLocalServer().connect(new StdioServerTransport());
  return await new Promise<number>(() => {});
}

function isHelp(cmd: string | undefined) {
  return cmd === "-h" || cmd === "--help" || cmd === "help";
}

async function mcp(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || command === "stdio") {
    if (command === undefined && process.stdin.isTTY) {
      console.log(MCP_HELP);
      return 0;
    }
    return stdio();
  }
  if (isHelp(command)) {
    console.log(MCP_HELP);
    return 0;
  }
  if (command === "setup") {
    const { values } = parseArgs({ args: rest, options: { yes: { type: "boolean", short: "y", default: false } } });
    const { setup } = await import("./cli/setup.js");
    return setup({ yes: Boolean(values.yes) });
  }
  if (command === "doctor") {
    const { doctor } = await import("./cli/doctor.js");
    return doctor();
  }
  if (command === "serve") {
    const { values } = parseArgs({
      args: rest,
      options: {
        port: { type: "string" },
        local: { type: "boolean", default: false },
        "show-token": { type: "boolean", default: false },
      },
    });
    const port = values.port === undefined ? undefined : Number(values.port);
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      console.error(`Invalid --port: ${values.port}`);
      return 1;
    }
    const { serve } = await import("./cli/serve.js");
    return serve({ port, local: Boolean(values.local), showToken: Boolean(values["show-token"]) });
  }
  if (command === "token") {
    const { values } = parseArgs({ args: rest, options: { rotate: { type: "boolean", default: false } } });
    const { loadOrCreateToken, rotateToken } = await import("./config.js");
    console.log(values.rotate ? rotateToken() : loadOrCreateToken().token);
    return 0;
  }
  console.error(`Unknown command: things3pp mcp ${command}\n\n${MCP_HELP}`);
  return 1;
}

async function cloud(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined || isHelp(command)) {
    console.log(CLOUD_HELP);
    return 0;
  }
  if (command === "deploy") {
    const { values } = parseArgs({ args: rest, options: { domain: { type: "string" }, shared: { type: "boolean", default: false } } });
    const { deploy } = await import("./cloud/deploy.js");
    return deploy({ domain: values.domain, shared: Boolean(values.shared) });
  }
  if (command === "status") {
    const { status } = await import("./cloud/status.js");
    return status();
  }
  if (command === "open") {
    const { openWebApp } = await import("./cloud/status.js");
    return openWebApp();
  }
  console.error(`Unknown command: things3pp cloud ${command}\n\n${CLOUD_HELP}`);
  return 1;
}

async function agent(argv: string[]): Promise<number> {
  const [command] = argv;
  if (command === undefined || isHelp(command)) {
    console.log(AGENT_HELP);
    return 0;
  }
  const mod = await import("./cloud/agent.js");
  if (command === "install") return mod.install();
  if (command === "uninstall") return mod.uninstall();
  if (command === "status") return mod.agentStatus();
  if (command === "run") return mod.run();
  console.error(`Unknown command: things3pp agent ${command}\n\n${AGENT_HELP}`);
  return 1;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined) {
    // Older AI app configs start the server with no arguments and pipe stdin. Keep them working.
    if (!process.stdin.isTTY) return stdio();
    console.log(HELP);
    return 0;
  }
  if (command === "-v" || command === "--version" || command === "version") {
    console.log(VERSION);
    return 0;
  }
  if (isHelp(command)) {
    console.log(HELP);
    return 0;
  }
  if (command === "mcp") return mcp(rest);
  if (command === "cloud") return cloud(rest);
  if (command === "agent") return agent(rest);
  if (command === "connect") {
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: { "no-open": { type: "boolean", default: false } } });
    const { connect } = await import("./cloud/connect.js");
    return connect({ url: positionals[0], open: !values["no-open"] });
  }
  if (command === "disconnect") {
    const { disconnect } = await import("./cloud/connect.js");
    return disconnect();
  }
  if (command === "doctor") {
    const { doctor } = await import("./cli/doctor.js");
    return doctor({ cloud: true });
  }

  // Old top-level commands moved under "mcp". Point people to the new spelling.
  if (command === "setup" || command === "serve" || command === "token" || command === "stdio") {
    console.error(`"things3pp ${command}" is now "things3pp mcp ${command}". Running that for you…\n`);
    return mcp(argv);
  }

  console.error(`Unknown command: ${command}\n\n${HELP}`);
  return 1;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
