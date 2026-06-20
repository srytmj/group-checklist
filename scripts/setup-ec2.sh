#!/usr/bin/env bash
# One-time setup script for a fresh Ubuntu 22.04 / 24.04 EC2 instance.
# Run as the ubuntu user (not root):  bash scripts/setup-ec2.sh
set -euo pipefail

echo "=== [1/5] Updating packages ==="
sudo apt-get update -y && sudo apt-get upgrade -y

echo "=== [2/5] Installing Nginx + Certbot ==="
sudo apt-get install -y nginx certbot python3-certbot-nginx git curl unzip

echo "=== [3/5] Installing Bun ==="
curl -fsSL https://bun.sh/install | bash
BUN_PATH="$HOME/.bun/bin"
export PATH="$BUN_PATH:$PATH"
# Persist for future shells
grep -qxF "export PATH=\"$BUN_PATH:\$PATH\"" ~/.bashrc || echo "export PATH=\"$BUN_PATH:\$PATH\"" >> ~/.bashrc

echo "=== [4/5] Enabling Nginx to start on boot ==="
sudo systemctl enable nginx
sudo systemctl start nginx

echo "=== [5/5] Done! ==="
echo ""
echo "Next steps:"
echo "  1. Clone your repo:          git clone <repo-url> ~/group-checklist"
echo "  2. Enter the directory:      cd ~/group-checklist"
echo "  3. Copy env template:        cp .env.example .env && nano .env"
echo "  4. Install deps:             bun install"
echo "  5. Run migrations:           bun scripts/migrate.ts"
echo "  6. Set up Nginx:             bash scripts/deploy.sh --nginx"
echo "  7. Install systemd service:  bash scripts/deploy.sh --service"
echo "  8. Start the app:            sudo systemctl start group-checklist"
echo ""
echo "For HTTPS (requires a domain pointed at this server):"
echo "  sudo certbot --nginx -d YOUR_DOMAIN"
