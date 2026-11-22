# things3pp-cloud

The hosted half of things3pp: a Cloudflare Worker that serves a Things-style web app and a remote MCP server, and relays changes to and from your Mac.

You don't deploy this package directly. Run `things3pp cloud deploy` (see [packages/cli](../cli#your-own-hosted-things-web-app--remote-mcp)); it ships a prebuilt copy of this Worker and deploys it with the Cloudflare CLI (`cf`).

## Developing

```bash
echo "SETUP_KEY=dev-only-setup-key" > .dev.vars
npx cf dev
```

Open `http://localhost:5173/today?demo` to see the web app with sample data (dev only). To try the real flow, point a Mac at it with a temporary config dir:

```bash
THINGS3PP_CONFIG_DIR=$(mktemp -d) node ../cli/dist/index.js connect http://localhost:5173
```

(Add `"setupKey": "dev-only-setup-key"` to that dir's `cloud.json` first so the pairing can create the account.)
