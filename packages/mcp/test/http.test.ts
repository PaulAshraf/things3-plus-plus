import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createHttpApp, listen } from "../src/http.js";
import { ThingsClient } from "../src/things/client.js";
import { fakeRunner, todo } from "./fixtures.js";

const TOKEN = "t3pp_test-token-that-is-long-enough-to-be-real-0123456789";
const things = new ThingsClient(fakeRunner(() => ({ total: 1, items: [todo()] })).runner);

const initBody = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
});

function req(opts: { path?: string; host?: string; token?: string | null; origin?: string } = {}) {
  const headers: Record<string, string> = {
    host: opts.host ?? "100.100.1.2:7766",
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (opts.token !== null) headers.authorization = `Bearer ${opts.token ?? TOKEN}`;
  if (opts.origin) headers.origin = opts.origin;
  return new Request(`http://100.100.1.2:7766${opts.path ?? "/mcp"}`, { method: "POST", headers, body: initBody });
}

describe("HTTP guard", () => {
  const app = () => createHttpApp({ token: TOKEN, allowedHosts: ["100.100.1.2", "my-mac.tail.ts.net"], things });

  it("serves MCP with the right token", async () => {
    const res = await app().fetch(req());
    expect(res.status).toBe(200);
  });

  it("only serves /mcp", async () => {
    expect((await app().fetch(req({ path: "/" }))).status).toBe(404);
  });

  it("rejects missing and wrong tokens", async () => {
    const a = app();
    expect((await a.fetch(req({ token: null }))).status).toBe(401);
    const wrong = await a.fetch(req({ token: `${TOKEN}x` }));
    expect(wrong.status).toBe(401);
    expect(wrong.headers.get("www-authenticate")).toMatch(/^Bearer/);
  });

  it("rejects unexpected Host headers (DNS rebinding)", async () => {
    expect((await app().fetch(req({ host: "evil.example.com" }))).status).toBe(403);
    expect((await app().fetch(req({ host: "my-mac.tail.ts.net:7766" }))).status).toBe(200);
  });

  it("rejects browser requests even with a valid token", async () => {
    expect((await app().fetch(req({ origin: "https://evil.example.com" }))).status).toBe(403);
  });

  it("rate-limits repeated bad tokens per client", async () => {
    let t = 0;
    const a = createHttpApp({ token: TOKEN, allowedHosts: ["100.100.1.2"], things, maxAuthFailuresPerMinute: 3, now: () => t });
    for (let i = 0; i < 3; i++) expect((await a.fetch(req({ token: "nope" }), "1.2.3.4")).status).toBe(401);
    expect((await a.fetch(req(), "1.2.3.4")).status).toBe(429); // even the right token waits
    expect((await a.fetch(req(), "5.6.7.8")).status).toBe(200); // other clients unaffected
    t += 61_000;
    expect((await a.fetch(req(), "1.2.3.4")).status).toBe(200);
  });
});

describe("HTTP end to end (loopback)", () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

  it("a real MCP client can connect with the token and call a tool", async () => {
    server = await listen({ host: "127.0.0.1", port: 0, token: TOKEN, allowedHosts: ["127.0.0.1"], things });
    const { port } = server.address() as AddressInfo;
    const url = new URL(`http://127.0.0.1:${port}/mcp`);

    const client = new Client({ name: "remote", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }));
    const res = await client.callTool({ name: "show_list", arguments: { list: "today" } });
    expect(res.structuredContent).toMatchObject({ view: "list", total: 1 });
    await client.close();

    const anon = new Client({ name: "anon", version: "1.0.0" });
    await expect(anon.connect(new StreamableHTTPClientTransport(url))).rejects.toThrow();
  });
});
