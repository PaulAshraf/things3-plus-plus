import { defineConfig } from "vitest/config";

// Unit tests run in Node (pure helpers). The Worker itself is exercised end to end with `cf dev`.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
