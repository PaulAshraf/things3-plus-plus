// Sign in, first-time setup (pairing + passkey), approving another Mac, and MCP consent.
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { useEffect, useState } from "preact/hooks";
import { AppIcon, IconKey, IconLaptop } from "../icons.tsx";
import { api, loadState, navigate, state } from "../store.ts";

function passkeyError(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError") return "The passkey prompt was cancelled. Try again when you're ready.";
  if (name === "InvalidStateError") return "This device already has a passkey for this Things.";
  return e instanceof Error ? e.message : "Something went wrong. Try again.";
}

const supportsPasskeys = () => typeof window.PublicKeyCredential !== "undefined";

// ---------- sign in ----------

export function SignIn({ setUp, shared }: { setUp: boolean; shared?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await api<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/auth/options", {});
      const credential = await startAuthentication({ optionsJSON });
      await api("/api/auth/verify", { credential });
      await loadState();
      if (state.route.kind === "home") navigate({ kind: "list", list: "today" }, { replace: true });
    } catch (e) {
      setError(passkeyError(e));
    } finally {
      setBusy(false);
    }
  };
  if (!setUp) {
    return (
      <div class="sheet-wrap">
        <div class="sheet">
          <AppIcon />
          <h1>Welcome to your Things</h1>
          <p>This is your own hosted Things. To finish setting it up, run this on the Mac that has Things:</p>
          <div class="code" style={{ fontSize: "17px", letterSpacing: 0, userSelect: "all" }}>
            things3pp connect
          </div>
          <p class="fine">It shows a code and opens this page so you can create your passkey.</p>
        </div>
      </div>
    );
  }
  return (
    <div class="sheet-wrap">
      <div class="sheet">
        <AppIcon />
        <h1>Things</h1>
        <p>Sign in with your passkey to see your to-dos.</p>
        {error && <p class="error-text">{error}</p>}
        <button class="btn" disabled={busy || !supportsPasskeys()} onClick={signIn}>
          <IconKey /> {busy ? "Waiting for passkey…" : "Sign in with passkey"}
        </button>
        {!supportsPasskeys() && <p class="fine">This browser doesn't support passkeys. Try Safari, Chrome, Edge or Firefox.</p>}
        {shared ? (
          <p class="fine">
            New here? Install the things3pp app on the Mac that has Things, and choose <b>Sign in</b>. It creates your account and passkey.
          </p>
        ) : (
          <p class="fine">Lost your passkeys? Run <b>things3pp connect</b> on your Mac to add a new one.</p>
        )}
      </div>
    </div>
  );
}

// ---------- pairing (from `things3pp connect`) ----------

interface PairInfo {
  deviceName: string;
  expiresAt: number;
  canCreateAccount: boolean;
  canAddPasskey: boolean;
  needsSignIn: boolean;
  signedIn: boolean;
  setUp: boolean;
}

