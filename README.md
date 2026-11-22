# Things 3 ++

**Free, open-source add-ons that make [Things 3](https://culturedcode.com/things/) even better.**

Things is a lovely to-do app. This project adds the things it doesn't do by itself: working with AI assistants, and using your to-dos in a browser on any computer or phone. It runs on your own Mac, plus your own Cloudflare account if you want the web app.

## What's inside

| | What it does | |
|---|---|---|
| 🤖 | **[Things for AI apps](packages/cli)**: ask Claude, Codex, ChatGPT and others about your to-dos, add new ones, or tick them off. Your lists show up right in the chat, looking like Things. | [Get started →](packages/cli#get-started-2-minutes) |
| 🌐 | **[Your own hosted Things](packages/cli#your-own-hosted-things-web-app--remote-mcp)**: a calm, Mac-like web app for your Things to-dos, plus a remote MCP server for Claude.ai and ChatGPT. It runs on your own Cloudflare account, and you sign in with a passkey. | [Set it up →](packages/cli#your-own-hosted-things-web-app--remote-mcp) |

More add-ons are on the way. Have an idea? [Open an issue](https://github.com/PaulAshraf/things3-plus-plus/issues).

## Quick start

You need a Mac with Things 3 and [Node.js](https://nodejs.org) 20 or newer. Then run:

```bash
npx -y things3pp mcp setup
```

Setup finds your AI apps and connects them to Things. Restart them and ask *"What's on my Things today?"*

## Your privacy

- Your to-dos never pass through our servers, because we don't have any. The MCP server runs on your Mac. The optional web app runs on your own Cloudflare account.
- Nothing here can delete your to-dos. Changes go through your AI app, and most apps ask you first.
- The code is open, so you can read exactly what it does.

## Contributing

Pull requests are welcome. If you're working with an AI coding agent, point it at [AGENTS.md](AGENTS.md); it has everything an agent needs to work in this repo.

## License

[MIT](LICENSE). Not affiliated with Cultured Code. "Things" is their trademark.
