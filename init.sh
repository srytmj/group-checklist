#!/usr/bin/env bash
# Full first-time setup for group-checklist on a fresh Ubuntu EC2 instance.
# Run from the project root:  bash init.sh
set -euo pipefail

# ── Helpers ────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
log()   { echo -e "\n${GREEN}▶${NC} ${BOLD}$1${NC}"; }
info()  { echo -e "  ${BLUE}→${NC} $1"; }
warn()  { echo -e "  ${YELLOW}⚠${NC}  $1"; }
bail()  { echo -e "\n${RED}✗ $1${NC}\n"; exit 1; }
hr()    { echo -e "  ${BLUE}────────────────────────────────────────${NC}"; }
prompt(){ echo -e "  ${CYAN}?${NC}  $1"; }

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="group-checklist"
DOMAIN="cheky.suryatmaja.dev"

clear
echo -e "${GREEN}${BOLD}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║       group-checklist · EC2 setup        ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"

# ── 1. System packages ─────────────────────────────────────────
log "Installing system packages..."
sudo apt-get update -y -q
sudo apt-get install -y -q nginx curl git unzip
info "nginx, curl, git installed."

# ── 2. Bun ─────────────────────────────────────────────────────
if ! command -v bun &>/dev/null && [ ! -f "$HOME/.bun/bin/bun" ]; then
  log "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  grep -qxF 'export PATH="$HOME/.bun/bin:$PATH"' ~/.bashrc \
    || echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
fi
export PATH="$HOME/.bun/bin:$PATH"
BUN="$HOME/.bun/bin/bun"
log "Bun ready."
info "version: $("$BUN" --version)"

# ── 3. App dependencies ────────────────────────────────────────
log "Installing app dependencies..."
cd "$APP_DIR"
"$BUN" install --frozen-lockfile
info "Dependencies installed."

# ── 4. Environment configuration ──────────────────────────────
log "Setting up environment variables..."
echo ""

if [ -f "$APP_DIR/.env" ]; then
  warn ".env already exists — skipping env setup."
  info "Edit it manually if needed: nano $APP_DIR/.env"
else
  hr
  echo -e "  ${BOLD}Database configuration${NC}"
  hr
  echo ""
  echo "  This app supports two database options:"
  echo ""
  echo -e "  ${CYAN}[1]${NC} Neon PostgreSQL   (managed cloud DB — default)"
  echo -e "  ${CYAN}[2]${NC} AWS RDS            (self-hosted on AWS)"
  echo ""
  prompt "Choose database type [1/2, default: 1]:"
  read -r DB_CHOICE
  DB_CHOICE="${DB_CHOICE:-1}"

  echo ""
  if [ "$DB_CHOICE" = "2" ]; then
    echo "  RDS connection string format:"
    echo -e "  ${BLUE}postgresql://username:password@your-db.xxxx.us-east-1.rds.amazonaws.com:5432/group_checklist${NC}"
    echo ""
    DB_SSL_DEFAULT="require"
  else
    echo "  Neon connection string — find it in your Neon dashboard:"
    echo -e "  ${BLUE}https://console.neon.tech${NC} → your project → Connection Details"
    echo -e "  Format: ${BLUE}postgresql://user:password@ep-xxx.neon.tech/dbname${NC}"
    echo ""
    DB_SSL_DEFAULT="prefer"
  fi

  prompt "Paste your DATABASE_URL:"
  read -r DATABASE_URL
  [ -z "$DATABASE_URL" ] && bail "DATABASE_URL cannot be empty."

  echo ""
  hr
  echo -e "  ${BOLD}JWT Secret${NC}"
  hr
  echo ""
  echo "  Used to sign login tokens. Must be at least 32 characters."
  echo ""
  echo -e "  ${CYAN}[1]${NC} Auto-generate a secure secret (recommended)"
  echo -e "  ${CYAN}[2]${NC} Enter my own"
  echo ""
  prompt "Choose [1/2, default: 1]:"
  read -r JWT_CHOICE
  JWT_CHOICE="${JWT_CHOICE:-1}"

  if [ "$JWT_CHOICE" = "2" ]; then
    prompt "Enter JWT_SECRET:"
    read -r JWT_SECRET
    [ -z "$JWT_SECRET" ] && bail "JWT_SECRET cannot be empty."
  else
    JWT_SECRET="$(openssl rand -hex 32)"
    info "Generated JWT_SECRET: ${YELLOW}${JWT_SECRET}${NC}"
    warn "Save this value — you'll need it if you ever need to re-create the .env."
  fi

  echo ""

  # Write .env
  cat > "$APP_DIR/.env" <<ENVEOF
# ── Application ──────────────────────────────────────────────
PORT=3000
NODE_ENV=production
JWT_SECRET=${JWT_SECRET}

# ── Database ──────────────────────────────────────────────────
DATABASE_URL=${DATABASE_URL}
DB_SSL=${DB_SSL_DEFAULT}
ENVEOF

  info ".env written to $APP_DIR/.env"
fi

# ── 5. Database migrations ─────────────────────────────────────
log "Running database migrations..."
if "$BUN" scripts/migrate.ts; then
  info "Migrations complete."
else
  warn "Migration failed — check DATABASE_URL in .env then re-run: bun scripts/migrate.ts"
