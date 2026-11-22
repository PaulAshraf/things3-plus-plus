// `things3pp connect`: pair this Mac with your hosted Things.
import { execFile } from "node:child_process";
import { c, fail, info, ok, warn } from "../cli/ui.js";
import { recoverText } from "things3pp-core/relay/protocol";
import { ensureDeviceKey, loadCloudConfig, normalizeUrl, saveCloudConfig, signWithDevice } from "./config.js";

interface StartResponse {
  pairingId: string;
  code: string;
  pollToken: string;
  expiresAt: number;
  approveUrl: string;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message ?? `${url} answered ${res.status}`);
  return data;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function connect(opts: { url?: string; open: boolean }): Promise<number> {
  const cfg = loadCloudConfig();
  const raw = opts.url ?? cfg.url;
  if (!raw) {
    fail("I don't know where your hosted Things is yet.");
    console.log(`  Deploy it with ${c.cyan("things3pp cloud deploy")}, or pass its address: ${c.cyan("things3pp connect https://things3pp.you.workers.dev")}`);
    return 1;
  }
  const url = normalizeUrl(raw);
  if (cfg.url && cfg.url !== url && cfg.device) {
    // A different deployment: start over with a fresh device identity.
    delete cfg.device;
    delete cfg.setupKey;
  }
  cfg.url = url;
  const device = ensureDeviceKey(cfg);
  saveCloudConfig(cfg);

  // Already linked: this run adds a new passkey (e.g. you lost yours), proven with this Mac's key.
  const ts = Date.now();
  const recover =
    device.accountId && device.deviceId
      ? { accountId: device.accountId, deviceId: device.deviceId, ts, signature: signWithDevice(device, recoverText(device.deviceId, ts)) }
      : undefined;

  let started: StartResponse;
  try {
    started = await post<StartResponse>(`${url}/api/pair/start`, { publicKey: device.publicKey, deviceName: device.name, setupKey: cfg.setupKey, recover });
  } catch (e) {
    fail(`Couldn't reach ${url}: ${(e as Error).message}`);
    return 1;
  }

  console.log(`\n  ${c.bold(recover ? "Add a passkey to your hosted Things" : "Pair this Mac with your hosted Things")}\n`);
  console.log(`  Your code:  ${c.bold(c.cyan(started.code))}\n`);
  console.log(`  Open ${c.cyan(started.approveUrl)}`);
  console.log(`  and check the code matches. ${cfg.setupKey || recover ? "You'll create a passkey to finish." : "Sign in with your passkey to approve."}\n`);
  if (opts.open) execFile("/usr/bin/open", [started.approveUrl], () => {});

  info("Waiting for you to approve… (Ctrl+C to cancel)");
  while (Date.now() < started.expiresAt) {
    await sleep(2000);
    let res: { status: string; accountId?: string; deviceId?: string };
    try {
      res = await post(`${url}/api/pair/poll`, { pairingId: started.pairingId, pollToken: started.pollToken });
    } catch {
      continue; // flaky network; keep waiting
    }
    if (res.status === "approved" && res.accountId && res.deviceId) {
      const fresh = loadCloudConfig();
      fresh.device = { ...device, accountId: res.accountId, deviceId: res.deviceId };
      // The setup key has done its job once an owner exists.
      delete fresh.setupKey;
      saveCloudConfig(fresh);
      ok(`Paired! This Mac is now linked to ${url}`);
      console.log(`\n  Next: keep it connected in the background with ${c.cyan("things3pp agent install")}`);
      console.log(`  (or try it now in the foreground: ${c.cyan("things3pp agent run")})\n`);
      return 0;
    }
    if (res.status === "expired") break;
  }
  fail("The pairing code expired. Run things3pp connect again.");
  return 1;
}

export async function disconnect(): Promise<number> {
  const cfg = loadCloudConfig();
  if (!cfg.device?.deviceId) {
    info("This Mac isn't linked to a hosted Things.");
    return 0;
  }
  delete cfg.device;
  saveCloudConfig(cfg);
  ok("Unlinked this Mac. Its device key is deleted.");
  warn(`Also remove it from the list in Settings on ${cfg.url ?? "your hosted Things"}, and run "things3pp agent uninstall" if you installed the agent.`);
  return 0;
}
