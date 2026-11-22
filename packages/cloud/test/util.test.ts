import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { challengeText } from "things3pp-core/relay/protocol";
import { b64url, escapeHtml, fromB64url, normalizeCode, pairingCode, safeEqual, verifyEd25519 } from "../src/worker/util.ts";

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
