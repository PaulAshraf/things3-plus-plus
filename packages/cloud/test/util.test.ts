import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { challengeText } from "things3pp-core/relay/protocol";
import { MAC_STALE_MS, b64url, escapeHtml, fromB64url, macHolder, normalizeCode, pairingCode, safeEqual, verifyEd25519 } from "../src/worker/util.ts";

describe("worker helpers", () => {
  it("makes readable pairing codes and normalizes typed ones", () => {
    const code = pairingCode();
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(normalizeCode("abcd efgh")).toBe("ABCD-EFGH");
    expect(normalizeCode(" ab-cd-ef-gh ")).toBe("ABCD-EFGH");
  });

  it("round-trips base64url", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(33));
    expect([...fromB64url(b64url(bytes))]).toEqual([...bytes]);
  });

  it("compares secrets in constant time", async () => {
    expect(await safeEqual("abc", "abc")).toBe(true);
    expect(await safeEqual("abc", "abd")).toBe(false);
    expect(await safeEqual("abc", "abcd")).toBe(false);
  });

  it("verifies the Mac's Ed25519 challenge signature", async () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const pub = (publicKey.export({ format: "jwk" }) as { x: string }).x;
    const text = challengeText("nonce123", "dev_abc");
    const sig = sign(null, Buffer.from(text), privateKey).toString("base64url");
    expect(await verifyEd25519(pub, sig, text)).toBe(true);
    expect(await verifyEd25519(pub, sig, challengeText("other", "dev_abc"))).toBe(false);
    expect(await verifyEd25519(pub, "garbage", text)).toBe(false);
  });

  it("escapes HTML", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe("&#60;a href=&#34;x&#34;&#62;&#38;&#39;");
  });
});

describe("one Mac connection per account", () => {
  const now = 1_000_000;
  const thingsMac = { deviceId: "dev_things", name: "Things Mac", problem: null, lastActive: now - 10_000 };

  it("lets the same Mac replace its own old socket", () => {
    expect(macHolder([thingsMac], "dev_things", now)).toBeNull();
  });

  it("keeps a healthy, active Mac connected when a different Mac shows up", () => {
    expect(macHolder([thingsMac], "dev_other", now)).toBe("Things Mac");
  });

  it("lets a different Mac take over from one that went quiet", () => {
    expect(macHolder([{ ...thingsMac, lastActive: now - MAC_STALE_MS - 1 }], "dev_other", now)).toBeNull();
  });

  it("lets a different Mac take over from one that reports a problem (e.g. no Things)", () => {
    expect(macHolder([{ ...thingsMac, problem: "Couldn't read Things" }], "dev_other", now)).toBeNull();
  });

  it("treats an empty problem report as a problem", () => {
    expect(macHolder([{ ...thingsMac, problem: "" }], "dev_other", now)).toBeNull();
  });

  it("takes over when nothing is connected", () => {
    expect(macHolder([], "dev_other", now)).toBeNull();
  });
});
