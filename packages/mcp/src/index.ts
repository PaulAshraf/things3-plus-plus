#!/usr/bin/env node
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

const HELP = `things3pp ${VERSION} — use Things 3 from AI apps

Usage
  things3pp setup        Connect Things to the AI apps on this Mac
  things3pp doctor       Check that everything is working
  things3pp serve        Share Things with AI apps on your other computers (via Tailscale)
      --port <n>             Port to listen on (default 7766)
      --local                Listen on this Mac only (127.0.0.1), for testing
      --show-token           Include the access token in the printed setup snippets
  things3pp token        Print the remote-access token
      --rotate               Replace it (old token stops working after restarting serve)
  things3pp              Run as an MCP server over stdio (what AI apps call)

Docs: https://github.com/PaulAshraf/things3-plus-plus/tree/master/packages/mcp`;

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === "stdio") {
    if (command === undefined && process.stdin.isTTY) {
      // A person ran this in a terminal; an AI app would have piped stdin.
      console.log(HELP);
      return 0;
    }
    const server = createServer();
    await server.connect(new StdioServerTransport());
    return await new Promise<number>(() => {});
  }

  if (command === "-v" || command === "--version" || command === "version") {
    console.log(VERSION);
    return 0;
  }
  if (command === "-h" || command === "--help" || command === "help") {
    console.log(HELP);
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
