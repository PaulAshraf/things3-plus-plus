import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [cloudflare()],
  // Preact's automatic JSX runtime for the web app (also set in tsconfig.base.json).
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  resolve: { dedupe: ["preact"] },
  // Pre-bundle everything up front so dev never ends up with two copies of preact.
  optimizeDeps: { include: ["preact", "preact/hooks", "preact/jsx-runtime", "preact/jsx-dev-runtime", "@simplewebauthn/browser", "zod"] },
  build: { target: "es2022" },
});
