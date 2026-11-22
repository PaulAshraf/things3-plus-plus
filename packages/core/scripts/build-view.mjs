// Bundles the MCP App view (src/mcp/ui) into one self-contained HTML file at dist/view.html.
// The CLI and the hosted Worker both ship this file.
import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = join(dirname(fileURLToPath(import.meta.url)), "..");
const result = await build({
  entryPoints: [join(pkg, "src/mcp/ui/view.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  minify: true,
  legalComments: "none",
  write: false,
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const template = await readFile(join(pkg, "src/mcp/ui/view.html"), "utf8");
if (!template.includes("<!--SCRIPT-->")) throw new Error("view.html is missing the <!--SCRIPT--> marker");
await mkdir(join(pkg, "dist"), { recursive: true });
await writeFile(join(pkg, "dist/view.html"), template.replace("<!--SCRIPT-->", () => `<script type="module">${js}</script>`));
console.log(`built core/dist/view.html (${Math.round((template.length + js.length) / 1024)} KB)`);
