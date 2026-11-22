# AGENTS.md

Guide for AI coding agents working in this repo. Human-facing docs live in the READMEs; don't put agent instructions there, and don't put marketing here.

## What this repo is

`things3-plus-plus` is a pnpm monorepo of independent open-source extensions for the Things 3 macOS app (Cultured Code). Each extension is a package under `packages/`.

| Package | Path | Purpose |
|---|---|---|
| `things3pp` | `packages/mcp` | MCP server (stdio + Streamable HTTP over Tailscale) exposing Things to AI apps, with an MCP Apps inline UI. |

## Commands

Run from the repo root unless noted. Developing needs Node ≥ 22.12 (`.nvmrc`) and pnpm 10 through Corepack (`corepack enable`). The published package itself runs on Node ≥ 20.

```bash
pnpm install
pnpm build        # all packages
pnpm typecheck    # all packages
pnpm test         # unit tests, no Things app needed
pnpm check        # typecheck + test — run before you finish

# packages/mcp only
pnpm --filter things3pp test:live   # against the real Things app (macOS, needs Automation permission)
pnpm --filter things3pp test:e2e    # built dist: stdio, HTTP (loopback + Tailscale), CLI, headless-Chrome UI; uses real Things
node packages/mcp/dist/index.js doctor   # after build
```

Always run `pnpm check` and make it pass before you say you're done. If you changed `src/ui/**` or the JXA bridge, also run `pnpm build`.

## packages/mcp layout

```
src/
  index.ts            CLI entry + stdio server (bin: things3pp)
  server.ts           createServer(): all MCP tools + the ui:// resource
  http.ts             Streamable HTTP app: Host check → reject Origin → rate-limited bearer token → MCP
  config.ts           token storage (~/.config/things3pp/token, 0600, dir 0700)
  tailscale.ts        find this Mac's Tailscale IP / MagicDNS name
  format.ts           text output for the model + ViewPayload type for the UI
  when.ts             "when"/date parsing (local calendar days)
  things/
    things.jxa.js     JXA bridge, run by osascript. Plain JS (not TS), copied to dist as-is
    client.ts         ThingsClient: typed wrapper; Runner is injectable for tests
    types.ts          Todo, NewTodo, TodoUpdate, …
  cli/                setup / doctor / serve and the client config writers
  ui/
    view.html         template with <!--SCRIPT--> marker
    view.ts           MCP App (browser code), bundled by scripts/build-assets.mjs into dist/ui/view.html
test/                 vitest; fixtures.ts has fakeRunner() and todo()
```

Stack: TypeScript 7 (`tsc` for the server, esbuild for the UI), MCP TypeScript SDK **v2** (`@modelcontextprotocol/server`, `/node`, `/client` for tests), `@modelcontextprotocol/ext-apps` v2 (`registerAppTool`/`registerAppResource` on the server, `App` in the view), zod v4, vitest.

## Security invariants (do not break)

1. **No code built from input.** `things.jxa.js` runs verbatim. Input goes in as one JSON argv string; output comes back as JSON. Never concatenate or template user data into the script. `test/client.test.ts` checks this.
2. **No delete tools.** Don't expose deletion, trashing or emptying the trash as MCP tools. `trashForTests` exists only for the live test's cleanup. `test/server.test.ts` checks the tool list.
3. **HTTP is Tailscale-only.** `serve` binds to the Tailscale IP (or `127.0.0.1` with `--local`). Don't add `0.0.0.0` or LAN binding without an explicit decision from the maintainers.
4. **HTTP guard order:** path → Host allow-list → reject any `Origin` → rate limit → constant-time bearer check (`timingSafeEqual` on SHA-256 digests). Tokens go only in the `Authorization` header, never in URLs or logs.
5. **Token file** stays mode 0600 in a 0700 dir. `loadOrCreateToken` refuses group- or world-readable files.
6. **UI never uses `innerHTML` with data.** Use the `h()` helper and `textContent`. Only the static `ICONS` constants go through `innerHTML`.
7. **Client config writers** back up before writing and refuse to rewrite invalid JSON. For Codex TOML, setup only replaces the block it wrote itself (marked `# Added by things3pp setup`). It never edits a `[mcp_servers.things]` block a user wrote by hand.
8. **`serve` doesn't print the token** unless `--show-token` is passed, so it can't leak into service logs. Users get it with `things3pp token`.

## Adding or changing a tool

