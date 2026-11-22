import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { request } from "node:http";
import { createServer } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { detectTailscale } from "../../dist/tailscale.js";
import { cli, enabled, entry } from "./support.js";

async function unusedPort(host: string) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function probe(hostname: string, port: number, headers: Record<string, string> = {}, path = "/mcp") {
  return new Promise<{ status: number | undefined; challenge: string | undefined }>((resolve, reject) => {
    const req = request({ hostname, port, path, headers, timeout: 3000 }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, challenge: res.headers["www-authenticate"] });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("socket timed out")));
    req.end();
  });
}

async function serve(local: boolean, port: number, env: NodeJS.ProcessEnv, verify: (output: string) => Promise<void>, extra: string[] = []) {
  const child = spawn(process.execPath, [entry, "mcp", "serve", ...(local ? ["--local"] : []), "--port", String(port), ...extra], {
    env, stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (data) => { stdout += data; });
  child.stderr.setEncoding("utf8").on("data", (data) => { stderr += data; });
  const closed = new Promise((resolve) => child.once("close", resolve));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => reject(new Error(`serve exited ${code}: ${stderr}\n${stdout.split("Claude Code")[0]}`)));
      child.stdout.on("data", () => { if (stdout.includes("Press Ctrl+C to stop")) resolve(); });
      timer = setTimeout(() => reject(new Error(`serve startup timed out: ${stderr}`)), 40_000);
    });
    await verify(stripVTControlCharacters(stdout));
  } finally {
    clearTimeout(timer);
    child.kill();
    await closed;
    console.info(`serve on port ${port} stopped`);
  }
}

function readToken(env: NodeJS.ProcessEnv, rotate = false) {
  const result = cli(rotate ? ["mcp", "token", "--rotate"] : ["mcp", "token"], env);
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

async function sdkList(url: string, token: string) {
  const client = new Client({ name: "things-http-e2e", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const start = performance.now();
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: "show_list", arguments: { list: "today", limit: 5 } });
    expect(result.isError ?? false).toBe(false);
    expect(result.structuredContent?.view).toBe("list");
    const elapsed = performance.now() - start;
    console.info(`HTTP initialize + show_list ${Math.round(elapsed)} ms${elapsed > 5000 ? " (slow)" : ""}`);
  } finally {
    await client.close();
  }
}

function verifySnippets(output: string, url: string, token: string) {
  const auth = `Bearer ${token}`;
  expect(output.includes(`claude mcp add --transport http things ${url} --header "Authorization: ${auth}"`)).toBe(true);
  expect(output.includes(`[mcp_servers.things]\n  url = "${url}"\n  http_headers = { Authorization = "${auth}" }`)).toBe(true);
  expect(output.includes(JSON.stringify({ things: { type: "http", url, headers: { Authorization: auth } } }))).toBe(true);
  expect(output.includes(JSON.stringify({
    things: { command: "npx", args: ["-y", "mcp-remote", url, "--allow-http", "--header", "Authorization:${AUTH}"], env: { AUTH: auth } },
  }))).toBe(true);
}

describe.runIf(enabled)("built HTTP server", () => {
  it("authenticates on loopback, rejects hostile headers and rotates credentials", async () => {
    const temp = mkdtempSync(join(tmpdir(), "things-e2e-http-"));
    const dir = join(temp, "config");
    const env = { ...process.env, THINGS3PP_CONFIG_DIR: dir };
    const host = "127.0.0.1";
    const port = await unusedPort(host);
    const url = `http://${host}:${port}/mcp`;
    let oldToken: string;
    try {
      await serve(true, port, env, async (output) => {
        oldToken = readToken(env);
        expect(oldToken.length).toBeGreaterThanOrEqual(32);
        expect(statSync(dir).mode & 0o777).toBe(0o700);
        expect(statSync(join(dir, "token")).mode & 0o777).toBe(0o600);
        // The token stays out of startup output by default (so it never lands in logs).
        expect(output).not.toContain(oldToken);
        verifySnippets(output, url, "<YOUR_TOKEN>");
        expect(output).toContain("things3pp token");
        await sdkList(url, oldToken);
        expect((await probe(host, port)).status).toBe(401);
        const wrong = { Authorization: "Bearer invalid" };
        const rejected = await probe(host, port, wrong);
        expect(rejected.status).toBe(401);
        expect(rejected.challenge).toMatch(/^Bearer/i);
        expect((await probe(host, port, { ...wrong, Origin: "https://example.invalid" })).status).toBe(403);
        expect((await probe(host, port, { ...wrong, Host: "evil.com" })).status).toBe(403);
        expect((await probe(host, port, { ...wrong, Host: "evil.com" }, "/elsewhere")).status).toBe(404);
        const statuses = [];
        for (let i = 0; i < 11; i++) statuses.push((await probe(host, port, wrong)).status);
        expect(statuses.at(-1)).toBe(429);
      });
      const rotated = readToken(env, true);
      expect(rotated === oldToken!).toBe(false);
      await serve(true, port, env, async () => {
        expect((await probe(host, port, { Authorization: `Bearer ${oldToken}` })).status).toBe(401);
        await sdkList(url, rotated);
      });
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }, 150_000);

  it("binds only to the real Tailscale interface", async () => {
    const ts = await detectTailscale();
    expect(ts, "Tailscale needs to be connected").toBeTruthy();
    const { ip, dnsName } = ts!;
    const lan = Object.values(networkInterfaces()).flatMap((items) => items ?? [])
      .filter((addr) => addr.family === "IPv4" && !addr.internal && addr.address !== ip)
      .map((addr) => addr.address);
    expect(lan.length, "a LAN IPv4 address is needed to verify binding").toBeGreaterThan(0);

    const temp = mkdtempSync(join(tmpdir(), "things-e2e-tailnet-"));
    const env = { ...process.env, THINGS3PP_CONFIG_DIR: join(temp, "config") };
    const port = await unusedPort(ip);
    try {
      await serve(false, port, env, async (output) => {
        const token = readToken(env);
        verifySnippets(output, `http://${dnsName ?? ip}:${port}/mcp`, token); // --show-token fills it in
        await sdkList(`http://${ip}:${port}/mcp`, token);
        if (dnsName) await sdkList(`http://${dnsName}:${port}/mcp`, token);
        for (const address of ["127.0.0.1", ...lan]) {
          await expect(probe(address, port)).rejects.toMatchObject({ code: "ECONNREFUSED" });
        }
      }, ["--show-token"]);
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  }, 90_000);
});
