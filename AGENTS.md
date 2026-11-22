# AGENTS.md

Guide for AI coding agents working in this repo. Human-facing docs live in the READMEs; don't put agent instructions there, and don't put marketing here.

## What this repo is

`things3-plus-plus` is a pnpm monorepo of open-source extensions for the Things 3 macOS app (Cultured Code).

| Package | Path | Purpose |
|---|---|---|
| `things3pp` (npm) | `packages/cli` | The CLI users install: local MCP server (`things3pp mcp …`, stdio + Tailscale HTTP), and the Mac side of the hosted app (`connect`, `agent`, `cloud deploy`). Bundles core and ships the prebuilt Worker. |
| `things3pp-core` (private) | `packages/core` | Shared, consumed as TypeScript source: Things bridge (JXA, SQLite reader, relay actions), the snapshot data model + list rules, the MCP tool definitions and the MCP App view. |
| `things3pp-cloud` (private) | `packages/cloud` | Cloudflare Worker + Durable Objects (remote MCP with OAuth, passkeys, Mac relay) and the Preact web app. Built with the `cf` CLI. |

## Commands

Run from the repo root unless noted. Developing needs Node ≥ 22.12 (`.nvmrc`) and pnpm 10 through Corepack (`corepack enable`). The published CLI runs on Node ≥ 20 (the hosted-app agent needs 22+ for WebSocket).

```bash
pnpm install
pnpm build        # core (view.html) → cloud (cf build) → cli (bundles both)
pnpm typecheck    # all packages
pnpm test         # unit tests, no Things app needed
pnpm check        # typecheck + test — run before you finish

pnpm --filter things3pp-core test:live   # bridge against the real Things app (macOS, needs Automation permission)
pnpm --filter things3pp test:e2e         # built dist: stdio, HTTP (loopback + Tailscale), CLI, headless-Chrome UI; uses real Things
node packages/cli/dist/index.js doctor   # after build

# packages/cloud
npx cf dev            # Worker + web app locally (reads SETUP_KEY from .dev.vars)
open "http://localhost:5173/today?demo"  # dev-only demo data, no Mac needed
npx cf build          # what `pnpm build` runs
```

Use the `cf` CLI for everything Cloudflare. **Never use or add wrangler.** Config lives in `packages/cloud/cloudflare.config.ts`. Discover commands with `cf cli search "<task>"`.

Always run `pnpm check` and make it pass before you say you're done. If you changed the web app, the Worker, `src/mcp/ui/**` or the JXA bridge, also run `pnpm build`.

## Layout

```
packages/core/src/
  things/
    things.jxa.js     JXA bridge, run by osascript. Plain JS, copied to the CLI's dist as-is
    move.applescript  list moves (JXA's move is broken)
    client.ts         ThingsClient (osascript, Node only); Runner is injectable for tests
    errors.ts         ThingsError (no Node APIs, used by the Worker too)
    db.ts             read-only SQLite reader → Snapshot (Node only, needs Full Disk Access)
    actions.ts        MacActions: runs relay Actions via ThingsClient + Things URL scheme
    types.ts          Todo, NewTodo, ThingsApi, …
  model/
    types.ts          Snapshot, Task, diffSnapshots/applyPatch
    queries.ts        ThingsIndex: every list (Today, Upcoming, Anytime…) computed from a snapshot
    snapshot-api.ts   ThingsApi over a snapshot + action sender (hosted MCP)
  relay/protocol.ts   ActionSchema (zod) + Mac⇄hub⇄browser message types
  mcp/server.ts       createServer({ things, viewHtml, version }): all MCP tools + ui:// resource
  mcp/ui/             MCP App view, bundled to core/dist/view.html by scripts/build-view.mjs
  format.ts, when.ts
packages/cli/src/
  index.ts            CLI entry: mcp / cloud / connect / agent / doctor (bin: things3pp)
  local.ts            createLocalServer(): core server + ThingsClient + dist/ui/view.html
  http.ts, config.ts, tailscale.ts, cli/   local MCP (unchanged behaviour, now under `mcp`)
  cloud/              config.ts (cloud.json + device key), connect.ts, connector.ts (relay), agent.ts (launchd), deploy.ts, status.ts
packages/cloud/
  cloudflare.config.ts  Worker, KV (OAuth), DOs, SETUP_KEY secret, assets (SPA)
  src/worker/         index.ts (routes + OAuthProvider), account.ts (Account DO), directory.ts (Directory DO), auth.ts (passkeys/sessions), util.ts
  src/app/            Preact web app: store.ts, components/, styles.css, icons.tsx (original icons), demo.ts (dev only)
```

Stack: TypeScript 7, MCP TypeScript SDK **v2**, `@modelcontextprotocol/ext-apps` v2, zod v4, vitest. Cloud: `cf` CLI + `@cloudflare/vite-plugin`, `@cloudflare/workers-oauth-provider`, `@simplewebauthn/*`, Preact. The CLI bundles with esbuild (`packages/cli/scripts/build.mjs`); core is never published separately.

