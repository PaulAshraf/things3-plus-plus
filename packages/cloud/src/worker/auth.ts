// Passkeys (WebAuthn) and browser sessions.

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { ChallengePurpose } from "./directory.ts";
import type { Env } from "./env.ts";
import { b64url, fromB64url } from "./util.ts";

const RP_NAME = "Things (things3pp)";
export const SESSION_COOKIE = "__Host-t3pp";

export function directory(env: Env) {
  return env.DIRECTORY.getByName("main");
}
export function account(env: Env, accountId: string) {
  return env.ACCOUNT.getByName(accountId);
}

function rp(request: Request) {
  const url = new URL(request.url);
  return { rpID: url.hostname, origin: url.origin };
}

/** The challenge the browser signed, read from the response's clientDataJSON. */
function signedChallenge(response: { response: { clientDataJSON: string } }): string | null {
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64url(response.response.clientDataJSON))) as { challenge?: string };
    return typeof data.challenge === "string" ? data.challenge : null;
  } catch {
    return null;
  }
}

export async function registrationOptions(env: Env, request: Request, accountId: string, purpose: ChallengePurpose, exclude: string[] = []) {
  const challenge = await directory(env).createChallenge(purpose, accountId);
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp(request).rpID,
    userName: "Things",
    userDisplayName: "Things",
    userID: new Uint8Array(new TextEncoder().encode(accountId)),
    challenge: fromB64url(challenge),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
    excludeCredentials: exclude.map((id) => ({ id })),
  });
}

/** Verifies a new passkey. Returns the account it was created for and the credential to store. */
export async function verifyRegistration(env: Env, request: Request, response: RegistrationResponseJSON, purpose: ChallengePurpose) {
  const challenge = signedChallenge(response);
  if (!challenge) return null;
  const accountId = await directory(env).consumeChallenge(challenge, purpose);
  if (!accountId) return null;
  const { rpID, origin } = rp(request);
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
  if (!result.verified || !result.registrationInfo) return null;
  const { credential } = result.registrationInfo;
  return {
    accountId,
    credential: {
      id: credential.id,
      publicKey: b64url(credential.publicKey),
      counter: credential.counter,
      transports: (credential.transports ?? []) as string[],
      name: passkeyName(request),
    },
  };
}

function passkeyName(request: Request): string {
  const ua = request.headers.get("user-agent") ?? "";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Mac OS X/.test(ua) ? "Mac" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : "Passkey";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return browser ? `${browser} on ${os}` : os;
}

export async function authenticationOptions(env: Env, request: Request, purpose: ChallengePurpose) {
  const challenge = await directory(env).createChallenge(purpose, null);
  return generateAuthenticationOptions({
    rpID: rp(request).rpID,
    challenge: fromB64url(challenge),
    userVerification: "preferred",
  });
}

/** Verifies a passkey sign-in. Returns the account id, or null. */
export async function verifyAuthentication(env: Env, request: Request, response: AuthenticationResponseJSON, purpose: ChallengePurpose): Promise<string | null> {
  const challenge = signedChallenge(response);
  if (!challenge) return null;
  if ((await directory(env).consumeChallenge(challenge, purpose)) === null) return null;
  // Discoverable credentials carry the account id as the WebAuthn user handle.
  const userHandle = response.response.userHandle;
  let accountId: string | null = null;
  if (userHandle) {
    try {
      accountId = new TextDecoder().decode(fromB64url(userHandle));
    } catch {
      accountId = null;
    }
  }
  accountId ??= await directory(env).ownerAccountId();
  if (!accountId || !/^acc_[A-Za-z0-9_-]{8,40}$/.test(accountId)) return null;
  const acc = account(env, accountId);
  const stored = await acc.credential(response.id);
  if (!stored) return null;
  const { rpID, origin } = rp(request);
  const result = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: stored.id,
      publicKey: fromB64url(stored.publicKey),
      counter: stored.counter,
      transports: stored.transports as AuthenticatorTransport[],
    },
  });
  if (!result.verified) return null;
  await acc.touchCredential(stored.id, result.authenticationInfo.newCounter);
  return accountId;
}

// ----- session cookie -----

export function sessionCookie(accountId: string, token: string, expiresAt: number): string {
  return `${SESSION_COOKIE}=${accountId}.${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function readCookie(request: Request): { accountId: string; token: string } | null {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq) !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1);
    const dot = value.indexOf(".");
    if (dot < 0) return null;
    const accountId = value.slice(0, dot);
    const token = value.slice(dot + 1);
    if (!/^acc_[A-Za-z0-9_-]{8,40}$/.test(accountId) || token.length < 20) return null;
    return { accountId, token };
  }
  return null;
}

/** The signed-in account for this request, or null. */
export async function currentAccount(env: Env, request: Request): Promise<{ accountId: string; token: string } | null> {
  const c = readCookie(request);
  if (!c) return null;
  return (await account(env, c.accountId).checkSession(c.token)) ? c : null;
}

export async function startSession(env: Env, request: Request, accountId: string): Promise<string> {
  const { token, expiresAt } = await account(env, accountId).createSession(request.headers.get("user-agent"));
  return sessionCookie(accountId, token, expiresAt);
}
