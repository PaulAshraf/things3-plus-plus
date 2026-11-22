import type { Runner } from "../src/things/client.js";
import type { Todo } from "../src/things/types.js";

export function todo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: "abc123",
    kind: "todo",
    title: "Buy milk",
    notes: "",
    status: "open",
    when: null,
    deadline: null,
    tags: [],
    project: null,
    area: null,
    createdAt: "2026-11-20T10:00:00.000Z",
    modifiedAt: "2026-11-20T10:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

export interface Call {
  language: "JavaScript" | "AppleScript";
  script: string;
  op: string;
  args: Record<string, unknown>;
}

/** A Runner that records calls and answers from a handler, like the real JXA bridge would. */
export function fakeRunner(handler: (op: string, args: Record<string, unknown>) => unknown) {
  const calls: Call[] = [];
  const runner: Runner = async ({ language, script, args: argv }) => {
    if (language === "AppleScript") {
      // move.applescript: argv = [id, listId]
      calls.push({ language, script, op: "moveToList", args: { id: argv[0], list: argv[1] } });
      return '{"ok":true}';
    }
    const { op, args } = JSON.parse(argv[0]!) as { op: string; args: Record<string, unknown> };
    calls.push({ language, script, op, args });
    try {
      return JSON.stringify({ ok: true, data: handler(op, args) });
    } catch (e) {
      const err = e as Error & { errorNumber?: number };
      return JSON.stringify({ ok: false, error: err.message, errorNumber: err.errorNumber ?? null });
    }
  };
  return { runner, calls };
}

export function bridgeError(message: string, errorNumber?: number): Error {
  return Object.assign(new Error(message), { errorNumber });
}
