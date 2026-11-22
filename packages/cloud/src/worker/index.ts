// Worker entry: OAuth 2.1 for remote MCP (workers-oauth-provider), the MCP endpoint itself,
// passkey sign-in, Mac pairing, the live relay, and the static web app.

import OAuthProvider, { AuthorizationError, CimdFetchError, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "things3pp-core/mcp/server";
import { SnapshotThingsApi } from "things3pp-core/model/snapshot-api";
import type { Snapshot } from "things3pp-core/model/types";
import type { ActionResult } from "things3pp-core/relay/protocol";
import viewHtml from "things3pp-core/view.html?raw";
import {
  account,
  authenticationOptions,
  clearSessionCookie,
  currentAccount,
  directory,
  registrationOptions,
  startSession,
  verifyAuthentication,
  verifyRegistration,
} from "./auth.ts";
import type { Env, McpProps } from "./env.ts";
import { json, normalizeCode, problem, randomToken, safeEqual, verifyEd25519 } from "./util.ts";
import { recoverText } from "things3pp-core/relay/protocol";

const ACCOUNT_RE = /^acc_[A-Za-z0-9_-]{8,40}$/;

export { Account } from "./account.ts";
export { Directory } from "./directory.ts";

const VERSION = "0.2.0";
const SCOPE = "things";

// ----- MCP (behind OAuth) -----

const mcpApi = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext & { props: McpProps }): Promise<Response> {
    const acc = account(env, ctx.props.accountId);
    const things = new SnapshotThingsApi({
      snapshot: async () => (await acc.snapshot()) as Snapshot,
      send: async (action) => (await acc.call(action)) as ActionResult,
    });
    const handler = createMcpHandler(() => createServer({ things, viewHtml: () => viewHtml, version: VERSION }));
    return handler.fetch(request);
  },
};

// ----- helpers -----

