import { describe, expect, it } from "vitest";
import { isValidDay, localDay, resolveWhen } from "../src/when.js";

describe("resolveWhen", () => {
  const now = new Date(2026, 11, 31, 15, 0); // Dec 31 2026, local

  it("passes keywords through", () => {
    for (const k of ["today", "anytime", "someday", "inbox"]) expect(resolveWhen(k, now)).toBe(k);
    expect(resolveWhen("Today", now)).toBe("today");
  });

  it("turns tomorrow into a local date, across a year boundary", () => {
    expect(resolveWhen("tomorrow", now)).toBe("2027-01-01");
  });

  it("accepts real dates and rejects impossible ones", () => {
    expect(resolveWhen("2027-02-28", now)).toBe("2027-02-28");
    expect(() => resolveWhen("2027-02-30", now)).toThrow(/Invalid "when"/);
    expect(() => resolveWhen("next week", now)).toThrow();
  });

  it("leaves undefined alone", () => {
    expect(resolveWhen(undefined, now)).toBeUndefined();
  });
});

describe("dates", () => {
  it("formats local days", () => expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05"));
  it("validates days", () => {
    expect(isValidDay("2024-02-29")).toBe(true);
    expect(isValidDay("2025-02-29")).toBe(false);
    expect(isValidDay("2025-1-01")).toBe(false);
  });
});
