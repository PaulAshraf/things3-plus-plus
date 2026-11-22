// Day math on local YYYY-MM-DD strings (never via toISOString, which shifts to UTC).

export function dayOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

export function addDays(day: string, n: number): string {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return dayOf(d);
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);
}

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(undefined, opts);
const weekday = fmt({ weekday: "long" });
const weekdayShort = fmt({ weekday: "short" });
const monthDay = fmt({ month: "short", day: "numeric" });
const monthDayYear = fmt({ month: "short", day: "numeric", year: "numeric" });
const monthName = fmt({ month: "long" });
const monthYear = fmt({ month: "long", year: "numeric" });

/** "Today", "Tomorrow", "Fri", "Dec 3", "Dec 3, 2027". */
export function shortWhen(day: string, today: string): string {
  const n = diffDays(today, day);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  if (n > 1 && n < 7) return weekdayShort.format(parseDay(day));
  const d = parseDay(day);
  return d.getFullYear() === parseDay(today).getFullYear() ? monthDay.format(d) : monthDayYear.format(d);
}

/** "Tomorrow", "Friday", "December 3". */
export function longWhen(day: string, today: string): string {
  const n = diffDays(today, day);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n > 1 && n < 7) return weekday.format(parseDay(day));
  return shortWhen(day, today);
}

/** For deadlines: "today", "1 day left", "3 days ago". */
export function deadlineText(deadline: string, today: string): { text: string; tone: "normal" | "soon" | "overdue" } {
  const n = diffDays(today, deadline);
  if (n < 0) return { text: `${-n} day${n === -1 ? "" : "s"} ago`, tone: "overdue" };
  if (n === 0) return { text: "today", tone: "soon" };
  if (n <= 3) return { text: `${n} day${n === 1 ? "" : "s"} left`, tone: "soon" };
  return { text: shortWhen(deadline, today), tone: "normal" };
}

export function weekdayName(day: string): string {
  return weekday.format(parseDay(day));
}
export function monthLabel(day: string, today: string): string {
  const d = parseDay(day);
  return d.getFullYear() === parseDay(today).getFullYear() ? monthName.format(d) : monthYear.format(d);
}
export function monthTitle(d: Date): string {
  return monthYear.format(d);
}
export function loggedLabel(day: string, today: string): string {
  const n = diffDays(day, today);
  if (n === 0) return "Today";
  if (n === 1) return "Yesterday";
  return monthDay.format(parseDay(day));
}

/** Local day of an ISO timestamp. */
export function isoToDay(iso: string): string {
  return dayOf(new Date(iso));
}

/** Quick natural-language "when" for the When popover's text field. */
export function parseWhenText(text: string, today: string): string | "someday" | "anytime" | "evening" | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (t === "today" || t === "tod") return today;
  if (t === "tonight" || t === "evening" || t === "this evening") return "evening";
  if (t === "tomorrow" || t === "tom" || t === "tmr") return addDays(today, 1);
  if (t === "someday" || t === "some") return "someday";
  if (t === "anytime" || t === "any") return "anytime";
  if (/^next week$/.test(t)) return addDays(today, 7 - ((parseDay(today).getDay() + 6) % 7));
  const inDays = /^in (\d+) (day|days|week|weeks)$/.exec(t);
  if (inDays) return addDays(today, Number(inDays[1]) * (inDays[2]!.startsWith("week") ? 7 : 1));
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const idx = days.findIndex((d) => d.startsWith(t.replace(/^next /, "")) && t.replace(/^next /, "").length >= 2);
  if (idx >= 0) {
    const cur = parseDay(today).getDay();
    let n = (idx - cur + 7) % 7 || 7;
    if (t.startsWith("next ")) n += n < 7 ? 7 : 0;
    return addDays(today, n);
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) return dayOf(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  // "dec 24", "24 december", "12/24": only hand Date.parse things that look like a date.
  const looksLikeDate =
    /^(\d{1,2}[/.]\d{1,2})$/.test(t) ||
    (/\d/.test(t) && /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.test(t) && t.split(/\s+/).length <= 3);
  const parsed = looksLikeDate ? Date.parse(`${text} ${parseDay(today).getFullYear()}`) : NaN;
  if (!Number.isNaN(parsed)) {
    let d = dayOf(new Date(parsed));
    if (d < today) d = dayOf(new Date(Date.parse(`${text} ${parseDay(today).getFullYear() + 1}`)));
    return d;
  }
  return null;
}
