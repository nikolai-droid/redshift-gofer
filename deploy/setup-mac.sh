#!/usr/bin/env bash
#
# Set up the announcement bot on a Mac, running as a launchd service so it
# starts at login and restarts if it crashes.
#
#   git clone https://github.com/nikolai-droid/redshift-gofer.git
#   cd redshift-gofer
#   bash deploy/setup-mac.sh
#
# The bot token is asked for interactively and never leaves this machine.
set -euo pipefail

APP_DIR=${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
LABEL=${LABEL:-local.redshift.gofer}
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG=${LOG:-/tmp/redshift-gofer.log}

echo "==> Checking Node.js"
if ! command -v node >/dev/null 2>&1; then
  echo "    Node.js is not installed. Install it with:  brew install node" >&2
  echo "    (Homebrew must be installed first: https://brew.sh)" >&2
  exit 1
fi
NODE_BIN=$(command -v node)
NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "    Node $(node -v) is too old — version 18 or newer is required." >&2
  exit 1
fi
echo "    node $(node -v) at $NODE_BIN"

echo "==> Installing dependencies"
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund

echo "==> Preparing the configuration"
# The live config is kept out of git; seed it from the shipped default.
if [ ! -f "$APP_DIR/announce_config.json" ]; then
  cp "$APP_DIR/announce_config.default.json" "$APP_DIR/announce_config.json"
  echo "    created announce_config.json from the default"
fi

if [ ! -f "$APP_DIR/.env" ]; then
  echo
  echo "==> The bot token is missing. Enter it now (it never leaves this machine)."
  echo "    Both values are in the Discord Developer Portal → your app → General Information."
  printf '    Discord bot token: '
  read -r TOKEN
  printf '    Application ID:    '
  read -r APP_ID_VALUE
  {
    printf 'DISCORD_BOT_TOKEN=%s\n' "$TOKEN"
    printf 'DISCORD_APP_ID=%s\n' "$APP_ID_VALUE"
    # Blank means the bot registers its commands in every guild it is in.
    printf 'DISCORD_GUILD_ID=\n'
  } > "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo "    wrote .env"
else
  echo "    .env already exists, leaving it alone"
fi

echo "==> Installing the launchd service"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>bot.js</string>
  </array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
echo "    wrote $PLIST"

echo "==> Starting the bot"
# Unload first so a re-run of this script replaces the old job cleanly.
launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST"
launchctl enable "gui/$UID/$LABEL" 2>/dev/null || true

sleep 5
echo
echo "==> Status"
if launchctl print "gui/$UID/$LABEL" 2>/dev/null | grep -q "state = running"; then
  echo "    running"
elif launchctl print "gui/$UID/$LABEL" 2>/dev/null | grep -q "state = "; then
  echo "    loaded but not currently running — check the log below"
else
  echo "    NOT loaded — check the log below"
fi
echo
echo "Follow the log with:  tail -f $LOG"
echo "Stop it with:         launchctl bootout gui/$UID/$LABEL"
echo "Start it again with:  launchctl bootstrap gui/$UID $PLIST"
