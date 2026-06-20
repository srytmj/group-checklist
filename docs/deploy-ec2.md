# Deploy on AWS EC2

Setup guide for running group-checklist on AWS EC2 with Cloudflare for HTTPS and Neon as the database. AWS RDS is supported as an alternative database.

## Current deployment

| | |
|---|---|
| **URL** | https://checky.suryatmaja.dev |
| **Server** | AWS EC2 — Ubuntu 24.04 LTS, `54.159.2.129` |
| **Domain** | `checky.suryatmaja.dev` via Cloudflare (proxied, Full strict SSL) |
| **Database** | Neon PostgreSQL (`DB_SSL=prefer`) |
| **Process manager** | systemd — service name `group-checklist` |
| **Reverse proxy** | Nginx with Cloudflare Origin Certificate |

---

## Updating the live server

For every code change after the initial setup:

```bash
# Push from local machine
git push origin main

# Then SSH in and run
ssh -i your-key.pem ubuntu@54.159.2.129
cd ~/group-checklist && bash update.sh
```

`update.sh` does: `git pull` → `bun install` → `sudo systemctl restart group-checklist`.

---

## First-time setup (fresh EC2 instance)

Follow these parts in order to set up from scratch.

### Part 1 — Launch the EC2 instance

1. AWS Console → **EC2 → Launch Instance**
2. OS: **Ubuntu 24.04 LTS**
3. Instance type: **t3.small** (recommended) or t2.micro (free tier)
4. Create or select a **key pair** (.pem file) — needed to SSH in
5. Security group — add inbound rules:

   | Type  | Port | Source    |
   |-------|------|-----------|
   | SSH   | 22   | Your IP   |
   | HTTP  | 80   | 0.0.0.0/0 |
   | HTTPS | 443  | 0.0.0.0/0 |

6. Allocate an **Elastic IP** and associate it with the instance — prevents the IP from changing on reboot

---

### Part 2 — Cloudflare setup (do this before SSH)

#### 2a — Add DNS record

Cloudflare dashboard → `suryatmaja.dev` → **DNS → Records → Add record**:

| Field | Value |
|-------|-------|
| Type | A |
| Name | `checky` (or your subdomain) |
| IPv4 address | your EC2 Elastic IP |
| Proxy status | Proxied — orange cloud ☁ |
| TTL | Auto |

#### 2b — Set SSL/TLS mode

Cloudflare dashboard → **SSL/TLS → Overview** → select **Full (strict)**

> Do not use Flexible — it sends traffic to EC2 over plain HTTP.

#### 2c — Create Origin Certificate

1. Cloudflare dashboard → **SSL/TLS → Origin Server → Create Certificate**
2. Leave defaults (RSA 2048, covers `*.suryatmaja.dev`) → click **Create**
3. Copy both values — shown only once:
   - **Origin Certificate** → will go into `/etc/ssl/cloudflare/cert.pem`
   - **Private Key** → will go into `/etc/ssl/cloudflare/key.pem`

Keep these in a text editor — `init.sh` will prompt you to install them on the server.

---

### Part 3 — SSH in, clone, and run init.sh

```bash
# SSH in
ssh -i your-key.pem ubuntu@YOUR_EC2_IP

# Clone the repo
git clone https://github.com/srytmj/group-checklist.git ~/group-checklist
cd ~/group-checklist

# Run the interactive setup script
bash init.sh
```

`init.sh` walks through all steps interactively:

1. Installs Nginx and Bun
2. Runs `bun install`
3. Prompts for `DATABASE_URL` and `JWT_SECRET`, writes `.env` automatically
4. Runs database migrations
5. Displays Cloudflare cert installation instructions, then waits
6. Configures Nginx for `checky.suryatmaja.dev`
7. Installs and starts the systemd service
8. Prints the live URL when done

---

### Part 4 — Verify the deployment

```bash
# Service status
sudo systemctl status group-checklist

# Live logs
journalctl -u group-checklist -f

# Test locally on the server
curl http://localhost:3000
```

Visit **https://checky.suryatmaja.dev** — you should see a padlock and the app.

---

## Switching to AWS RDS (optional)

By default the app uses Neon. To switch to RDS:

### Create the RDS instance

1. AWS Console → **RDS → Create database**
   - Engine: PostgreSQL 16
   - Master username: `postgres`
   - Note the endpoint after creation: `your-db.xxxx.us-east-1.rds.amazonaws.com`

2. RDS security group → add inbound rule:
   - Type: PostgreSQL, Port: 5432, Source: EC2 security group ID

### Update the app

```bash
# On EC2
nano ~/group-checklist/.env
```

```env
DATABASE_URL=postgresql://postgres:yourpassword@your-db.xxxx.us-east-1.rds.amazonaws.com:5432/group_checklist
DB_SSL=require
```

```bash
bun scripts/migrate.ts
sudo systemctl restart group-checklist
```

---

## Common commands on the server

```bash
# View live logs
journalctl -u group-checklist -f

# Restart the app
sudo systemctl restart group-checklist

# Check Nginx config
sudo nginx -t

# Reload Nginx (after config change)
sudo systemctl reload nginx

# Re-apply Nginx config from repo
bash scripts/deploy.sh --nginx
```

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3000` | Port the Bun server listens on |
| `NODE_ENV` | No | — | Set to `production` on the server |
| `JWT_SECRET` | Yes | — | HS256 signing secret — minimum 32 chars |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `DB_SSL` | No | `prefer` | `prefer` (Neon) · `require` (RDS) · `disable` (local) |

---

## Files in this repo for deployment

| File | Purpose |
|------|---------|
| `init.sh` | Interactive first-time setup for a fresh EC2 instance |
| `update.sh` | Pull latest code and restart the service |
| `.env.example` | Environment variable template |
| `nginx/group-checklist.conf` | Nginx reverse proxy config — HTTPS + WebSocket support |
| `systemd/group-checklist.service` | systemd unit — auto-restart on crash, starts on boot |
| `scripts/deploy.sh` | Lower-level deploy script — supports `--nginx` and `--service` flags |
| `scripts/migrate.ts` | Runs `migrations/001_init.sql` against `DATABASE_URL` |
| `scripts/setup-ec2.sh` | Installs system packages only (Nginx, Bun) — called by `init.sh` |
