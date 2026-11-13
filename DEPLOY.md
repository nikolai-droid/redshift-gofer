# Running the bot away from your laptop

The bot is a plain Node process (`node bot.js`), so any host that can run
Node 18+ and keep a long-lived outbound connection to Discord will do.
Two things matter:

1. **Discord needs a persistent connection.** Serverless platforms that
   freeze or kill idle processes (Cloudflare Workers, Lambda, Vercel) do
   not work without a rewrite. A small always-on server does.
2. **The configuration must survive a restart.** Free containers wipe
   their disk, so the live configuration (leader roles, ping roles,
   events, blocks) is mirrored into a Discord message and restored on
   startup.

---

## Option A — Render free tier (no card needed)

The cheapest card-free option that still runs 24/7.

### 1. Put the code on GitHub

```bash
cd /Users/nigelei/discord-migrator
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

The token in `.env` is **not** committed — `.gitignore` keeps it out.

### 2. Create the service

* Render → **New** → **Blueprint** → pick the repository. Render reads
  `render.yaml` and fills in the form.
* Fill in the secret values it asks for:
  * `DISCORD_BOT_TOKEN` — from the Discord Developer Portal.
  * `DISCORD_APP_ID` — same page.
  * `ANNOUNCE_CONFIG_CHANNEL_ID` — the id of a channel where the live
    configuration is stored. Create a private channel (for example
    `#bot-config`), paste its id here, and the bot will keep the
    configuration in it. The bot needs **View Channel**, **Send
    Messages** and **Manage Messages** there.
* Click **Apply**. The first build takes a couple of minutes.

### 3. Keep the free instance awake

Render shuts a free web service down after 15 minutes without inbound
traffic, and the Discord connection does not count. Pick one:

* **GitHub Actions (included)** — `.github/workflows/keepalive.yml`
  pings the bot every 10 minutes. Add a repository variable named
  `HEALTH_URL` with the value `https://redshift-gofer.onrender.com/health`
  (Settings → Secrets and variables → Actions → Variables). Minutes are
  free and unlimited on **public** repositories. On a private repository
  the included 2,000 minutes a month are not enough for a ping every 10
  minutes — use one of the two options below instead, or make the
  repository public (the bot token is not in it).
* **cron-job.org** — free, no account needed beyond the site, one
  request a minute. Point it at `https://redshift-gofer.onrender.com/health`.
* **UptimeRobot** — free tier checks every 5 minutes and emails you if
  the bot goes down.

### 4. Check it works

```bash
curl https://redshift-gofer.onrender.com/health
```

It should print `ok`. In Discord, `/announce` should work.

---

## Option B — A free Oracle Cloud VM (needs a card)

Oracle asks for a credit card at sign-up even on the free tier, so this
only works if you are willing to add one. Nothing is ever charged, but
the card is used to verify the account.

* Sign up for the Always Free tier and create a 1 OCPU / 1 GB ARM
  Ampere A1 instance (Ubuntu 24.04).
* Copy the project over and run the setup script:

```bash
scp -r redshift-gofer <you>@<server>:/tmp/
ssh <you>@<server>
cd /tmp/redshift-gofer && bash deploy/setup-server.sh
```

The script installs Node, creates a service account, installs the bot as
a systemd service with `Restart=always` and starts it. The token is
asked for interactively and never leaves the machine.

* Follow the log with `sudo journalctl -u redshift-gofer -f`.
* Update the code later with `bash deploy/update.sh`.

Two warnings: Oracle cut the free tier to 2 OCPUs / 12 GB in June 2026
and has reclaimed instances that sat idle, so an unused bot may be shut
off; and free ARM capacity in the popular regions is often sold out.

---

## Option C — Keep it on your Mac

Free and instant, but the bot only works while the Mac is awake and
online. To stop it dying when you close the terminal, install it as a
launchd service instead of running it in a window. The simplest version:

```bash
cd /Users/nigelei/discord-migrator
cat > ~/Library/LaunchAgents/local.redshift.gofer.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>local.redshift.gofer</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>bot.js</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/nigelei/discord-migrator</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/redshift-gofer.log</string>
  <key>StandardErrorPath</key><string>/tmp/redshift-gofer.log</string>
</dict>
</plist>
EOF
launchctl load ~/Library/LaunchAgents/local.redshift.gofer.plist
```

Check `node -v` for the right path to node first. Then set the Mac to
stay awake (System Settings → Battery → "Prevent automatic sleeping on
power adapter") or run `caffeinate -dimsu` in a terminal.

---

## Where the configuration lives

| Where | What it holds | Survives a restart? |
|---|---|---|
| `announce_config.json` | the live configuration | on a real server, yes |
| a Discord message | the same, gzipped and base64 encoded | yes, on every host |
| `announce_config.default.json` | the shipped defaults | in git, always |

When `ANNOUNCE_CONFIG_CHANNEL_ID` is set, every change made from
Discord with `/announce-config` or `/announce-access` is written to that
channel, and the bot restores it from there on startup. Without it, the
bot simply uses the file on disk.
