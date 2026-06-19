import { Hono } from "hono";
import { sign, verify } from "hono/jwt";
import bcrypt from "bcryptjs";
import sql from "../db";
import type { AppEnv, User } from "../types";
import type { Context, Next } from "hono";

const auth = new Hono<AppEnv>();

const JWT_SECRET = process.env.JWT_SECRET ?? "dev_secret_change_me";
const COOKIE_NAME = "token";
const COOKIE_TTL = 60 * 60 * 24 * 30;

function tokenPayload(user: { id: string; username: string }) {
  return {
    sub: user.id,
    username: user.username,
    exp: Math.floor(Date.now() / 1000) + COOKIE_TTL,
  };
}

function cookieString(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_TTL}; Path=/${secure}`;
}

// Return raw Response so Set-Cookie is guaranteed in response headers
function jsonWithCookie(data: object, token: string, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookieString(token),
    },
  });
}

// Parse cookie header manually — no hono/cookie dependency
function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  const token = parseCookie(c.req.header("cookie") ?? null, COOKIE_NAME);
  c.set("user", null);

  if (token) {
    try {
      const payload = (await verify(token, JWT_SECRET)) as {
        sub: string;
        username: string;
      };
      c.set("user", { id: payload.sub, username: payload.username } as User);
    } catch (err) {
      console.warn("[auth] token invalid:", (err as Error).message);
    }
  }

  await next();
}

// POST /api/auth/register
auth.post("/register", async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const { username = "", password = "" } = body;

  if (!username || !password)
    return c.json({ error: "username and password required" }, 400);
  if (username.length < 3 || username.length > 32)
    return c.json({ error: "username must be 3-32 characters" }, 400);
  if (password.length < 8)
    return c.json({ error: "password must be at least 8 characters" }, 400);

  const existing = await sql`SELECT id FROM users WHERE username = ${username}`;
  if (existing.length > 0)
    return c.json({ error: "username already taken" }, 409);

  const hash = await bcrypt.hash(password, 12);
  const [user] = await sql<{ id: string; username: string }[]>`
    INSERT INTO users (username, password_hash)
    VALUES (${username}, ${hash})
    RETURNING id, username
  `;

  const token = await sign(tokenPayload(user), JWT_SECRET);
  return jsonWithCookie({ id: user.id, username: user.username }, token, 201);
});

// POST /api/auth/login
auth.post("/login", async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>();
  const { username = "", password = "" } = body;

  if (!username || !password)
    return c.json({ error: "username and password required" }, 400);

  const [user] = await sql<{ id: string; username: string; password_hash: string }[]>`
    SELECT id, username, password_hash FROM users WHERE username = ${username}
  `;
  if (!user) return c.json({ error: "invalid credentials" }, 401);

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return c.json({ error: "invalid credentials" }, 401);

  const token = await sign(tokenPayload(user), JWT_SECRET);
  return jsonWithCookie({ id: user.id, username: user.username }, token);
});

// POST /api/auth/logout
auth.post("/logout", () => {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
    },
  });
});

// GET /api/auth/me
auth.get("/me", authMiddleware, (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "not authenticated" }, 401);
  return c.json(user);
});

export default auth;
