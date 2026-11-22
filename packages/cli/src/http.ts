import { createHash, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type Server } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { createLocalServer } from "./local.js";
import type { ThingsClient } from "things3pp-core/things/client";

export const MCP_PATH = "/mcp";

export interface HttpAppOptions {
  token: string;
  /** Hostnames clients may use to reach us (checked against the Host header). */
  allowedHosts: string[];
  things?: ThingsClient;
  log?: (line: string) => void;
  /** Failed-auth attempts allowed per client per minute before answering 429. */
  maxAuthFailuresPerMinute?: number;
  now?: () => number;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function hostnameOf(hostHeader: string): string | null {
  try {
    return new URL(`http://${hostHeader}`).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

function json(status: number, body: object, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/**
 * Web-standard request handler guarding the MCP endpoint:
 * path → Host allow-list → no browser Origins → rate-limited bearer token → MCP.
 */
export function createHttpApp(opts: HttpAppOptions) {
  const expected = digest(opts.token);
  const allowed = new Set(opts.allowedHosts.map((h) => h.toLowerCase()));
  const log = opts.log ?? (() => {});
  const now = opts.now ?? Date.now;
  const maxFailures = opts.maxAuthFailuresPerMinute ?? 10;
  const failures = new Map<string, { count: number; since: number }>();
  const mcp = createMcpHandler(() => createLocalServer(opts.things), { onerror: (e) => log(`mcp error: ${e.message}`) });

  function tooManyFailures(client: string): boolean {
    const f = failures.get(client);
    if (!f) return false;
    if (now() - f.since > 60_000) {
      failures.delete(client);
      return false;
    }
    return f.count >= maxFailures;
  }
  function recordFailure(client: string) {
    const f = failures.get(client);
    if (!f || now() - f.since > 60_000) failures.set(client, { count: 1, since: now() });
    else f.count++;
  }

  async function fetch(request: Request, client = "unknown"): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== MCP_PATH) return json(404, { error: "not_found" });

    // DNS-rebinding defence: only answer to names we expect.
    const host = hostnameOf(request.headers.get("host") ?? "");
    if (!host || !allowed.has(host)) {
      log(`rejected: unexpected Host header from ${client}`);
      return json(403, { error: "forbidden_host" });
    }
    // MCP clients aren't browsers. A browser Origin means a web page is trying to reach us.
    if (request.headers.get("origin")) {
      log(`rejected: browser Origin from ${client}`);
      return json(403, { error: "forbidden_origin" });
    }

    if (tooManyFailures(client)) return json(429, { error: "too_many_attempts" }, { "retry-after": "60" });
    const auth = request.headers.get("authorization") ?? "";
    const match = /^Bearer\s+(\S+)$/i.exec(auth);
    if (!match || !timingSafeEqual(digest(match[1]!), expected)) {
      recordFailure(client);
      log(`rejected: ${match ? "wrong" : "missing"} token from ${client}`);
      return json(401, { error: "invalid_token" }, { "www-authenticate": 'Bearer realm="things3pp"' });
    }

    return mcp.fetch(request);
  }

  return { fetch, close: () => mcp.close?.() };
}

export interface ListenOptions extends HttpAppOptions {
  host: string;
  port: number;
}

export function listen(opts: ListenOptions): Promise<Server> {
  const app = createHttpApp(opts);
  const server = createHttpServer((req, res) => {
    const client = req.socket.remoteAddress ?? "unknown";
    void toNodeHandler({ fetch: (request) => app.fetch(request, client) })(req, res);
  });
  // Keep slow or idle clients from holding sockets forever.
  server.headersTimeout = 15_000;
  server.requestTimeout = 120_000;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolve(server));
  });
}
