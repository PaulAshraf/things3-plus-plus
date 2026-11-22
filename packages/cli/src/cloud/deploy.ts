// `things3pp cloud deploy`: put your own hosted Things on your Cloudflare account, using the
// Cloudflare CLI (`cf`). Ships a prebuilt Worker inside this package, so nothing is built here.
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { configDir } from "../config.js";
import { c, fail, info, ok, warn } from "../cli/ui.js";
import { loadCloudConfig, saveCloudConfig } from "./config.js";

function bundledBuild(): string | null {
  for (const rel of ["./cloud/output", "../cloud/output"]) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(join(p, "v1", "config.json"))) return p;
  }
  return null;
}

function which(cmd: string): Promise<string | null> {
  return new Promise((resolve) => execFile("/usr/bin/which", [cmd], (err, out) => resolve(err ? null : out.trim() || null)));
}

function capture(cmd: string, args: string[], cwd?: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: 180_000 }, (err, stdout, stderr) =>
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: `${stdout}${stderr}` }),
    );
  });
}

/** Runs cf with output streamed to the terminal, and returns it too. */
function stream(cmd: string, args: string[], cwd: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["inherit", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d;
      process.stdout.write(d);
    });
    child.stderr.on("data", (d: Buffer) => {
      out += d;
      process.stderr.write(d);
    });
    child.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

const HOST_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export async function deploy(opts: { domain?: string } = {}): Promise<number> {
  const build = bundledBuild();
  if (!build) {
    fail("This copy of things3pp doesn't include the hosted app. Reinstall it with: npm install -g things3pp");
    return 1;
  }

  // Run the cf version that built this Worker (via npx); an installed cf is only used if it's that version.
  const wanted = (() => {
    try {
      return readFileSync(join(dirname(build), "cf-version.txt"), "utf8").trim();
    } catch {
      return null;
    }
  })();
  const installed = await which("cf");
  const installedVersion = installed ? (await capture(installed, ["--version"])).out.trim() : null;
  const npx = join(dirname(process.execPath), "npx");
  let cf: string;
  let cfArgs: string[] = [];
  if (installed && (!wanted || installedVersion === wanted)) cf = installed;
  else if (wanted && existsSync(npx)) {
    cf = npx;
    cfArgs = ["-y", `cf@${wanted}`];
    info(`Using cf ${wanted} (the version this Worker was built with)${installedVersion ? `; you have ${installedVersion}` : ""}.`);
  } else {
    fail("The Cloudflare CLI (cf) isn't installed.");
    console.log(`  Install it with ${c.cyan(`npm install -g cf${wanted ? `@${wanted}` : ""}`)}, sign in with ${c.cyan("cf auth login")}, then run this again.`);
    return 1;
  }
  const who = await capture(cf, [...cfArgs, "auth", "whoami"]);
  if (!/"authenticated":\s*true/.test(who.out)) {
    fail(`You're not signed in to Cloudflare. Run ${c.cyan("cf auth login")}, then try again.`);
    return 1;
  }
  ok("Cloudflare CLI ready");

  // A clean project folder holding only the prebuilt output.
  const project = join(configDir(), "cloud-deploy");
  rmSync(project, { recursive: true, force: true });
  mkdirSync(join(project, ".cloudflare"), { recursive: true, mode: 0o700 });
  cpSync(build, join(project, ".cloudflare", "output"), { recursive: true });
  writeFileSync(join(project, "package.json"), `${JSON.stringify({ name: "things3pp-cloud-deploy", private: true, type: "module" }, null, 2)}\n`);

  const cfg = loadCloudConfig();
  // A custom domain (on a zone in your Cloudflare account) also works on networks that block workers.dev.
  const domain = (opts.domain ?? cfg.domain)?.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (domain && !HOST_RE.test(domain)) {
    fail(`"${domain}" isn't a valid hostname. Use something like things.example.com.`);
    return 1;
  }
  if (domain) {
    const workerConfig = join(project, ".cloudflare", "output", "v1", "workers", "default", "worker.config.json");
    const wc = JSON.parse(readFileSync(workerConfig, "utf8")) as { domains?: string[] };
    wc.domains = [domain];
    writeFileSync(workerConfig, `${JSON.stringify(wc, null, 1)}\n`);
    info(`Also serving it at https://${domain}`);
  }
  const alreadyOwned = Boolean(cfg.device?.deviceId);
  const setupKey = cfg.setupKey ?? `t3pp_setup_${randomBytes(24).toString("base64url")}`;
  const secretsFile = join(project, ".secrets.json");
  writeFileSync(secretsFile, JSON.stringify({ SETUP_KEY: setupKey }), { mode: 0o600 });
  chmodSync(secretsFile, 0o600);

  info("Deploying with cf (this takes a minute the first time)…\n");
  let res: { code: number; out: string };
  try {
    res = await stream(cf, [...cfArgs, "deploy", "--prebuilt", "--mode", "production", "--secrets-file", secretsFile, "--message", "things3pp cloud deploy"], project);
  } finally {
    rmSync(secretsFile, { force: true });
  }
  if (res.code !== 0) {
    fail("cf deploy failed. The output above says why.");
    return 1;
  }

  const url = domain ? `https://${domain}` : /https:\/\/[a-z0-9.-]+\.workers\.dev/i.exec(res.out)?.[0];
  const fresh = loadCloudConfig();
  if (!alreadyOwned) fresh.setupKey = setupKey;
  if (domain) fresh.domain = domain;
  // Moving to a new address: the passkey is bound to the hostname, and the Mac's link stays valid.
  if (url) fresh.url = url;
  saveCloudConfig(fresh);

  console.log("");
  ok(`Deployed${url ? ` to ${c.cyan(url)}` : ""}`);
  if (!url) warn("I couldn't spot the web address in cf's output. Pass it to connect: things3pp connect https://…workers.dev");
  if (alreadyOwned) console.log(`\n  This Mac is already linked. Your hosted Things is updated.\n`);
  else console.log(`\n  Next: link this Mac and create your passkey with ${c.cyan("things3pp connect")}\n`);
  return 0;
}
