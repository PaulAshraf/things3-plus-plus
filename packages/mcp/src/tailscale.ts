import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";

export interface TailscaleInfo {
  /** This Mac's Tailscale IPv4, e.g. 100.101.102.103. */
  ip: string;
  /** MagicDNS name without the trailing dot, e.g. my-mac.tail1234.ts.net (if MagicDNS is on). */
  dnsName: string | null;
}

const CLI_CANDIDATES = [
  "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  "/usr/local/bin/tailscale",
  "/opt/homebrew/bin/tailscale",
];

/** 100.64.0.0/10 — the CGNAT range Tailscale assigns from. */
export function isTailscaleIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 100 && parts[1]! >= 64 && parts[1]! <= 127;
}

function runCli(cli: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cli, ["status", "--json"], { timeout: 5000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) =>
      resolve(err ? null : stdout),
    );
  });
}

export async function detectTailscale(): Promise<TailscaleInfo | null> {
  for (const cli of CLI_CANDIDATES) {
    if (!existsSync(cli)) continue;
    const out = await runCli(cli);
    if (!out) continue;
    try {
      const status = JSON.parse(out) as {
        BackendState?: string;
        Self?: { TailscaleIPs?: string[]; DNSName?: string };
      };
      if (status.BackendState !== "Running") return null;
      const ip = status.Self?.TailscaleIPs?.find(isTailscaleIPv4);
      if (!ip) continue;
      const dnsName = status.Self?.DNSName?.replace(/\.$/, "") || null;
      return { ip, dnsName };
    } catch {
      continue;
    }
  }
  // No CLI: fall back to finding a Tailscale address on a local interface.
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal && isTailscaleIPv4(a.address)) return { ip: a.address, dnsName: null };
    }
  }
  return null;
}
