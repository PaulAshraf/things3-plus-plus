import { describe, expect, it } from "vitest";
import { addDays, deadlineText, diffDays, parseWhenText, shortWhen } from "../src/app/dates.ts";

const today = "2026-11-22"; // a Sunday

describe("dates", () => {
  it("does local day math", () => {
    expect(addDays(today, 10)).toBe("2026-12-02");
    expect(diffDays(today, "2026-11-25")).toBe(3);
  });

  it("labels days the friendly way", () => {
    expect(shortWhen(today, today)).toBe("Today");
    expect(shortWhen("2026-11-23", today)).toBe("Tomorrow");
  });

  it("describes deadlines", () => {
    expect(deadlineText("2026-11-20", today)).toEqual({ text: "2 days ago", tone: "overdue" });
    expect(deadlineText(today, today)).toEqual({ text: "today", tone: "soon" });
    expect(deadlineText("2026-11-23", today).text).toBe("1 day left");
  });

  it("parses typed dates", () => {
    expect(parseWhenText("tomorrow", today)).toBe("2026-11-23");
    expect(parseWhenText("tonight", today)).toBe("evening");
    expect(parseWhenText("in 3 days", today)).toBe("2026-11-25");
    expect(parseWhenText("fri", today)).toBe("2026-11-27");
    expect(parseWhenText("someday", today)).toBe("someday");
    expect(parseWhenText("2026-12-24", today)).toBe("2026-12-24");
    expect(parseWhenText("gibberish words", today)).toBeNull();
    expect(parseWhenText("dec 24", today)).toBe("2026-12-24");
  });
});
