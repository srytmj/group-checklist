#!/usr/bin/env bash
# Deploy / update the app on EC2.
# Run from the project root:  bash scripts/deploy.sh [--nginx] [--service]
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN="${DEPLOY_DOMAIN:-YOUR_DOMAIN}"

# Bun is not on PATH when the script is run directly — resolve it explicitly
export PATH="$HOME/.bun/bin:$PATH"
BUN="${BUN:-$HOME/.bun/bin/bun}"

install_nginx() {
  echo "--- Configuring Nginx ---"
  NGINX_CONF="/etc/nginx/sites-available/group-checklist"
  # Replace placeholder domain in the template
  sed "s/YOUR_DOMAIN/$DOMAIN/g" "$APP_DIR/nginx/group-checklist.conf" | sudo tee "$NGINX_CONF" > /dev/null
  sudo ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/group-checklist
  sudo rm -f /etc/nginx/sites-enabled/default        # remove default page
  sudo nginx -t && sudo systemctl reload nginx
  echo "Nginx configured for: $DOMAIN"
}

install_service() {
  echo "--- Installing systemd service ---"
  sudo cp "$APP_DIR/systemd/group-checklist.service" /etc/systemd/system/group-checklist.service
  sudo systemctl daemon-reload
  sudo systemctl enable group-checklist
  echo "Service installed. Start with: sudo systemctl start group-checklist"
}

# ── Main: pull latest code, install deps, restart app ──────────
echo "=== Deploying group-checklist ==="
cd "$APP_DIR"

echo "--- Pulling latest changes ---"
git pull origin main

echo "--- Installing dependencies ---"
"$BUN" install --frozen-lockfile

# Handle flags
for arg in "$@"; do
  case $arg in
    --nginx)   install_nginx   ;;
    --service) install_service ;;
  esac
done

# Restart if the service is already installed
if systemctl is-active --quiet group-checklist 2>/dev/null; then
  echo "--- Restarting service ---"
  sudo systemctl restart group-checklist
  sleep 1
  sudo systemctl status group-checklist --no-pager
else
  echo "--- App not running as a service yet ---"
  echo "Run: sudo systemctl start group-checklist"
fi

echo "=== Deploy complete ==="