export function Pair({ code: initialCode }: { code: string }) {
  const [code, setCode] = useState(initialCode);
  const [info, setInfo] = useState<PairInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const lookup = async (c: string) => {
    setError(null);
    try {
      setInfo(await api<PairInfo>("/api/pair/info", { code: c }));
    } catch (e) {
      setInfo(null);
      setError(e instanceof Error ? e.message : "That code didn't work.");
    }
  };
  useEffect(() => {
    if (initialCode) void lookup(initialCode);
  }, []);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const optionsJSON = await api<Parameters<typeof startRegistration>[0]["optionsJSON"]>("/api/pair/register-options", { code });
      const credential = await startRegistration({ optionsJSON });
      await api("/api/pair/complete", { code, credential });
      setDone(true);
    } catch (e) {
      setError(passkeyError(e));
    } finally {
      setBusy(false);
    }
  };
  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!info?.signedIn) {
        const optionsJSON = await api<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/auth/options", {});
        const credential = await startAuthentication({ optionsJSON });
        await api("/api/auth/verify", { credential });
      }
      await api("/api/pair/approve", { code });
      setDone(true);
    } catch (e) {
      setError(passkeyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div class="sheet-wrap">
        <div class="sheet">
          <AppIcon />
          <h1>You're all set</h1>
          <p>Your Mac is linked. Back in Terminal, run <b>things3pp agent install</b> to keep it connected.</p>
          <button
            class="btn"
            onClick={async () => {
              await loadState();
              navigate({ kind: "list", list: "today" }, { replace: true });
            }}
          >
            Open Things
          </button>
        </div>
      </div>
    );
  }

  return (
    <div class="sheet-wrap">
      <div class="sheet">
        <IconLaptop class="app-icon" style={{ color: "var(--blue)", filter: "none" }} />
        <h1>{info?.canAddPasskey ? "Add a passkey" : "Link a Mac"}</h1>
        {!info && (
          <>
            <p>Enter the code that <b>things3pp connect</b> shows in Terminal.</p>
            <input
              class="code-input"
              value={code}
              placeholder="XXXX-XXXX"
              maxLength={9}
              autoFocus
              onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && lookup(code)}
            />
            {error && <p class="error-text">{error}</p>}
            <button class="btn" onClick={() => lookup(code)} disabled={code.replace(/[^A-Z0-9]/gi, "").length < 8}>
              Continue
            </button>
          </>
        )}
        {info && (
          <>
            <p>
              <b>{info.deviceName}</b> wants to connect. Check this code matches the one in Terminal:
            </p>
            <div class="code">{code}</div>
            {error && <p class="error-text">{error}</p>}
            {info.canAddPasskey ? (
              <>
                <p>Your linked Mac asked to add a passkey here, for when you've lost access to your old ones.</p>
                <button class="btn" disabled={busy || !supportsPasskeys()} onClick={create}>
                  <IconKey /> {busy ? "Waiting for passkey…" : "Create a new passkey"}
                </button>
              </>
            ) : info.canCreateAccount ? (
              <>
                <p>You'll create a passkey for this Things. It's saved in your password manager (like iCloud Keychain) and replaces passwords.</p>
                <button class="btn" disabled={busy || !supportsPasskeys()} onClick={create}>
                  <IconKey /> {busy ? "Waiting for passkey…" : "Create passkey & link Mac"}
                </button>
              </>
            ) : !info.setUp ? (
              <div class="warn-box">
                This Things isn't set up yet, and this pairing can't set it up. Run <b>things3pp cloud deploy</b> and then <b>things3pp connect</b> on the same Mac.
              </div>
            ) : (
              <button class="btn" disabled={busy} onClick={approve}>
                <IconKey /> {busy ? "Waiting…" : info.signedIn ? "Link this Mac" : "Sign in with passkey to link"}
              </button>
            )}
            <p class="fine">Didn't run things3pp connect yourself? Close this page.</p>
          </>
        )}
      </div>
    </div>
  );
}

// ---------- MCP consent (/authorize) ----------

export interface ConsentData {
  handle: string;
  clientName: string;
  clientDomain: string | null;
  redirectHost: string;
  redirectIsLoopback: boolean;
}

export function readConsent(): ConsentData | null {
  const el = document.getElementById("consent-data");
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as ConsentData;
  } catch {
    return null;
  }
}

export function Consent({ data }: { data: ConsentData }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decide = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    try {
      let credential: unknown;
      if (approve) {
        const optionsJSON = await api<Parameters<typeof startAuthentication>[0]["optionsJSON"]>("/api/authorize/options", {});
        credential = await startAuthentication({ optionsJSON });
      }
      const res = await api<{ redirectTo: string }>("/authorize", { handle: data.handle, decision: approve ? "approve" : "deny", credential });
      location.href = res.redirectTo;
    } catch (e) {
      setError(passkeyError(e));
      setBusy(false);
    }
  };
  return (
    <div class="sheet-wrap">
      <div class="sheet">
        <AppIcon />
        <h1>Allow {data.clientName} to use your Things?</h1>
        <p>
          It will be able to read your to-dos, projects and areas, and add or change them. It can't delete anything.
        </p>
        <div class="settings-list" style={{ textAlign: "left" }}>
          <div class="settings-row">
            <div class="grow">
              <div class="sub">{data.clientDomain ? "Published by" : "App name (not verified)"}</div>
              <div>{data.clientDomain ?? data.clientName}</div>
            </div>
          </div>
          <div class="settings-row">
            <div class="grow">
              <div class="sub">Access will be sent to</div>
              <div>{data.redirectHost}</div>
            </div>
          </div>
        </div>
        {data.redirectIsLoopback && <div class="warn-box">This sends access to an app on your computer. Continue only if you just started connecting from it.</div>}
        {error && <p class="error-text">{error}</p>}
        <button class="btn" disabled={busy} onClick={() => decide(true)}>
          <IconKey /> {busy ? "Waiting for passkey…" : "Allow with passkey"}
        </button>
        <button class="btn secondary" disabled={busy} onClick={() => decide(false)}>
          Don't Allow
        </button>
      </div>
    </div>
  );
}
