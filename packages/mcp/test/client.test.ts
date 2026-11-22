import { describe, expect, it } from "vitest";
import { ThingsClient, ThingsError, thingsUrl } from "../src/things/client.js";
import { bridgeError, fakeRunner, todo } from "./fixtures.js";

describe("ThingsClient", () => {
  it("sends user input only as JSON data, never inside the script", async () => {
    const { runner, calls } = fakeRunner(() => todo());
    const client = new ThingsClient(runner);
    const evil = `"); Application("Finder").delete(); ("`;
    await client.addTodo({ title: evil });
    await client.search(evil);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.script).toBe(calls[1]!.script);
    expect(calls[0]!.script).not.toContain(evil);
    expect(calls[0]!.args.title).toBe(evil);
  });

  it("maps a denied Automation permission to a helpful error", async () => {
    const { runner } = fakeRunner(() => {
      throw bridgeError("Error: Not authorized to send Apple events to Things3.", -1743);
    });
    const err = await new ThingsClient(runner).list("today").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ThingsError);
    expect((err as ThingsError).code).toBe("permission_denied");
    expect((err as ThingsError).message).toMatch(/Privacy & Security/);
  });

  it("maps an AppleEvent timeout to permission_pending", async () => {
    const { runner } = fakeRunner(() => {
      throw bridgeError("AppleEvent timed out.", -1712);
    });
    const err = (await new ThingsClient(runner).ping().catch((e: unknown) => e)) as ThingsError;
    expect(err.code).toBe("permission_pending");
  });

  it("maps missing items to not_found", async () => {
    const { runner } = fakeRunner(() => {
      throw bridgeError("No to-do or project found with id nope");
    });
    const err = (await new ThingsClient(runner).get("nope").catch((e: unknown) => e)) as ThingsError;
    expect(err.code).toBe("not_found");
  });

  it("rejects garbage output", async () => {
    const client = new ThingsClient(async () => "not json");
    await expect(client.ping()).rejects.toMatchObject({ code: "things_error" });
  });

  it("builds deep links safely", () => {
    expect(thingsUrl("a b&c")).toBe("things:///show?id=a%20b%26c");
  });
});

describe("list moves", () => {
  it("sends inbox/anytime/someday through the AppleScript mover with ids as argv", async () => {
    const { runner, calls } = fakeRunner((op, args) => todo({ id: "new1", title: String(args.title ?? "x") }));
    const client = new ThingsClient(runner);
    await client.addTodo({ title: "Later", when: "someday" });
    expect(calls.map((c) => c.op)).toEqual(["addTodo", "moveToList", "get"]);
    expect(calls[0]!.args.when).toBeUndefined();
    expect(calls[1]).toMatchObject({ language: "AppleScript", args: { id: "new1", list: "TMSomedayListSource" } });
    expect(calls[1]!.script).not.toContain("new1");
  });

  it("schedules dates in one JXA call", async () => {
    const { runner, calls } = fakeRunner(() => todo());
    await new ThingsClient(runner).update({ id: "abc123", when: "2026-12-01" });
    expect(calls.map((c) => c.op)).toEqual(["update"]);
    expect(calls[0]!.args.when).toBe("2026-12-01");
  });
});
