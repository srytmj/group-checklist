# Deploy on AWS EC2

Runs the app on an EC2 instance with **Neon** as the default database. Swap to **AWS RDS** at any point by changing two env vars.

## Prerequisites

- An AWS account
- A cloned copy of this repo
- (Optional) A domain name pointed at your EC2 instance for HTTPS

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

## Part 2 — First-time server setup

```bash
# SSH into the instance
ssh -i your-key.pem ubuntu@YOUR_EC2_IP

# Clone the repo
git clone https://github.com/YOUR_USER/group-checklist.git ~/group-checklist

# Run the one-time setup (installs Bun, Nginx, Certbot)
cd ~/group-checklist
bash scripts/setup-ec2.sh
```

---

## Part 3 — Configure the app

```bash
cd ~/group-checklist
cp .env.example .env
nano .env
```

Minimum required changes in `.env`:

```env
# Generate a secret:  openssl rand -hex 32
JWT_SECRET=your-random-secret

# Neon connection string (from your Neon dashboard)
DATABASE_URL=postgresql://user:password@ep-xxx.neon.tech/dbname
DB_SSL=prefer
```

Then install dependencies and run the database migrations:

```bash
bun install
bun scripts/migrate.ts
```

---

## Part 4 — Set up Nginx and the systemd service

```bash
# Set your domain — or use the EC2 public IP if you have no domain
export DEPLOY_DOMAIN=yourdomain.com

# Install Nginx config + systemd service unit in one step
bash scripts/deploy.sh --nginx --service

# Start the app
sudo systemctl start group-checklist

# Verify
sudo systemctl status group-checklist
curl http://localhost:3000
```

---

## Part 5 — Enable HTTPS (requires a domain)

```bash
sudo certbot --nginx -d yourdomain.com

# Test auto-renewal
sudo certbot renew --dry-run
```

> Skip this step if you're accessing the app by IP address — Let's Encrypt requires a domain name.

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