### How the hosted app works

The Mac is the source of truth. `things3pp agent run` (launchd) opens a WebSocket to `/device/connect`, proves itself by signing a challenge with its Ed25519 device key, sends a full `Snapshot` read from the Things SQLite database, then `SnapshotPatch`es whenever the database changes. The Account DO stores the snapshot and fans it out to browsers (`/api/live`). Writes from the web app (`POST /api/action`) and from remote MCP become `Action`s sent to the Mac, which runs them with `MacActions` and pushes the resulting patch before answering. Remote MCP reads come straight from the stored snapshot, so they work while the Mac sleeps.

## Security invariants (do not break)

1. **No code built from input.** `things.jxa.js` and `move.applescript` run verbatim. Input goes in as JSON/argv; output comes back as JSON. SQL in `db.ts` is static and the database is opened `-readonly`. `test/client.test.ts` and `test/db.test.ts` check this.
2. **No delete tools or actions.** Don't expose deletion, trashing or emptying the trash as MCP tools, relay `Action`s, or web app buttons. `trashForTests` exists only for the live test's cleanup and is not reachable through `MacActions`. `test/server.test.ts` and `test/actions.test.ts` check this.
3. **Local HTTP is Tailscale-only.** `mcp serve` binds to the Tailscale IP (or `127.0.0.1` with `--local`). No `0.0.0.0`/LAN binding without an explicit maintainer decision. Public access exists only through the hosted Worker, behind OAuth + passkeys.
4. **Local HTTP guard order:** path → Host allow-list → reject any `Origin` → rate limit → constant-time bearer check. Tokens only in the `Authorization` header, never in URLs or logs.
5. **Secrets on disk** (`token`, `cloud.json` with the device private key and setup key) stay mode 0600 in a 0700 dir; loaders refuse group/world-readable files. The Things URL-scheme token is read on the Mac when needed and never put in a snapshot or sent anywhere.
6. **UI never uses `innerHTML` with data.** MCP view: `h()` + `textContent`. Web app: Preact JSX only, no `dangerouslySetInnerHTML`. The consent page data is embedded as JSON with `<` escaped.
7. **Client config writers** back up before writing and refuse to rewrite invalid JSON; Codex TOML edits only touch the block marked `# Added by things3pp setup`.
8. **`mcp serve` doesn't print the token** unless `--show-token`.
9. **Relay boundary:** the Mac only runs `Action`s that pass `ActionSchema` (zod) in `MacActions.run`, validated again on the Mac even though the DO validates too. The Worker never sends script text.
10. **Hosted auth:** the first account can only be created by a pairing started with the deployment's `SETUP_KEY` (constant-time compare). Every state-changing `/api/*` call requires the `x-things3pp: 1` header and a same-origin `Origin` (CSRF). Sessions are random tokens stored hashed in the Account DO, in an `HttpOnly; Secure; SameSite=Lax` `__Host-` cookie. MCP consent requires a fresh passkey assertion. WebAuthn challenges are single-use (Directory DO). Device sockets must authenticate within 15 s.

## Adding or changing a tool

- Register in `packages/core/src/mcp/server.ts` (it serves both the local and the hosted MCP server). Use `registerAppTool` with `_meta: ui` if the result should render in the view. Return `itemResult(...)` or `listResult(...)` so the UI gets a `ViewPayload`.
- Validate with zod at the boundary (lengths, dates via `isValidDay`, `when` via `resolveWhen`).
- Set annotations accurately: `readOnlyHint` for reads; `destructiveHint: true` for anything that overwrites data.
- Wrap handlers in `guard()` so Things errors become `isError` results, not thrown protocol errors.
- Add the op to `things.jxa.js`, a method to `ThingsClient` and `ThingsApi`, the hosted version in `SnapshotThingsApi` (reads from the snapshot; writes need an `Action` in `relay/protocol.ts` + `MacActions`), and tests. Update the tool lists in `packages/core/test/server.test.ts` and the "What it can do" table in `packages/cli/README.md`.
- Tool descriptions are prompts. Keep them short, concrete and model-facing.

## JXA / Things gotchas

