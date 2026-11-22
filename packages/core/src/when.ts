/** Turn friendly "when" input into what the Things bridge understands. */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const WHEN_KEYWORDS = ["today", "tomorrow", "anytime", "someday", "inbox"] as const;

export function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isValidDay(value: string): boolean {
  if (!DAY_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function resolveWhen(when: string | undefined, now = new Date()): string | undefined {
  if (when === undefined) return undefined;
  const value = when.trim().toLowerCase();
  if (value === "tomorrow") {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    return localDay(t);
  }
  if (value === "today" || value === "anytime" || value === "someday" || value === "inbox") return value;
  if (isValidDay(value)) return value;
  throw new Error(`Invalid "when": ${when}. Use today, tomorrow, anytime, someday, inbox, or a date like 2026-12-31.`);
}
