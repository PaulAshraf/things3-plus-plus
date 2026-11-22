import { defineConfig } from "cf/config";

// The landing page: static assets only, no Worker code. `pnpm --filter things3pp-site deploy`.
export default defineConfig({
  worker: {
    name: "things3pp-site",
    compatibilityDate: "2026-10-23",
    workersDev: true,
    // workers.dev isn't reachable from some networks; serve it on a custom domain too.
    domains: ["things3pp.paulashraf.com"],
    assets: { notFoundHandling: "404-page", htmlHandling: "auto-trailing-slash" },
    observability: { enabled: true },
  },
});
