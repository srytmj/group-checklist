# group-checklist

Realtime multi-user checklist app. Built with Bun, Hono, PostgreSQL, and Alpine.js.

**Live:** https://checky.suryatmaja.dev

## Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Framework | Hono v4 |
| Database | Neon PostgreSQL (cloud) · AWS RDS (optional) |
| Frontend | Vanilla HTML + Alpine.js 3 — no build step |
| Auth | JWT HS256 via native `crypto.subtle` |
| Realtime | WebSockets via `createBunWebSocket` |
| Hosting | AWS EC2 (Ubuntu 24.04) + Nginx + Cloudflare |

## Local development

```bash
bun install
cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET
bun run dev            # starts on http://localhost:3000
```

## Deployment

Currently deployed on AWS EC2 behind Cloudflare with a Neon PostgreSQL database.

Full setup guide: [docs/deploy-ec2.md](docs/deploy-ec2.md)

### Update the live server

After pushing code changes:

```bash
ssh -i your-key.pem ubuntu@54.159.2.129
cd ~/group-checklist && bash update.sh
```

`update.sh` pulls the latest code, installs dependencies, and restarts the service.

## Database migrations

Migrations live in [`migrations/001_init.sql`](migrations/001_init.sql). Run them with:

```bash
bun scripts/migrate.ts
```

Supports both Neon (`DB_SSL=prefer`) and RDS (`DB_SSL=require`) — set in `.env`.

## Scripts

| Script | Purpose |
|--------|---------|
| `bash init.sh` | First-time setup on a fresh EC2 instance |
| `bash update.sh` | Pull latest code and restart the service |
| `bash scripts/deploy.sh --nginx` | Re-apply Nginx config |
| `bash scripts/deploy.sh --service` | Re-install systemd service |
| `bun scripts/migrate.ts` | Run database migrations |
