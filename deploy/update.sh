#!/usr/bin/env bash
#
# Update the bot on the server after a code change:
#
#   git pull            (in the local project, then push — see DEPLOY.md)
#   scp -r ... user@server:/opt/redshift-gofer/   or  ssh + git pull
#   bash deploy/update.sh
#
# The live configuration (announce_config.json) and the token (.env) are
# left untouched.
set -euo pipefail

APP_DIR=${APP_DIR:-/opt/redshift-gofer}
SERVICE_USER=${SERVICE_USER:-redshift-bot}
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Copying the new code"
sudo rsync -a --delete \
  --exclude node_modules --exclude .git --exclude .temp \
  --exclude .env --exclude announce_config.json \
  "$SRC_DIR"/ "$APP_DIR"/
sudo chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

echo "==> Installing dependencies"
cd "$APP_DIR"
sudo -u "$SERVICE_USER" npm ci --omit=dev --no-audit --no-fund

echo "==> Restarting the bot"
sudo systemctl restart redshift-gofer
sleep 3
sudo systemctl --no-pager --lines=15 status redshift-gofer || true
