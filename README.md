# Things 3 ++

**Free, open-source add-ons that make [Things 3](https://culturedcode.com/things/) even better.**

Things is a lovely to-do app. This project adds the things it doesn't do by itself: working with AI assistants and connecting to your other tools. Everything runs on your own Mac, and nothing gets uploaded anywhere.

## What's inside

| | What it does | |
|---|---|---|
| 🤖 | **[Things for AI apps](packages/mcp)**: ask Claude, Codex, ChatGPT and others about your to-dos, add new ones, or tick them off. Your lists show up right in the chat, looking like Things. | [Get started →](packages/mcp#get-started-2-minutes) |

More add-ons are on the way. Have an idea? [Open an issue](https://github.com/PaulAshraf/things3-plus-plus/issues).

## Quick start

You need a Mac with Things 3 and [Node.js](https://nodejs.org) 20 or newer. Then run:

```bash
npx -y things3pp setup
```

Setup finds your AI apps and connects them to Things. Restart them and ask *"What's on my Things today?"*

## Your privacy

- Everything runs on your Mac. Your to-dos never pass through our servers, because we don't have any.
- Nothing here can delete your to-dos. Changes go through your AI app, and most apps ask you first.
- The code is open, so you can read exactly what it does.

## Contributing

Pull requests are welcome. If you're working with an AI coding agent, point it at [AGENTS.md](AGENTS.md); it has everything an agent needs to work in this repo.

## License

[MIT](LICENSE). Not affiliated with Cultured Code. "Things" is their trademark.