- Use list ids, not names (names are localized): `TMInboxListSource`, `TMTodayListSource`, `TMNextListSource` (Anytime), `TMCalendarListSource` (Upcoming), `TMSomedayListSource`, `TMLogbookListSource`, `TMTrashListSource`.
- `Application("Things3").version()` is answered locally and **does not prove Automation permission**. `ping` counts lists to force a real Apple event.
- Error numbers: `-1743` means permission denied, and `-1712` means timed out (usually a permission prompt nobody has answered). macOS attributes permission to the *responsible app* (Claude, Codex, Terminal…), so each AI app gets its own prompt.
- Things has no AppleScript for checklists, headings or "This Evening". The hosted app reads them from SQLite (`db.ts`) and writes them with the URL scheme's JSON command (`things:///json?auth-token=…`), which needs "Enable Things URLs". Read the full dictionary with `sdef /Applications/Things3.app`. Avoid the `_private_experimental_` properties.
- **SQLite schema** (`TMTask`, `TMArea`, `TMTag`, `TMTaskTag`, `TMChecklistItem`, `TMSettings`): `type` 0 to-do / 1 project / 2 heading; `status` 0 open / 2 canceled / 3 completed; `start` 0 inbox / 1 anytime / 2 someday; `startDate`/`deadline` are packed `y<<16 | m<<12 | d<<7`; `startBucket` 1 = This Evening; to-dos under a heading have `heading` set and `project` NULL. Columns differ between Things versions, so `readSnapshot` reads `pragma_table_info` first. There's no API to reorder items.
- Dates: Things stores When/Deadline as local midnight. The bridge converts to `YYYY-MM-DD` with local getters. Never use `toISOString()` for day values.
- **Performance:** never index into a list (`list.toDos[i]`). Things re-evaluates the whole list on every access, which costs 100 ms+ per item (600 ms in the Logbook). Fetch ids in one batch (`coll.id()`), then read each item with `things.toDos.byId(id)` (~10 ms). Batched single properties (`coll.name()`, `coll.project.id()`) are fast. `coll.properties()` fails. `whose` queries are slow (~2.5 s), so filter in JS instead.
- **`move` is broken in JXA** (-1700 "Can't convert types"). List moves (Inbox/Anytime/Someday) go through `move.applescript`, with ids as argv. `ThingsClient.writeThenMove` handles this.
- **Clearing a deadline:** `things.delete(item.dueDate)`. Assigning `null` throws, and assigning `undefined` silently sets 1904-01-01.
- **Projects:** `things.toDos` doesn't include projects, and edits or deletes on a project must go through `things.projects.byId(id)` (`getTodo` does this). To put a to-do in a project, create it with `things.toDos.push(...)` and then set `.project`. Pushing into `project.toDos` doesn't attach it.
- Repeating to-dos in Upcoming have no `activationDate` through scripting. Their next date isn't available.
- `pcls` and `class()` aren't reliable for telling a project from a to-do. Use the open-project id set (`isProject`).

## Testing

- Unit tests must not touch the real Things app or database. Inject `fakeRunner()` from `packages/core/test/fixtures.ts`, a fake `SqlRunner` for `db.ts`, and a fake `UrlScheme` for `MacActions`.
- `packages/core/test/live.test.ts` is opt-in (`THINGS_LIVE=1`). It creates one to-do titled `[things3pp live test …]` and trashes it in `afterAll`. Never write live tests that modify existing user data.
- HTTP tests call `createHttpApp().fetch()` directly, plus one loopback test using the real SDK client.
- `packages/cli/test/e2e/` (opt-in, `THINGS_E2E=1`) runs the built `dist` end to end. It needs Things, Tailscale and Google Chrome. Items it creates are prefixed `[things3pp e2e` and trashed afterwards. Setup tests use a temporary `HOME` and `THINGS3PP_CONFIG_DIR`, so they never touch real configs or the real token.
- The hosted app is tested end to end against `cf dev` (local Worker + DOs, Chrome's WebAuthn virtual authenticator for passkeys). Point the connector at it with a temporary `THINGS3PP_CONFIG_DIR`. Web app look-and-feel: `?demo` in dev.

## Releasing

- `.github/workflows/release.yml` publishes `packages/cli` to npm on every push to `master` that touches it, using npm trusted publishing (OIDC, no token). The version is `<major>.<minor>.<run number>`. Bump major or minor in `packages/cli/package.json`; never hand-edit the patch.
- Publishing is skipped unless the repository variable `NPM_PUBLISH` is `true`. One-time setup and rollback: `docs/release-setup.md`.
- Don't run `npm publish` yourself, and don't add npm tokens to the repo or to Actions secrets.

## Adding a new package

- Create `packages/<name>/` with its own `package.json` (name it `things3pp-<name>`; the `@things3pp` npm scope isn't registered yet), `README.md` if it's user-facing, and `build` / `typecheck` / `test` scripts so the root scripts pick it up.
- Share Things code through `things3pp-core` (`"things3pp-core": "workspace:*"`, imported as `things3pp-core/<path>`). Anything published must bundle it, like the CLI does.
- Add it to the package table at the top of this file and to the root `README.md` if users see it.

## Conventions

- ESM everywhere (`"type": "module"`, `.js` extensions in relative imports).
- User-facing text (CLI output, errors, READMEs) is plain, friendly and jargon-free, and tells people what to do next.
- Don't commit `dist/` or `.cloudflare/`. Don't add runtime dependencies to the CLI without a good reason; it has four.
- The web app should feel like a native Mac app: system font, calm spacing, subtle motion, light + dark, phone layout. Use our own icons (`icons.tsx`), never Cultured Code's artwork, logo or the "Things" name as our brand.
