# Things for AI apps

Talk to your [Things 3](https://culturedcode.com/things/) to-dos from **Claude, Codex, ChatGPT, Cursor, VS Code** and other AI apps.

> *"What's on my plate today?"*
> *"Add 'renew passport' with a deadline next Friday."*
> *"Move everything tagged errand to tomorrow."*
> *"Make a project for the kitchen remodel with a few starter tasks."*

In apps that support it (Claude, ChatGPT, VS Code, Goose and others), your lists appear **right in the chat, styled like Things**. You can tick items off there, and they're ticked off in Things too.

---

## Get started (2 minutes)

**You need:** a Mac with Things 3, plus [Node.js](https://nodejs.org) 20 or newer.

**1. Run setup in Terminal:**

```bash
npx -y things3pp setup
```

It finds the AI apps on your Mac and asks before changing anything. It also saves a backup of every settings file it touches.

**2. Restart your AI app** and ask: *"What's on my Things today?"*

**3. Click OK** when macOS asks *"… wants to control Things3"*. You only see this once per app.

That's it. 🎉

<details>
<summary>Prefer to set it up by hand?</summary>

Add this to your app's MCP settings:

```json
{
  "mcpServers": {
    "things": { "command": "npx", "args": ["-y", "things3pp"] }
  }
}
```

If your app can't find `npx`, use the full path. Run `which npx` in Terminal to find it.
</details>

---

## What it can do

| Ask about… | Change… |
|---|---|
| Today, Inbox, Upcoming, Anytime, Someday, Logbook | Add to-dos (with notes, dates, deadlines, tags, project) |
| A project or an area | Add projects with starter to-dos |
| Search by text | Edit, reschedule or move to-dos |
| Your projects, areas and tags | Complete, or reopen |

**It can't delete anything.** That's on purpose. It *can* edit to-dos (rename them, change notes and dates, move them), and most AI apps ask you before they make a change. If something gets marked as done by mistake, reopen it in one click.

---

## Using an AI app on a different computer

Maybe your AI app runs on a work laptop, a Linux box or a server, and Things is on your Mac at home. Here's how to connect them.

It works over [Tailscale](https://tailscale.com), a free app that connects your own devices through a private, encrypted network. Your Mac never opens up to the internet.

1. **Install Tailscale** on your Mac and on the other computer, and sign in on both with the same account.
2. **On your Mac**, run:
   ```bash
   npx -y things3pp serve
   ```
3. It prints a setup snippet for Claude Code, Codex, Cursor, VS Code and Claude Desktop. Copy the one for your app.
4. Get your access token by running this on your Mac, and put it where the snippet says `<YOUR_TOKEN>`:
   ```bash
   npx -y things3pp token
   ```
5. **Add it on the other computer:**
   - **Claude Code:** run the `claude mcp add …` command in a terminal.
   - **Codex:** paste the lines into `~/.codex/config.toml`.
   - **Cursor:** add the `"things"` entry inside `"mcpServers"` in `~/.cursor/mcp.json`.
   - **VS Code:** add the `"things"` entry inside `"servers"` in your `mcp.json`.
   - **Claude Desktop:** add the `"things"` entry inside `"mcpServers"` in `claude_desktop_config.json`.

Keep `serve` running while you use it. Things needs your Mac to be awake.

**How it stays safe:**
- It only listens on your private Tailscale network, never on your Wi-Fi or the open internet.
- Every request needs a long random password (an "access token"). It's created on your Mac, only your user account can read it, and it's never printed unless you ask for it.
- It turns away web pages and repeated wrong guesses.

Shared your token by accident? Run `npx -y things3pp token --rotate` and restart `serve`. The old token stops working.

---

## Troubleshooting

Run this first. It checks everything and tells you what to fix:

```bash
npx -y things3pp doctor
```

**"macOS blocked access to Things"**
Open **System Settings → Privacy & Security → Automation**. Find your AI app and switch on **Things3**.

**It hangs, then says Things didn't respond**
macOS is probably waiting for you to answer a permission prompt. It might be hidden behind other windows. Look for it, click OK, and try again.

**My AI app doesn't show the Things tools**
Restart the app fully (quit it, don't just close the window). Then run `doctor` to check it's set up.

**The list shows as text instead of the nice view**
Your app doesn't support interactive views yet. Everything still works, just as text.

---

## Privacy

- Runs entirely on your Mac and talks to Things directly. There are no servers, accounts or analytics.
- Only the AI app you connect sees your to-dos, and only when it asks.
- Remote access is off unless you run `serve`, and then it's limited to your own Tailscale devices.

## Commands

| Command | What it does |
|---|---|
| `npx -y things3pp setup` | Connect Things to the AI apps on this Mac |
| `npx -y things3pp doctor` | Check everything is working |
| `npx -y things3pp serve` | Share Things with your other computers (Tailscale) |
| `npx -y things3pp token --rotate` | Replace the remote access token |