fi

# ── 6. Cloudflare domain setup ─────────────────────────────────
log "Domain & HTTPS setup..."
echo ""
hr
echo -e "  ${BOLD}How to connect your Cloudflare domain${NC}"
hr
echo ""
echo -e "  Your app will be served at: ${CYAN}https://${DOMAIN}${NC}"
echo ""
echo -e "  ${BOLD}Step 1 — Add DNS record in Cloudflare${NC}"
echo "  ┌─────────────┬──────────────────────────────────┐"
echo "  │ Type        │ A                                │"
echo "  │ Name        │ cheky                            │"
echo "  │ IPv4        │ $(curl -s ifconfig.me 2>/dev/null || echo 'your EC2 Elastic IP')              │"
echo "  │ Proxy       │ Proxied ☁  (orange cloud)       │"
echo "  └─────────────┴──────────────────────────────────┘"
echo ""
echo -e "  ${BOLD}Step 2 — Set SSL/TLS mode${NC}"
echo "  Cloudflare dashboard → SSL/TLS → Overview"
echo -e "  Select: ${YELLOW}Full (strict)${NC}   ← not Flexible, not Full"
echo ""
echo -e "  ${BOLD}Step 3 — Create Origin Certificate${NC}"
echo "  Cloudflare dashboard → SSL/TLS → Origin Server → Create Certificate"
echo "  Leave defaults → click Create → copy both values:"
echo -e "    ${CYAN}Origin Certificate${NC}  → paste into /etc/ssl/cloudflare/cert.pem"
echo -e "    ${CYAN}Private Key${NC}         → paste into /etc/ssl/cloudflare/key.pem"
echo ""
echo -e "  ${BOLD}Step 4 — Install the certificate on this server${NC}"
echo "  Run these commands after getting the cert from Cloudflare:"
echo ""
echo -e "  ${YELLOW}  sudo mkdir -p /etc/ssl/cloudflare${NC}"
echo -e "  ${YELLOW}  sudo nano /etc/ssl/cloudflare/cert.pem   # paste Origin Certificate${NC}"
echo -e "  ${YELLOW}  sudo nano /etc/ssl/cloudflare/key.pem    # paste Private Key${NC}"
echo -e "  ${YELLOW}  sudo chmod 600 /etc/ssl/cloudflare/key.pem${NC}"
echo ""
hr
echo ""

prompt "Have you installed the cert at /etc/ssl/cloudflare/? [y/N]:"
read -r CERT_READY
CERT_READY="${CERT_READY:-n}"

if [[ "$CERT_READY" =~ ^[Yy]$ ]]; then
  [ -f /etc/ssl/cloudflare/cert.pem ] && [ -f /etc/ssl/cloudflare/key.pem ] \
    || bail "Certificate files not found at /etc/ssl/cloudflare/. Install them and re-run init.sh."
  SETUP_NGINX=true
else
  warn "Skipping Nginx HTTPS setup — run 'bash scripts/deploy.sh --nginx' after installing the cert."
  SETUP_NGINX=false
fi

# ── 7. Nginx ───────────────────────────────────────────────────
if [ "$SETUP_NGINX" = true ]; then
  log "Configuring Nginx for $DOMAIN..."
  NGINX_CONF="/etc/nginx/sites-available/$APP_NAME"
  sudo cp "$APP_DIR/nginx/group-checklist.conf" "$NGINX_CONF"
  sudo ln -sf "$NGINX_CONF" "/etc/nginx/sites-enabled/$APP_NAME"
  sudo rm -f /etc/nginx/sites-enabled/default
  sudo nginx -t || bail "Nginx config test failed. Check $NGINX_CONF"
  sudo systemctl enable nginx
  sudo systemctl reload nginx
  info "Nginx configured."
fi

# ── 8. Systemd service ─────────────────────────────────────────
log "Installing systemd service..."
SERVICE_DEST="/etc/systemd/system/$APP_NAME.service"
sed "s|/home/ubuntu/group-checklist|$APP_DIR|g
     s|/home/ubuntu/.bun/bin/bun|$BUN|g" \
  "$APP_DIR/systemd/group-checklist.service" | sudo tee "$SERVICE_DEST" > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable "$APP_NAME"
info "Service installed and enabled."

# ── 9. Start ───────────────────────────────────────────────────
log "Starting $APP_NAME..."
sudo systemctl restart "$APP_NAME"
sleep 2

if sudo systemctl is-active --quiet "$APP_NAME"; then
  info "App is running."
else
  sudo systemctl status "$APP_NAME" --no-pager
  bail "Service failed to start. Check logs: journalctl -u $APP_NAME -f"
fi

# ── Done ───────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║  ✔  Setup complete!                      ║"
if [ "$SETUP_NGINX" = true ]; then
echo "  ║     https://${DOMAIN}   ║"
else
echo "  ║     App running on port 3000             ║"
echo "  ║     Finish HTTPS setup, then run:        ║"
echo "  ║     bash scripts/deploy.sh --nginx       ║"
fi
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"
info "View logs:      journalctl -u $APP_NAME -f"
info "Restart app:    sudo systemctl restart $APP_NAME"
info "Deploy update:  bash scripts/deploy.sh"
echo ""
