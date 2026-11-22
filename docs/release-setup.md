# Release setup

How `.github/workflows/release.yml` publishes `packages/cli` to npm as [`things3pp`](https://www.npmjs.com/package/things3pp), and the one-time setup it needs.

Every push to `master` that touches `packages/cli/**`, `packages/core/**`, `packages/cloud/**`, `pnpm-lock.yaml` or the workflow (and every manual dispatch on `master`) typechecks, tests, builds and publishes `0.<minor>.<run number>`. To bump the minor or major version, change it in `packages/cli/package.json`; CI keeps the first two parts and replaces the patch with the run number. A run fails if its version is already on npm. Re-running a run reuses its version, so push or dispatch a new run instead.

It uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/): GitHub's OIDC token proves the workflow, so no npm token is stored anywhere. npm is retiring 2FA-bypass tokens, and a passkey-protected account can't publish from CI any other way. The repository is public, so npm also attaches provenance to every release.

## One-time setup

1. **Publish the first version by hand.** Trusted publishing can't be configured for a package that doesn't exist yet. Sign in with your passkey in the browser:
   ```sh
   pnpm install && pnpm --filter "things3pp..." build
   cd packages/cli
   npx npm@11 login --auth-type=web
   npx npm@11 publish --access public
   ```
2. **Add the trusted publisher.** On npmjs.com, open things3pp → Settings → Trusted Publisher → GitHub Actions. Set owner `PaulAshraf`, repository `things3-plus-plus`, workflow `release.yml`, and no environment.
3. **Turn on CI publishing:** `gh variable set NPM_PUBLISH --body true`. The next release must publish within 2 days of step 2, or npm expires the unvalidated configuration and you have to recreate it. Running the workflow by hand (Actions → Release npm → Run workflow) is the quickest way.

Until `NPM_PUBLISH` is `true`, the workflow still typechecks, tests and builds, and only skips the publish step.

## Rolling back a bad release

npm versions can't be overwritten, and unpublishing breaks anyone who installed the release. Fix forward: revert or fix the commit on `master` and push. CI publishes a higher run number, which `npx -y things3pp` picks up. To warn people off the bad version in the meantime, run `npm deprecate things3pp@<version> "<reason>"`.