/** Blocks cross-site requests to state-changing endpoints: browsers can't add this header cross-origin without CORS. */
function sameOrigin(request: Request): boolean {
  if (request.headers.get("x-things3pp") !== "1") return false;
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function body<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function withCookie(res: Response, cookie: string): Response {
  const r = new Response(res.body, res);
  r.headers.append("set-cookie", cookie);
  return r;
}

const DEVICE_NAME_RE = /^[\p{L}\p{N} ’'._()-]{1,64}$/u;
const PUBLIC_KEY_RE = /^[A-Za-z0-9_-]{43}$/; // raw Ed25519 key, base64url

// ----- the app's own API -----

async function api(request: Request, env: Env, path: string): Promise<Response> {
  const method = request.method;
  const dir = directory(env);
  const open = env.SIGNUPS === "open";

  // Who am I / is this deployment set up yet?
  if (path === "/api/state" && method === "GET") {
    const session = await currentAccount(env, request);
    const owner = await dir.ownerAccountId();
    if (!session) return json({ signedIn: false, setUp: open || owner !== null, shared: open });
    const acc = account(env, session.accountId);
    return json({ signedIn: true, setUp: true, mac: await acc.macState(), devices: await acc.devices() });
  }

  // ----- Mac pairing (called by `things3pp connect`) -----

  if (path === "/api/pair/start" && method === "POST") {
    const b = await body<{
      publicKey?: string;
      deviceName?: string;
      setupKey?: string;
      recover?: { accountId?: string; deviceId?: string; ts?: number; signature?: string };
    }>(request);
    if (!b?.publicKey || !PUBLIC_KEY_RE.test(b.publicKey) || !b.deviceName || !DEVICE_NAME_RE.test(b.deviceName)) {
      return problem(400, "invalid_request", "Send publicKey (raw Ed25519, base64url) and a deviceName.");
    }
    const setupOk = typeof b.setupKey === "string" && b.setupKey.length > 0 && (await safeEqual(b.setupKey, env.SETUP_KEY));
    // A Mac that's already paired can ask to add a passkey (if every passkey was lost). It proves
    // itself by signing a fresh timestamp with its device key.
    let recover: { accountId: string; deviceId: string } | undefined;
    if (b.recover) {
      const { accountId, deviceId, ts, signature } = b.recover;
      if (!accountId || !ACCOUNT_RE.test(accountId) || !deviceId || typeof ts !== "number" || !signature || Math.abs(Date.now() - ts) > 120_000) {
        return problem(400, "invalid_request", "Invalid recovery request. Check this Mac's clock and try again.");
      }
      const key = await account(env, accountId).devicePublicKey(deviceId);
      if (!key || key !== b.publicKey || !(await verifyEd25519(key, signature, recoverText(deviceId, ts)))) {
        return problem(403, "forbidden", "This Mac isn't linked to that account anymore. Remove its link (things3pp disconnect) and pair again.");
      }
      recover = { accountId, deviceId };
    }
    try {
      const started = await dir.startPairing({ publicKey: b.publicKey, deviceName: b.deviceName, setupOk, recover, client: request.headers.get("cf-connecting-ip") ?? undefined });
      const url = new URL(request.url);
      return json({ ...started, approveUrl: `${url.origin}/pair#${started.code}` });
    } catch (e) {
      return problem(429, "too_many", e instanceof Error ? e.message : "Try again later.");
    }
  }

  if (path === "/api/pair/poll" && method === "POST") {
    const b = await body<{ pairingId?: string; pollToken?: string }>(request);
    if (!b?.pairingId || !b.pollToken) return problem(400, "invalid_request", "Send pairingId and pollToken.");
    return json(await dir.pollPairing(b.pairingId, b.pollToken));
  }

  // ----- Mac pairing (the browser side) -----

  if (path === "/api/pair/info" && method === "POST") {
    if (!sameOrigin(request)) return problem(403, "forbidden", "Cross-site request blocked.");
    const b = await body<{ code?: string }>(request);
    const p = b?.code ? await dir.getPairing(normalizeCode(b.code)) : null;
    if (!p || p.status !== "pending") return problem(404, "not_found", "That code has expired or doesn't exist. Run things3pp connect again for a new one.");
    const owner = await dir.ownerAccountId();
    const session = await currentAccount(env, request);
    return json({
      deviceName: p.deviceName,
      expiresAt: p.expiresAt,
      // First-time setup: no owner yet, and the Mac proved it deployed this Worker.
      canCreateAccount: !p.recover && !session && (open || (!owner && p.setupOk)),
      // A linked Mac asked to add a new passkey.
      canAddPasskey: Boolean(p.recover),
      needsSignIn: !open && owner !== null && !session,
      signedIn: Boolean(session),
      setUp: open || owner !== null,
    });
  }

  if (path === "/api/pair/register-options" && method === "POST") {
    if (!sameOrigin(request)) return problem(403, "forbidden", "Cross-site request blocked.");
    const b = await body<{ code?: string }>(request);
    const code = b?.code ? normalizeCode(b.code) : "";
    const p = code ? await dir.getPairing(code) : null;
    if (p?.status === "pending" && p.recover) {
      const acc = account(env, p.recover.accountId);
      return json(await registrationOptions(env, request, p.recover.accountId, "add-passkey", await acc.credentialIds()));
    }
    const accountId = code ? await dir.reserveAccountId(code, open) : null;
    if (!accountId) return problem(403, "forbidden", "This code can't create an account. Run things3pp connect again on the Mac that deployed this.");
    return json(await registrationOptions(env, request, accountId, "register"));
  }

  if (path === "/api/pair/complete" && method === "POST") {
    if (!sameOrigin(request)) return problem(403, "forbidden", "Cross-site request blocked.");
    const b = await body<{ code?: string; credential?: RegistrationResponseJSON }>(request);
    const code = b?.code ? normalizeCode(b.code) : "";
    const p = code ? await dir.getPairing(code) : null;
    if (p?.status === "pending" && p.recover && b?.credential) {
      const verified = await verifyRegistration(env, request, b.credential, "add-passkey");
      if (!verified || verified.accountId !== p.recover.accountId) return problem(400, "passkey_failed", "Couldn't verify the passkey. Try again.");
      await account(env, verified.accountId).addCredential(verified.credential);
      await dir.approvePairing(code, verified.accountId, p.recover.deviceId);
      return withCookie(json({ ok: true }), await startSession(env, request, verified.accountId));
    }
    if (!p || p.status !== "pending" || (!open && !p.setupOk) || !p.newAccountId || !b?.credential) {
      return problem(400, "invalid_request", "That pairing has expired. Run things3pp connect again.");
    }
    const verified = await verifyRegistration(env, request, b.credential, "register");
    if (!verified || verified.accountId !== p.newAccountId) return problem(400, "passkey_failed", "Couldn't verify the passkey. Try again.");
    if (!open && !(await dir.claimOwner(verified.accountId))) return problem(409, "already_set_up", "This Things is already set up. Sign in instead.");
    const acc = account(env, verified.accountId);
    await acc.addCredential(verified.credential);
    const deviceId = `dev_${randomToken(12)}`;
    await acc.addDevice({ id: deviceId, publicKey: p.publicKey, name: p.deviceName });
    await dir.approvePairing(code, verified.accountId, deviceId);
    return withCookie(json({ ok: true }), await startSession(env, request, verified.accountId));
  }

  if (path === "/api/pair/approve" && method === "POST") {
    if (!sameOrigin(request)) return problem(403, "forbidden", "Cross-site request blocked.");
    const session = await currentAccount(env, request);
    if (!session) return problem(401, "signed_out", "Sign in first.");
    const b = await body<{ code?: string }>(request);
    const code = b?.code ? normalizeCode(b.code) : "";
    const p = code ? await dir.getPairing(code) : null;
    if (!p || p.status !== "pending") return problem(404, "not_found", "That code has expired. Run things3pp connect again.");
    const acc = account(env, session.accountId);
    const deviceId = `dev_${randomToken(12)}`;
    await acc.addDevice({ id: deviceId, publicKey: p.publicKey, name: p.deviceName });
    await dir.approvePairing(code, session.accountId, deviceId);
    return json({ ok: true });
  }

  // ----- passkey sign-in -----

  if (path === "/api/auth/options" && method === "POST") {
    if (!sameOrigin(request)) return problem(403, "forbidden", "Cross-site request blocked.");
    return json(await authenticationOptions(env, request, "login"));
  }

  if (path === "/api/auth/verify" && method === "POST") {
    if (!sameOrigin(request)) return problem(403, "forbidden", "Cross-site request blocked.");
    const b = await body<{ credential?: AuthenticationResponseJSON }>(request);
    const accountId = b?.credential ? await verifyAuthentication(env, request, b.credential, "login") : null;
    if (!accountId) return problem(401, "passkey_failed", "That passkey didn't work here. Try again, or use a passkey you created for this Things.");
    return withCookie(json({ ok: true }), await startSession(env, request, accountId));
  }

  if (path === "/api/auth/logout" && method === "POST") {
    if (!sameOrigin(request)) return problem(403, "forbidden", "Cross-site request blocked.");
    const session = await currentAccount(env, request);
    if (session) await account(env, session.accountId).endSession(session.token);
    return withCookie(json({ ok: true }), clearSessionCookie());
  }

  // ----- everything below needs a session -----

  const session = await currentAccount(env, request);
  if (!session) return problem(401, "signed_out", "Sign in first.");
  const acc = account(env, session.accountId);

  if (path === "/api/live" && method === "GET") {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return problem(426, "upgrade_required", "Expected a WebSocket.");
    const origin = request.headers.get("origin");
    if (origin && origin !== new URL(request.url).origin) return problem(403, "forbidden", "Cross-site WebSocket blocked.");
    return acc.fetch(new Request(new URL("/live", request.url), request));
  }

  if (path === "/api/action" && method === "POST") {
    if (!sameOrigin(request)) return problem(403, "forbidden", "Cross-site request blocked.");
    const b = await body<{ action?: unknown }>(request);
    const result = (await acc.call(b?.action)) as ActionResult;
    return json(result, result.ok ? 200 : result.code === "invalid" ? 400 : 502);
  }

  if (path === "/api/devices/remove" && method === "POST") {
    if (!sameOrigin(request)) return problem(403, "forbidden", "Cross-site request blocked.");
    const b = await body<{ id?: string }>(request);
    if (!b?.id) return problem(400, "invalid_request", "Send the device id.");
    await acc.removeDevice(b.id);
    return json({ ok: true });
  }

  if (path === "/api/passkeys/options" && method === "POST") {
    if (!sameOrigin(request)) return problem(403, "forbidden", "Cross-site request blocked.");
    return json(await registrationOptions(env, request, session.accountId, "add-passkey", await acc.credentialIds()));
  }

  if (path === "/api/passkeys/add" && method === "POST") {
    if (!sameOrigin(request)) return problem(403, "forbidden", "Cross-site request blocked.");
    const b = await body<{ credential?: RegistrationResponseJSON }>(request);
    const verified = b?.credential ? await verifyRegistration(env, request, b.credential, "add-passkey") : null;
    if (!verified || verified.accountId !== session.accountId) return problem(400, "passkey_failed", "Couldn't verify the passkey. Try again.");
    await acc.addCredential(verified.credential);
    return json({ ok: true });
  }

  return problem(404, "not_found", "No such endpoint.");
}

// ----- MCP consent (GET/POST /authorize) -----

async function authorize(request: Request, env: Env): Promise<Response> {
  const oauth: OAuthHelpers = env.OAUTH_PROVIDER;
  try {
    if (request.method === "GET") {
      const authReq = await oauth.parseAuthRequest(request);
      const details = await oauth.describeConsent(authReq);
      const consent = await oauth.beginConsent(authReq);
      // Render the web app; it shows the consent sheet from this embedded (escaped) JSON.
      const page = await env.ASSETS.fetch(new Request(new URL("/", request.url)));
      const html = (await page.text()).replace(
        "</head>",
        () =>
          `<script type="application/json" id="consent-data">${JSON.stringify({
            handle: consent.handle,
            clientName: details.clientName,
            clientDomain: details.clientDomain ?? null,
            redirectHost: details.redirectHost,
            redirectIsLoopback: details.redirectIsLoopback,
          }).replace(/</g, "\\u003c")}</script></head>`,
      );
      consent.headers.set("content-type", "text/html; charset=utf-8");
      consent.headers.set("cache-control", "no-store");
      return new Response(html, { headers: consent.headers });
    }

    if (request.method === "POST") {
      if (!sameOrigin(request)) return problem(403, "forbidden", "Cross-site request blocked.");
      const b = await body<{ handle?: string; decision?: string; credential?: AuthenticationResponseJSON }>(request);
      if (!b?.handle) return problem(400, "invalid_request", "Missing handle.");
      if (b.decision !== "approve") {
        const denied = await oauth.denyConsent(request, b.handle);
        return json({ redirectTo: denied.headers.get("location") }, 200, denied.headers);
      }
      // Approving needs a passkey tap: that's both the sign-in and the consent.
      const accountId = b.credential ? await verifyAuthentication(env, request, b.credential, "consent") : null;
      if (!accountId) return problem(401, "passkey_failed", "That passkey didn't work here. Try again.");
      const approved = await oauth.approveConsent(request, b.handle, { scope: [SCOPE] });
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: accountId,
        metadata: { label: "MCP" },
        scope: [SCOPE],
        props: { accountId } satisfies McpProps,
      });
      const headers = new Headers(approved.headers);
      headers.delete("location");
      return json({ redirectTo }, 200, headers);
    }
    return new Response("Method not allowed", { status: 405 });
  } catch (error) {
    if (error instanceof AuthorizationError && error.redirectTo) {
      if (request.method === "GET") return Response.redirect(error.redirectTo, 302);
      return json({ redirectTo: error.redirectTo });
    }
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      const message = error instanceof AuthorizationError ? error.description : "This app could not be verified.";
      return problem(400, "authorization_failed", message ?? "This sign-in link is invalid or expired. Start again from the app.");
    }
    throw error;
  }
}

