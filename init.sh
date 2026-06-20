#!/usr/bin/env bash
# Full first-time setup for group-checklist on a fresh Ubuntu EC2 instance.
# Run from the project root:  bash init.sh
set -euo pipefail

# ── Helpers ────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "\n${GREEN}▶${NC} $1"; }
info() { echo -e "  ${BLUE}→${NC} $1"; }
warn() { echo -e "  ${YELLOW}!${NC} $1"; }
bail() { echo -e "\n${RED}✗ $1${NC}\n"; exit 1; }
pause(){ echo ""; read -rp "  Press Enter to continue..."; }

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="group-checklist"
DOMAIN="cheky.suryatmaja.dev"

echo -e "\n${GREEN}======================================${NC}"
echo -e "${GREEN}  group-checklist — EC2 init script  ${NC}"
echo -e "${GREEN}======================================${NC}"

# ── 1. System packages ─────────────────────────────────────────
log "Installing system packages (nginx, curl, git)..."
sudo apt-get update -y -q
sudo apt-get install -y -q nginx curl git unzip

# ── 2. Bun ────────────────────────────────────────────────────
if ! command -v bun &>/dev/null && [ ! -f "$HOME/.bun/bin/bun" ]; then
  log "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  grep -qxF 'export PATH="$HOME/.bun/bin:$PATH"' ~/.bashrc \
    || echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
else
  log "Bun already installed."
fi
export PATH="$HOME/.bun/bin:$PATH"
BUN="$HOME/.bun/bin/bun"
info "Bun $(bun --version)"

# ── 3. App dependencies ────────────────────────────────────────
log "Installing app dependencies..."
cd "$APP_DIR"
"$BUN" install --frozen-lockfile

# ── 4. Environment file ────────────────────────────────────────
log "Configuring environment..."
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo ""
  warn "Created .env from template. Fill in the values below:"
  info "DATABASE_URL  — your Neon connection string"
  info "JWT_SECRET    — run: openssl rand -hex 32"
  info "DB_SSL        — keep as 'prefer' for Neon"
  echo ""
  warn "Opening .env now. Save and exit with Ctrl+X → Y → Enter"
  pause
  nano "$APP_DIR/.env"
else
  log ".env already exists, skipping."
fi

# ── 5. Database migrations ────────────────────────────────────
log "Running database migrations..."
if "$BUN" scripts/migrate.ts; then
  info "Migrations complete."
else
  warn "Migration failed — check DATABASE_URL in .env then run: bun scripts/migrate.ts"
fi

# ── 6. Cloudflare Origin Certificate ─────────────────────────
log "Checking Cloudflare Origin Certificate..."
if [ ! -f /etc/ssl/cloudflare/cert.pem ] || [ ! -f /etc/ssl/cloudflare/key.pem ]; then
  echo ""
  warn "Certificate not found. Install it now:"
  info "1. Cloudflare dashboard → SSL/TLS → Origin Server → Create Certificate"
  info "2. Then run these commands (paste when prompted):"
  echo ""
  echo "     sudo mkdir -p /etc/ssl/cloudflare"
  echo "     sudo nano /etc/ssl/cloudflare/cert.pem    # paste Origin Certificate"
  echo "     sudo nano /etc/ssl/cloudflare/key.pem     # paste Private Key"
  echo "     sudo chmod 600 /etc/ssl/cloudflare/key.pem"
  echo ""
  warn "Press Enter once the certificate files are in place."
  pause
  [ -f /etc/ssl/cloudflare/cert.pem ] && [ -f /etc/ssl/cloudflare/key.pem ] \
    || bail "Certificate files still missing. Re-run init.sh after installing them."
fi
info "Certificate found."

# ── 7. Nginx ──────────────────────────────────────────────────
log "Configuring Nginx for $DOMAIN..."
NGINX_CONF="/etc/nginx/sites-available/$APP_NAME"
sudo cp "$APP_DIR/nginx/group-checklist.conf" "$NGINX_CONF"
sudo ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/$APP_NAME"
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t || bail "Nginx config test failed. Check /etc/nginx/sites-available/$APP_NAME"
sudo systemctl enable nginx
sudo systemctl reload nginx
info "Nginx configured."

# ── 8. Systemd service ────────────────────────────────────────
log "Installing systemd service..."
SERVICE_DEST="/etc/systemd/system/$APP_NAME.service"
# Substitute actual paths in case the user cloned somewhere other than ~/group-checklist
sed "s|/home/ubuntu/group-checklist|$APP_DIR|g
     s|/home/ubuntu/.bun/bin/bun|$BUN|g" \
  "$APP_DIR/systemd/group-checklist.service" | sudo tee "$SERVICE_DEST" > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable "$APP_NAME"
info "Service installed and enabled."

# ── 9. Start ──────────────────────────────────────────────────
log "Starting $APP_NAME..."
sudo systemctl restart "$APP_NAME"
sleep 2

if sudo systemctl is-active --quiet "$APP_NAME"; then
  echo ""
  echo -e "${GREEN}✔ App is running!${NC}"
else
  sudo systemctl status "$APP_NAME" --no-pager
  bail "Service failed to start. Check logs: journalctl -u $APP_NAME -f"
fi

# ── Done ──────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Setup complete                      ║${NC}"
echo -e "${GREEN}║  https://$DOMAIN    ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════╝${NC}"
echo ""
info "View logs:      journalctl -u $APP_NAME -f"
info "Restart app:    sudo systemctl restart $APP_NAME"
info "Deploy update:  bash scripts/deploy.sh"
echo ""
