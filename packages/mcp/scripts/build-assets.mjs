// Copies the osascript bridges and bundles the inline UI into one self-contained HTML file.
import { build } from "esbuild";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(pkg, "dist");

await mkdir(join(dist, "things"), { recursive: true });
for (const f of ["things.jxa.js", "move.applescript"]) await copyFile(join(pkg, "src/things", f), join(dist, "things", f));

const result = await build({
  entryPoints: [join(pkg, "src/ui/view.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  write: false,
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const template = await readFile(join(pkg, "src/ui/view.html"), "utf8");
if (!template.includes("<!--SCRIPT-->")) throw new Error("view.html is missing the <!--SCRIPT--> marker");
await mkdir(join(dist, "ui"), { recursive: true });
await writeFile(join(dist, "ui/view.html"), template.replace("<!--SCRIPT-->", () => `<script type="module">${js}</script>`));
await (await import("node:fs/promises")).chmod(join(dist, "index.js"), 0o755).catch(() => {});
console.log(`built ui/view.html (${Math.round((template.length + js.length) / 1024)} KB)`);
