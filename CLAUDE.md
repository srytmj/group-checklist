# group-checklist

Realtime multi-user checklist app. Bun + Hono + PostgreSQL (Neon) + Alpine.js.
Deployed on Fly.io (app: `group-checklist`, region: `ams`).

## Stack

- **Runtime**: Bun
- **Framework**: Hono v4.7.0
- **DB**: Neon PostgreSQL via `postgres` npm driver, `ssl: "prefer"`
- **Frontend**: Vanilla HTML + Alpine.js 3 + Vanilla JS (no build step)
- **Auth**: JWT HS256 via native `crypto.subtle` (NOT hono/jwt — incompatible with Bun)
- **WS**: `createBunWebSocket` from `hono/bun`

## Project structure

```
src/
  index.ts          # Entry point, WS handler, static serve
  db.ts             # Postgres connection (ssl: "prefer")
  ws.ts             # rooms Map + broadcastToRoom()
  types.ts          # AppEnv, User types
  routes/
    auth.ts         # Register, login, logout, /me + authMiddleware
    projects.ts     # CRUD projects
    items.ts        # CRUD items, PICs, completions, reorder
    logs.ts         # Audit log with cursor pagination
  middleware/
    logger.ts       # requestMeta middleware + writeLog()
  lib/
    access.ts       # getProject(), canAccess(), isOwner()
public/
  index.html        # Alpine.js SPA, light/dark theme
  app.js            # Alpine data, API calls, WS event handlers
migrations/
  001_init.sql      # Full schema
Dockerfile
fly.toml
```

## Auth (CRITICAL)

`hono/jwt` does NOT work in Bun — silently fails on verify. Auth is implemented manually:

- JWT sign/verify in `src/routes/auth.ts` using `crypto.subtle` HMAC-SHA256
- Cookie: httpOnly, SameSite=Lax, 30 days, `Secure` in production
- Cookie read: `c.req.header("cookie")` with regex parser — do NOT use `hono/cookie`
- Login/register return raw `Response` (not `c.json()`) to set `Set-Cookie` header
- Frontend: `credentials: 'include'` on all fetch calls

## Database

Neon PostgreSQL. Migrations run manually via Neon SQL Editor (no migration tool).
Schema in `migrations/001_init.sql`.

Key tables: `users`, `projects`, `checklist_items`, `item_pics`, `item_completions`, `audit_logs`.

## Alpine.js reactivity (CRITICAL)

Never mutate array item properties in place. Always replace the entire item object:

```js
// WRONG - Alpine won't detect
this.items[idx].completion = data;
this.items[idx].pics.push(pic);

// CORRECT
this.items[idx] = { ...this.items[idx], completion: data };
this.items[idx] = { ...this.items[idx], pics: [...this.items[idx].pics, pic] };
```

This applies to: completion, pics, and any other nested property.

## SQL gotchas

`FILTER (WHERE ...)` only works with aggregate functions. For non-aggregates use `CASE WHEN`:

```sql
-- WRONG
jsonb_build_object(...) FILTER (WHERE ic.id IS NOT NULL)

-- CORRECT
CASE WHEN ic.id IS NOT NULL THEN jsonb_build_object(...) END
```

## WebSocket

- Room per project slug, `Map<string, Set<ServerWebSocket>>`
- `broadcastToRoom(slug, payload)` in `src/ws.ts`
- Client reconnects after 3s on close, heartbeat ping every 25s
- Events: `item.created`, `item.updated`, `item.deleted`, `item.reordered`, `item.completed`, `item.uncompleted`, `item.pic_added`, `item.pic_removed`, `project.updated`, `project.deleted`

## Fly.io deploy

Auto-deploy on git push (configured via Fly.io web dashboard).
Env vars set in Fly.io dashboard: `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production`, `PORT=8080`.

No GitHub Actions needed — Fly.io handles CI/CD.

## Development

```bash
bun install
bun run dev    # or: bun src/index.ts
```

No `.env` file in repo. Set env vars locally or use `.env` (gitignored).

## Known patterns

- `getProject(slug)` returns project row or undefined — check before use
- `canAccess(project, userId)` — true if public or owner
- `isOwner(project, userId)` — true only if owner
- `writeLog()` wraps in try/catch — log failure never crashes the request
- Guest users: name stored in `localStorage.guestName`, passed as `actor_name` in request body
