import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "things3pp-core/mcp/server";
import { ThingsClient } from "things3pp-core/things/client";
import { VERSION } from "./version.js";

let viewHtmlCache: string | undefined;
/** The bundled MCP App view: dist/ui/view.html, or core/dist/view.html when running from source (tests). */
export function viewHtml(): string {
  if (viewHtmlCache === undefined) {
    const candidates = ["./ui/view.html", "../ui/view.html", "../../core/dist/view.html"].map((p) => fileURLToPath(new URL(p, import.meta.url)));
    const path = candidates.find((c) => existsSync(c));
    viewHtmlCache = path ? readFileSync(path, "utf8") : "<!doctype html><p>things3pp view is missing. Reinstall things3pp.</p>";
  }
  return viewHtmlCache;
}

/** An MCP server that talks to Things on this Mac. */
export function createLocalServer(things: ThingsClient = new ThingsClient()) {
  return createServer({ things, viewHtml, version: VERSION });
}