// ----- everything that isn't MCP -----

const app = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/authorize") return authorize(request, env);

    if (path === "/api/authorize/options" && request.method === "POST") {
      if (!sameOrigin(request)) return problem(403, "forbidden", "Cross-site request blocked.");
      return json(await authenticationOptions(env, request, "consent"));
    }

    if (path.startsWith("/api/")) return api(request, env, path);

    // The Mac's relay connection. It proves itself inside the socket (signed challenge).
    if (path === "/device/connect") {
      const accountId = url.searchParams.get("account") ?? "";
      if (!/^acc_[A-Za-z0-9_-]{8,40}$/.test(accountId)) return problem(400, "invalid_request", "Missing account.");
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return problem(426, "upgrade_required", "Expected a WebSocket.");
      return account(env, accountId).fetch(new Request(new URL("/device/connect", request.url), request));
    }

    return env.ASSETS.fetch(request);
  },
};

// The public URL isn't known at build time (each person deploys to their own workers.dev name),
// so the provider is built per origin. Cloudflare only routes this Worker's own hostnames here.
const providers = new Map<string, OAuthProvider<Env>>();
function providerFor(origin: string): OAuthProvider<Env> {
  let p = providers.get(origin);
  if (!p) {
    p = new OAuthProvider<Env>({
      apiRoute: "/mcp",
      apiHandler: mcpApi as never,
      defaultHandler: app as never,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",
      scopesSupported: [SCOPE],
      requiredScopes: [SCOPE],
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin] },
      clientIdMetadataDocumentEnabled: true,
      accessTokenTTL: 3600,
      refreshTokenTTL: 90 * 24 * 3600,
    });
    providers.set(origin, p);
  }
  return p;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return providerFor(new URL(request.url).origin).fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
