# things3pp: Things for AI apps and the web

Talk to your [Things 3](https://culturedcode.com/things/) to-dos from **Claude, Codex, ChatGPT, Cursor, VS Code** and other AI apps.

> *"What's on my plate today?"*
> *"Add 'renew passport' with a deadline next Friday."*
> *"Move everything tagged errand to tomorrow."*
> *"Make a project for the kitchen remodel with a few starter tasks."*

In apps that support it (Claude, ChatGPT, VS Code, Goose and others), your lists appear **right in the chat, styled like Things**. You can tick items off there, and they're ticked off in Things too.

Want Things in a **browser** (on any computer or phone), or in **Claude.ai / ChatGPT on the web**? See [Your own hosted Things](#your-own-hosted-things-web-app--remote-mcp) below.

---

## Get started (2 minutes)

**You need:** a Mac with Things 3, plus [Node.js](https://nodejs.org) 20 or newer.

**1. Run setup in Terminal:**

```bash
npx -y things3pp mcp setup
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
    "things": { "command": "npx", "args": ["-y", "things3pp", "mcp"] }
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
   npx -y things3pp mcp serve
   ```
3. It prints a setup snippet for Claude Code, Codex, Cursor, VS Code and Claude Desktop. Copy the one for your app.
4. Get your access token by running this on your Mac, and put it where the snippet says `<YOUR_TOKEN>`:
   ```bash
   npx -y things3pp mcp token
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

Shared your token by accident? Run `npx -y things3pp mcp token --rotate` and restart `serve`. The old token stops working.

---

## Troubleshooting

Run this first. It checks everything and tells you what to fix:

```bash
npx -y things3pp mcp doctor
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

## Your own hosted Things (web app + remote MCP)

Put a Things-style web app and a remote MCP server on **your own Cloudflare account** (the free plan is enough). Your Mac stays the source of truth: it keeps a secure connection open to your deployment and sends changes both ways.

- 🖥️ A calm, Mac-like web app: Inbox, Today (with This Evening), Upcoming, Anytime, Someday, Logbook, projects with headings, areas, tags, checklists, deadlines, Quick Find, keyboard shortcuts, dark mode, and a phone layout.
- 🤖 A remote MCP server for Claude.ai, ChatGPT and other cloud AI apps.
- 🔑 Sign in with a passkey (Touch ID / Face ID). No passwords, no third-party login.

**You need:** the Mac with Things, Node.js 22+, and the [Cloudflare CLI](https://developers.cloudflare.com/cf/get-started/) (`npm install -g cf`, then `cf auth login`).

```bash
npx -y things3pp cloud deploy --domain things.example.com   # your Cloudflare account; --domain is optional
```

Then connect your Mac. **The easy way is the things3pp Mac app** ([download](https://github.com/PaulAshraf/things3-plus-plus/releases?q=mac-v)): open it, click **Sign in**, create your passkey, and allow it to control Things. It walks you through the rest with live checkmarks and starts at login.

It works right away in **basic mode** (lists, projects, areas, tags, dates). To add checklists, headings and This Evening, it guides you through two optional steps: give it access to Things' data, and turn on **Enable Things URLs** in Things → Settings → General.

<details>
<summary>Prefer Terminal?</summary>

```bash
npm install -g things3pp     # the background agent needs a permanent install
things3pp connect            # links this Mac and creates your passkey
things3pp agent install      # keeps this Mac connected, even after restarts
```

For full detail, give the `node` that `agent install` prints Full Disk Access. The Mac app can take over this link later ("Use That Link").
</details>

To use it from Claude.ai or ChatGPT, add `https://<your-worker>.workers.dev/mcp` as a custom connector. You'll approve it with your passkey. Settings in the web app shows the exact address.

**Good to know**

- Your Mac needs to be awake and online for changes. While it sleeps, the web app still shows your lists from the last sync, with a small "offline" note.
- A copy of your to-dos is stored in your own Cloudflare account (a Durable Object), so the app loads instantly. Nobody else's servers are involved.
- Lost all your passkeys? Run `things3pp connect` again on your linked Mac to add a new one.
- Reordering by drag and drop isn't possible yet: Things doesn't let other apps change the order. You can drag to-dos onto lists, projects and areas in the sidebar.
- Nothing can be deleted from the web app or by AI apps. Use Things on your Mac for that.

## Privacy

- The MCP server runs on your Mac and talks to Things directly. There are no servers of ours, accounts or analytics.
- Only the AI app you connect sees your to-dos, and only when it asks.
- Remote access is off unless you run `mcp serve` (your own Tailscale devices only) or deploy your own hosted Things (your Cloudflare account, passkey sign-in).

## Commands

| Command | What it does |
|---|---|
| `npx -y things3pp mcp setup` | Connect Things to the AI apps on this Mac |
| `npx -y things3pp mcp doctor` | Check the local MCP setup |
| `npx -y things3pp mcp serve` | Share Things with your other computers (Tailscale) |
| `npx -y things3pp mcp token --rotate` | Replace the Tailscale access token |
| `things3pp cloud deploy [--domain <host>] [--shared]` | Deploy (or update) your own hosted Things on Cloudflare |
| `things3pp cloud status` / `open` | Show or open your hosted Things |
| `things3pp connect` | Link this Mac (or add a new passkey if it's already linked) |
| `things3pp disconnect` | Unlink this Mac and delete its device key |
| `things3pp agent install` / `uninstall` / `status` | Keep this Mac connected in the background |
| `things3pp doctor` | Check everything, including the hosted setup |

Older versions used `things3pp setup`, `serve` and `token` without `mcp`. Those still work and point you to the new spelling. AI app configs that start `things3pp` with no arguments keep working too.
