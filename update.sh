#!/usr/bin/env bash
# Pull latest changes and restart the app.
# Run from the project root:  bash update.sh
set -euo pipefail

export PATH="$HOME/.bun/bin:$PATH"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

echo "--- Pulling latest changes ---"
git pull origin main

echo "--- Installing dependencies ---"
bun install --frozen-lockfile

echo "--- Restarting service ---"
sudo systemctl restart group-checklist

echo "--- Done ---"
sudo systemctl status group-checklist --no-pager
