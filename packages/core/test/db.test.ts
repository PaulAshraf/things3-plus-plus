import { describe, expect, it } from "vitest";
import { cleanNotes, readSnapshot, readUrlSchemeToken, unpackDay, unpackTime, type SqlRunner } from "../src/things/db.js";

const pack = (y: number, m: number, d: number) => (y << 16) | (m << 12) | (d << 7);

describe("Things database decoding", () => {
  it("unpacks days and times", () => {
    expect(unpackDay(pack(2026, 11, 22))).toBe("2026-11-22");
    expect(unpackDay(null)).toBeNull();
    expect(unpackDay(0)).toBeNull();
    expect(unpackTime((18 << 26) | (30 << 20))).toBe("18:30");
    expect(unpackTime(null)).toBeNull();
  });

  it("cleans old XML notes", () => {
    expect(cleanNotes('<note xml:space="preserve">a &amp; b &lt;3</note>')).toBe("a & b <3");
    expect(cleanNotes("plain")).toBe("plain");
    expect(cleanNotes(null)).toBe("");
  });

  it("reads a snapshot from query output, read-only and with static SQL", async () => {
    const seen: string[] = [];
    const cols = ["uuid", "type", "status", "trashed", "title", "notes", "start", "startDate", "startBucket", "deadline", "reminderTime", "area", "project", "heading", "index", "todayIndex", "rt1_repeatingTemplate", "creationDate", "userModificationDate", "stopDate", "rt1_recurrenceRule"];
    const run: SqlRunner = async (_db, sql) => {
      seen.push(sql);
      if (sql.includes("pragma_table_info")) return JSON.stringify(cols);
      const tasks = [
        ["T1", 0, 0, 0, "Buy milk", "", 1, pack(2026, 11, 22), 1, null, null, null, "P1", null, 3, 1, null, 1763800000, 1763800000, null],
        ["P1", 1, 0, 0, "Groceries", "notes", 1, null, 0, pack(2026, 12, 1), null, "A1", null, null, 1, 0, null, 1763800000, 1763800000, null],
        ["T2", 0, 3, 0, "Done", "", 1, null, 0, null, null, null, null, null, 4, 0, "TEMPLATE", 1763800000, 1763800000, 1763886400],
      ];
      return [
        JSON.stringify(tasks),
        JSON.stringify([["C1", "T1", "Oat", 0, 1], ["C2", "T1", "Soy", 3, 2]]),
        JSON.stringify([["T1", "TAG1"]]),
        JSON.stringify([["A1", "Home", 1]]),
        JSON.stringify([]),
        JSON.stringify([["TAG1", "Errand", null, null, 1]]),
        "1",
      ].join("\n");
    };
    const snap = await readSnapshot("/fake/main.sqlite", { run, timeZone: "Europe/Berlin" });
    expect(snap.capabilities.urlScheme).toBe(true);
    expect(snap.timeZone).toBe("Europe/Berlin");
    const t1 = snap.tasks.find((t) => t.id === "T1")!;
    expect(t1).toMatchObject({ kind: "todo", when: "2026-11-22", evening: true, projectId: "P1", tags: ["TAG1"], index: 3 });
    expect(t1.checklist).toEqual([
      { id: "C1", title: "Oat", done: false },
      { id: "C2", title: "Soy", done: true },
    ]);
    expect(snap.tasks.find((t) => t.id === "P1")).toMatchObject({ kind: "project", deadline: "2026-12-01", areaId: "A1" });
    expect(snap.tasks.find((t) => t.id === "T2")).toMatchObject({ status: "completed", repeating: true });
    expect(snap.tasks.find((t) => t.id === "T2")!.completedAt).toMatch(/^2025-11-23T/);
    // The URL-scheme token never ends up in the snapshot.
    expect(JSON.stringify(snap)).not.toMatch(/uriSchemeAuthenticationToken/);
    for (const sql of seen) expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ATTACH)\b/i);
  });

  it("reads the URL-scheme token separately", async () => {
    expect(await readUrlSchemeToken("/x", async () => "abc123\n")).toBe("abc123");
    expect(await readUrlSchemeToken("/x", async () => "\n")).toBeNull();
  });
});
