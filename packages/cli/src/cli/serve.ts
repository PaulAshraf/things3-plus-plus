import { listen, MCP_PATH } from "../http.js";
import { loadOrCreateToken, tokenPath } from "../config.js";
import { detectTailscale } from "../tailscale.js";
import { checkThingsAccess } from "./checks.js";
import { c, fail, info, ok, warn } from "./ui.js";

export const DEFAULT_PORT = 7766;

export function remoteSnippets(url: string, token: string): string {
  const auth = `Bearer ${token}`;
  return [
    `${c.bold("Claude Code")}`,
    `  claude mcp add --transport http things ${url} --header "Authorization: ${auth}"`,
    ``,
    `${c.bold("Codex")} ${c.dim("(~/.codex/config.toml)")}`,
    `  [mcp_servers.things]`,
    `  url = "${url}"`,
    `  http_headers = { Authorization = "${auth}" }`,
    ``,
    `${c.bold("Cursor / VS Code / other apps with HTTP support")}`,
    `  ${JSON.stringify({ things: { type: "http", url, headers: { Authorization: auth } } })}`,
    ``,
    `${c.bold("Claude Desktop")} ${c.dim("(stdio only — bridges with mcp-remote)")}`,
    `  ${JSON.stringify({ things: { command: "npx", args: ["-y", "mcp-remote", url, "--allow-http", "--header", "Authorization:${AUTH}"], env: { AUTH: auth } } })}`,
  ].join("\n");
}

export const TOKEN_PLACEHOLDER = "<YOUR_TOKEN>";

export async function serve(flags: { port?: number; local: boolean; showToken: boolean }): Promise<number> {
  const port = flags.port ?? DEFAULT_PORT;
  let host: string;
  let publicName: string;
  let allowedHosts: string[];

  if (flags.local) {
    host = "127.0.0.1";
    publicName = "127.0.0.1";
    allowedHosts = ["127.0.0.1", "localhost"];
  } else {
    const ts = await detectTailscale();
    if (!ts) {
      fail("Tailscale isn't connected on this Mac.");
      console.log(
        `  Remote access only listens on your private Tailscale network, never the open internet.\n` +
          `  1. Install Tailscale: ${c.cyan("https://tailscale.com/download/mac")}\n` +
          `  2. Sign in on this Mac and on the computer running your AI app.\n` +
          `  3. Run ${c.cyan("things3pp mcp serve")} again.\n`,
      );
      return 1;
    }
    host = ts.ip;
    publicName = ts.dnsName ?? ts.ip;
    allowedHosts = [ts.ip, ...(ts.dnsName ? [ts.dnsName, ts.dnsName.split(".")[0]!] : [])];
  }

  const { token, created } = loadOrCreateToken();
  if (created) ok(`Created a new access token ${c.dim(`(${tokenPath()}, readable only by you)`)}`);

  info("Checking access to Things (click OK if macOS asks)…");
  const access = await checkThingsAccess();
  if (access.ok) ok(`Connected to Things ${access.version}`);
  else warn(access.message);

  const log = (line: string) => console.error(`${c.dim(new Date().toLocaleTimeString())} ${line}`);
  try {
    await listen({ host, port, token, allowedHosts, log });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    fail(e.code === "EADDRINUSE" ? `Port ${port} is already in use. Try --port ${port + 1}.` : e.message);
    return 1;
  }

  const url = `http://${publicName}:${port}${MCP_PATH}`;
  console.log(`\n${c.green("●")} ${c.bold("Things MCP is running")} ${flags.local ? c.dim("(this Mac only)") : c.dim("(your Tailscale network only)")}`);
  console.log(`  ${c.cyan(url)}\n`);
  console.log(`${c.bold("Add it in your AI app on the other computer:")}\n`);
  console.log(remoteSnippets(url, flags.showToken ? token : TOKEN_PLACEHOLDER));
  if (!flags.showToken) {
    console.log(
      `\n${c.bold("Your token:")} run ${c.cyan("things3pp mcp token")} in another Terminal tab and paste it in place of ${TOKEN_PLACEHOLDER}.` +
        `\n${c.dim("(Or restart with --show-token to fill it in above. It's hidden by default so it doesn't end up in logs.)")}`,
    );
  }
  console.log(
    `\n${c.dim("Keep the token secret — anyone with it (and access to your tailnet) can read and edit your to-dos.")}` +
      `\n${c.dim("Lost it or shared it by mistake? Run `things3pp mcp token --rotate`, then restart serve.")}` +
      `\n${c.dim("Press Ctrl+C to stop.")}\n`,
  );
  return await new Promise<number>(() => {}); // run until killed
}
