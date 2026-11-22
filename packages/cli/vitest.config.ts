import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: [
      ...(process.env.THINGS_LIVE === "1" ? [] : ["test/live.test.ts"]),
      ...(process.env.THINGS_E2E === "1" ? [] : ["test/e2e/**"]),
    ],
    testTimeout: 20_000,
  },
});
