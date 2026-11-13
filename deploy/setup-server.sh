#!/usr/bin/env bash
#
# Set up the announcement bot on a Linux server (Ubuntu 24.04 / Debian 12 /
# Oracle Linux). Run it from the folder that holds the project files:
#
#   scp -r redshift-gofer user@server:/tmp/
#   ssh user@server
#   cd /tmp/redshift-gofer && bash deploy/setup-server.sh
#
# It installs Node.js, creates a service account, installs the bot as a
# systemd service and starts it. Everything is free on the hosts in DEPLOY.md.
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/redshift-gofer}
SERVICE_USER=${SERVICE_USER:-redshift-bot}
NODE_MAJOR=${NODE_MAJOR:-22}
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Installing Node.js ${NODE_MAJOR}"
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1)" -lt 18 ]; then
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | sudo -E bash -
    sudo apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_${NODE_MAJOR}.x | sudo -E bash -
    sudo dnf install -y nodejs
  else
    echo "Unsupported package manager — install Node.js 18+ manually." >&2
    exit 1
  fi
fi
echo "    node $(node -v)"

echo "==> Creating the service account and app folder"
sudo useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER" 2>/dev/null || true
sudo mkdir -p "$APP_DIR"
sudo rsync -a --delete \
  --exclude node_modules --exclude .git --exclude .temp \
  --exclude .env --exclude announce_config.json \
  "$SRC_DIR"/ "$APP_DIR"/
sudo chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

echo "==> Installing dependencies"
cd "$APP_DIR"
sudo -u "$SERVICE_USER" npm ci --omit=dev --no-audit --no-fund

echo "==> Preparing the configuration"
# The live config is kept out of git; seed it from the shipped default.
if [ ! -f "$APP_DIR/announce_config.json" ]; then
  sudo cp "$APP_DIR/announce_config.default.json" "$APP_DIR/announce_config.json"
  echo "    created announce_config.json from the default"
fi

if [ ! -f "$APP_DIR/.env" ]; then
  echo
  echo "==> The bot token is missing. Enter it now (it never leaves this machine)."
  printf 'DISCORD_BOT_TOKEN: '
  read -r TOKEN
  sudo install -m 600 -o "$SERVICE_USER" -g "$SERVICE_USER" /dev/null "$APP_DIR/.env"
  printf 'DISCORD_BOT_TOKEN=%s\n' "$TOKEN" | sudo tee -a "$APP_DIR/.env" >/dev/null
  printf 'DISCORD_APP_ID=\n' | sudo tee -a "$APP_DIR/.env" >/dev/null
  printf 'DISCORD_GUILD_ID=\n' | sudo tee -a "$APP_DIR/.env" >/dev/null
  echo "    wrote .env"
else
  echo "    .env already exists, leaving it alone"
fi
sudo chown "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR/.env"
sudo chmod 600 "$APP_DIR/.env"

echo "==> Installing the systemd service"
sudo cp "$APP_DIR/deploy/redshift-gofer.service" /etc/systemd/system/redshift-gofer.service
sudo systemctl daemon-reload
sudo systemctl enable redshift-gofer
sudo systemctl restart redshift-gofer

sleep 3
echo
echo "==> Status"
sudo systemctl --no-pager --lines=15 status redshift-gofer || true
echo
echo "Follow the log with:  sudo journalctl -u redshift-gofer -f"
