// Bundles the CLI (with things3pp-core inlined) into dist/, and copies the files it reads at runtime:
// the osascript bridges, the MCP App view, and (when built) the hosted Worker for `things3pp cloud deploy`.
import { build } from "esbuild";
import { chmod, copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const core = join(pkg, "../core");
const cloud = join(pkg, "../cloud");
const dist = join(pkg, "dist");
const manifest = JSON.parse(await readFile(join(pkg, "package.json"), "utf8"));

await rm(dist, { recursive: true, force: true });
await build({
  entryPoints: [join(pkg, "src/index.ts")],
  outdir: dist,
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "node",
  target: "node20",
  sourcemap: true,
  // Runtime dependencies stay in node_modules; workspace code (things3pp-core) is bundled.
  external: Object.keys(manifest.dependencies ?? {}),
  chunkNames: "chunks/[name]-[hash]",
  define: { __THINGS3PP_VERSION__: JSON.stringify(manifest.version) },
  logLevel: "warning",
});

await mkdir(join(dist, "things"), { recursive: true });
for (const f of ["things.jxa.js", "move.applescript"]) await copyFile(join(core, "src/things", f), join(dist, "things", f));
// Chunks live in dist/chunks/, so modules there look for ./things/ next to themselves too.
await cp(join(dist, "things"), join(dist, "chunks/things"), { recursive: true });

const view = join(core, "dist/view.html");
if (!existsSync(view)) throw new Error("core/dist/view.html is missing. Run `pnpm build` from the repo root.");
await mkdir(join(dist, "ui"), { recursive: true });
await copyFile(view, join(dist, "ui/view.html"));

const cloudBuild = join(cloud, "dist");
// Source maps would double the package size; the deployed Worker doesn't need them.
if (existsSync(cloudBuild)) {
  await cp(cloudBuild, join(dist, "cloud"), { recursive: true, filter: (src) => !src.endsWith(".map") });
  // Deploy with the same cf version that produced the build: the Build Output format changes between releases.
  const cfVersion = JSON.parse(await readFile(join(cloud, "node_modules/cf/package.json"), "utf8")).version;
  await writeFile(join(dist, "cloud", "cf-version.txt"), `${cfVersion}\n`);
}

await chmod(join(dist, "index.js"), 0o755);
console.log("built things3pp CLI");
