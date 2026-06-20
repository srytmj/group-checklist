# group-checklist

Realtime multi-user checklist app. Built with Bun, Hono, PostgreSQL, and Alpine.js.

## Stack

- **Runtime** — Bun
- **Framework** — Hono v4
- **Database** — Neon PostgreSQL (or AWS RDS — see [deploy guide](docs/deploy-ec2.md))
- **Frontend** — Vanilla HTML + Alpine.js 3 (no build step)
- **Auth** — JWT HS256 via native `crypto.subtle`
- **Realtime** — WebSockets via `createBunWebSocket`

## Local development

```bash
bun install
cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET
bun run dev
```

## Deploy

| Platform | Guide |
|----------|-------|
| AWS EC2  | [docs/deploy-ec2.md](docs/deploy-ec2.md) |
| Fly.io   | See `fly.toml` — auto-deploy on `git push` via Fly.io dashboard |

## Database migrations

Migrations live in `migrations/001_init.sql`. Run them with:

```bash
bun scripts/migrate.ts
```

Works against both Neon and RDS — controlled by the `DB_SSL` env var in `.env`.
