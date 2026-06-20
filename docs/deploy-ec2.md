# Deploy on AWS EC2

Runs the app on an EC2 instance with **Neon** as the default database. Swap to **AWS RDS** at any point by changing two env vars.

Live at: **https://checky.suryatmaja.dev**

## Prerequisites

- An AWS account
- A cloned copy of this repo
- Domain managed in Cloudflare (for HTTPS — see [Part 5](#part-5--https-via-cloudflare-origin-certificate))

---

## Part 1 — Launch the EC2 instance

1. Go to **AWS Console → EC2 → Launch Instance**
2. Choose **Ubuntu 24.04 LTS**
3. Instance type: **t3.small** (recommended) or t2.micro (free tier, tight on RAM)
4. Create or select a **key pair** (.pem) — you'll need it to SSH in
5. **Security group** — add these inbound rules:

   | Type  | Port | Source    |
   |-------|------|-----------|
   | SSH   | 22   | Your IP   |
   | HTTP  | 80   | 0.0.0.0/0 |
   | HTTPS | 443  | 0.0.0.0/0 |

6. (Recommended) Allocate an **Elastic IP** and associate it with the instance — prevents the IP from changing on reboots

---

## Part 2 — Before you SSH in: Cloudflare setup

Do this in the Cloudflare dashboard **before** running the init script so DNS is ready.

### 2a — Add DNS record

Cloudflare dashboard → `suryatmaja.dev` → **DNS → Add record**:

| Field        | Value                  |
|--------------|------------------------|
| Type         | A                      |
| Name         | cheky                  |
| IPv4 address | your EC2 Elastic IP    |
| Proxy status | Proxied (orange cloud) |

### 2b — Set SSL mode

Cloudflare dashboard → **SSL/TLS → Overview** → select **Full (strict)**

> Do not use "Flexible" — it sends traffic to EC2 unencrypted.

### 2c — Create Origin Certificate

1. Cloudflare dashboard → **SSL/TLS → Origin Server → Create Certificate**
2. Leave defaults (RSA 2048, `*.suryatmaja.dev`) → click **Create**
3. Copy both values — you only see them once:
   - **Origin Certificate** → you'll paste this into `cert.pem`
   - **Private Key** → you'll paste this into `key.pem`

Keep these in a text editor — `init.sh` will prompt you to install them.

---

## Part 3 — SSH in, clone, and run init.sh

```bash
# SSH into the instance
ssh -i your-key.pem ubuntu@YOUR_EC2_IP

# Clone the repo
git clone https://github.com/YOUR_USER/group-checklist.git ~/group-checklist
cd ~/group-checklist

# Run the init script — walks you through everything interactively
bash init.sh
```

`init.sh` will:

1. Install Nginx and Bun
2. Run `bun install`
3. Create `.env` from the template and open it for editing (fill in `DATABASE_URL` and `JWT_SECRET`)
4. Run database migrations
5. Pause and prompt you to install the Cloudflare Origin Certificate
6. Configure Nginx for `checky.suryatmaja.dev`
7. Install and start the systemd service
8. Print the live URL when done

---

## Part 4 — Set up Nginx and the systemd service (manual alternative)

If you prefer to run each step yourself instead of using `init.sh`:

```bash
# Install Nginx config + systemd service unit in one step
bash scripts/deploy.sh --nginx --service

# Start the app
sudo systemctl start group-checklist

# Verify
sudo systemctl status group-checklist
curl http://localhost:3000
```

---

## Part 6 (optional) — Switch to AWS RDS

### Create the RDS instance

1. **AWS Console → RDS → Create database**
   - Engine: **PostgreSQL 16**
   - Master username: `postgres` (or anything you prefer)
   - Note the **endpoint** shown after creation (e.g. `your-db.xxxx.us-east-1.rds.amazonaws.com`)

2. **Security group for RDS** — add one inbound rule:
   - Type: PostgreSQL, Port: 5432, Source: **the security group ID of your EC2 instance**

### Point the app at RDS

SSH into the EC2 instance and edit `.env`:

```bash
nano ~/group-checklist/.env
```

```env
DATABASE_URL=postgresql://postgres:yourpassword@your-db.xxxx.us-east-1.rds.amazonaws.com:5432/group_checklist
DB_SSL=require
```

Run migrations against the new database and restart:

```bash
cd ~/group-checklist
bun scripts/migrate.ts
sudo systemctl restart group-checklist
```

---

## Part 7 — Ongoing deploys

Every time you push new code, SSH in and run:

```bash
ssh -i your-key.pem ubuntu@YOUR_EC2_IP
cd ~/group-checklist && bash scripts/deploy.sh
```

The script pulls the latest code, installs dependencies, and restarts the service automatically.

---

## Environment variables reference

| Variable       | Required | Default   | Description |
|----------------|----------|-----------|-------------|
| `PORT`         | No       | `3000`    | Port the Bun server listens on |
| `NODE_ENV`     | No       | —         | Set to `production` in prod |
| `JWT_SECRET`   | Yes      | —         | HS256 signing secret (min 32 chars) |
| `DATABASE_URL` | Yes      | —         | PostgreSQL connection string |
| `DB_SSL`       | No       | `prefer`  | `prefer` (Neon), `require` (RDS), `disable` (local) |

---

## Files added by this setup

| File | Purpose |
|------|---------|
| `.env.example` | Environment variable template |
| `scripts/setup-ec2.sh` | One-time server setup — run once after first launch |
| `scripts/deploy.sh` | Pull + install + restart; also installs Nginx/service when flagged |
| `scripts/migrate.ts` | Runs `migrations/001_init.sql` against `DATABASE_URL` |
| `nginx/group-checklist.conf` | Nginx reverse proxy config with WebSocket support |
| `systemd/group-checklist.service` | systemd unit — auto-restart on crash, starts on boot |
