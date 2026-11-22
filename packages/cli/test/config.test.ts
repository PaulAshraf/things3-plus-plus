import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadOrCreateToken, rotateToken, tokenPath } from "../src/config.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "things3pp-"));
  process.env.THINGS3PP_CONFIG_DIR = join(dir, "cfg");
});
afterEach(() => {
  delete process.env.THINGS3PP_CONFIG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe("token storage", () => {
  it("creates a strong token readable only by the owner, and reuses it", () => {
    const first = loadOrCreateToken();
    expect(first.created).toBe(true);
    expect(first.token).toMatch(/^t3pp_[A-Za-z0-9_-]{43}$/);
    expect(statSync(tokenPath()).mode & 0o777).toBe(0o600);
    expect(statSync(process.env.THINGS3PP_CONFIG_DIR!).mode & 0o777).toBe(0o700);
    expect(loadOrCreateToken()).toEqual({ token: first.token, created: false });
  });

  it("rotates", () => {
    const a = loadOrCreateToken().token;
    const b = rotateToken();
    expect(b).not.toBe(a);
    expect(loadOrCreateToken().token).toBe(b);
  });

  it("refuses a token file other users can read", () => {
    loadOrCreateToken();
    chmodSync(tokenPath(), 0o644);
    expect(() => loadOrCreateToken()).toThrow(/chmod 600/);
  });
});