- Register in `src/server.ts`. Use `registerAppTool` with `_meta: ui` if the result should render in the view. Return `itemResult(...)` or `listResult(...)` so the UI gets a `ViewPayload`.
- Validate with zod at the boundary (lengths, dates via `isValidDay`, `when` via `resolveWhen`).
- Set annotations accurately: `readOnlyHint` for reads; `destructiveHint: true` for anything that overwrites data.
- Wrap handlers in `guard()` so Things errors become `isError` results, not thrown protocol errors.
- Add the op to `things.jxa.js`, a method to `ThingsClient`, and tests (fake runner in `test/server.test.ts`). Update the tool lists in `test/server.test.ts` and the "What it can do" table in `packages/mcp/README.md`.
- Tool descriptions are prompts. Keep them short, concrete and model-facing.

## JXA / Things gotchas

- Use list ids, not names (names are localized): `TMInboxListSource`, `TMTodayListSource`, `TMNextListSource` (Anytime), `TMCalendarListSource` (Upcoming), `TMSomedayListSource`, `TMLogbookListSource`, `TMTrashListSource`.
- `Application("Things3").version()` is answered locally and **does not prove Automation permission**. `ping` counts lists to force a real Apple event.
- Error numbers: `-1743` means permission denied, and `-1712` means timed out (usually a permission prompt nobody has answered). macOS attributes permission to the *responsible app* (Claude, Codex, Terminal…), so each AI app gets its own prompt.
- Things has no AppleScript for checklists, headings or "This Evening". Read the full dictionary with `sdef /Applications/Things3.app`. Avoid the `_private_experimental_` properties.
- Dates: Things stores When/Deadline as local midnight. The bridge converts to `YYYY-MM-DD` with local getters. Never use `toISOString()` for day values.
- **Performance:** never index into a list (`list.toDos[i]`). Things re-evaluates the whole list on every access, which costs 100 ms+ per item (600 ms in the Logbook). Fetch ids in one batch (`coll.id()`), then read each item with `things.toDos.byId(id)` (~10 ms). Batched single properties (`coll.name()`, `coll.project.id()`) are fast. `coll.properties()` fails. `whose` queries are slow (~2.5 s), so filter in JS instead.
- **`move` is broken in JXA** (-1700 "Can't convert types"). List moves (Inbox/Anytime/Someday) go through `move.applescript`, with ids as argv. `ThingsClient.writeThenMove` handles this.
- **Clearing a deadline:** `things.delete(item.dueDate)`. Assigning `null` throws, and assigning `undefined` silently sets 1904-01-01.
- **Projects:** `things.toDos` doesn't include projects, and edits or deletes on a project must go through `things.projects.byId(id)` (`getTodo` does this). To put a to-do in a project, create it with `things.toDos.push(...)` and then set `.project`. Pushing into `project.toDos` doesn't attach it.
- Repeating to-dos in Upcoming have no `activationDate` through scripting. Their next date isn't available.
- `pcls` and `class()` aren't reliable for telling a project from a to-do. Use the open-project id set (`isProject`).

## Testing

- Unit tests must not touch the real Things app. Inject `fakeRunner()` from `test/fixtures.ts`.
- `test/live.test.ts` is opt-in (`THINGS_LIVE=1`). It creates one to-do titled `[things3pp live test …]` and trashes it in `afterAll`. Never write live tests that modify existing user data.
- HTTP tests call `createHttpApp().fetch()` directly, plus one loopback test using the real SDK client.
- `test/e2e/` (opt-in, `THINGS_E2E=1`) runs the built `dist` end to end. It needs Things, Tailscale and Google Chrome. Items it creates are prefixed `[things3pp e2e` and trashed afterwards. Setup tests use a temporary `HOME` and `THINGS3PP_CONFIG_DIR`, so they never touch real configs or the real token.

## Releasing

- `.github/workflows/release.yml` publishes `packages/mcp` to npm on every push to `master` that touches it, using npm trusted publishing (OIDC, no token). The version is `<major>.<minor>.<run number>`. Bump major or minor in `packages/mcp/package.json`; never hand-edit the patch.
- Publishing is skipped unless the repository variable `NPM_PUBLISH` is `true`. One-time setup and rollback: `docs/release-setup.md`.
- Don't run `npm publish` yourself, and don't add npm tokens to the repo or to Actions secrets.

## Adding a new package

- Create `packages/<name>/` with its own `package.json` (name it `things3pp-<name>` for now; the `@things3pp` npm scope isn't registered yet), `README.md` (for humans), `tsconfig.json` extending `../../tsconfig.base.json`, and `build` / `typecheck` / `test` scripts so the root scripts pick it up.
- Add it to the package table at the top of this file and to the root `README.md`.
- If it also needs to talk to Things, copy `packages/mcp/src/things` for now. Once a second package needs it, extract a shared `packages/core`.

## Conventions

- ESM everywhere (`"type": "module"`, `.js` extensions in relative imports).
- User-facing text (CLI output, errors, READMEs) is plain, friendly and jargon-free, and tells people what to do next.
- Don't commit `dist/`. Don't add runtime dependencies without a good reason; the server has four.
