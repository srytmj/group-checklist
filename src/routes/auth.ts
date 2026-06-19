import { Hono } from "hono";
import bcrypt from "bcryptjs";
import sql from "../db";
import type { AppEnv, User } from "../types";
import type { Context, Next } from "hono";

const auth = new Hono<AppEnv>();

const JWT_SECRET = process.env.JWT_SECRET ?? "dev_secret_change_me";
const COOKIE_NAME = "token";
const COOKIE_TTL = 60 * 60 * 24 * 30; // 30 days

// ---- JWT (HS256, Web Crypto — no external dep) ----

function b64urlEncode(buf: ArrayBuffer): string {
  let str = "";
  for (const b of new Uint8Array(buf)) str += String.fromCharCode(b);
  return btoa(str).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage]
  );
}

async function jwtSign(payload: object): Promise<string> {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const body = btoa(JSON.stringify(payload))
    .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const data = `${header}.${body}`;
  const key = await hmacKey(JWT_SECRET, "sign");
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return `${data}.${b64urlEncode(sig)}`;
}

async function jwtVerify(token: string): Promise<{ sub: string; username: string }> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");

  const [header, body, sig] = parts;
  const key = await hmacKey(JWT_SECRET, "verify");
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    b64urlDecode(sig),
    new TextEncoder().encode(`${header}.${body}`)
  );
  if (!valid) throw new Error("invalid signature");

  const payload = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("token expired");
  }
  return payload;
}

// ---- Cookie helpers ----

function cookieString(token: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_TTL}; Path=/${secure}`;
}

function parseCookieHeader(header: string | undefined, name: string): string | null {
  if (!header) return null;
  const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function jsonWithCookie(data: object, token: string, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": cookieString(token),
    },
  });
}

// ---- Auth middleware ----

export async function authMiddleware(c: Context<AppEnv>, next: Next) {
  const token = parseCookieHeader(c.req.header("cookie"), COOKIE_NAME);
  c.set("user", null);

  if (token) {
    try {
      const payload = await jwtVerify(token);
      c.set("user", { id: payload.sub, username: payload.username } as User);
    } catch (err) {
      console.warn("[auth] verify failed:", (err as Error).message);
    }
  }

  await next();
}

// ---- Routes ----

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

  const token = await jwtSign({
    sub: user.id,
    username: user.username,
    exp: Math.floor(Date.now() / 1000) + COOKIE_TTL,
  });

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

  const token = await jwtSign({
    sub: user.id,
    username: user.username,
    exp: Math.floor(Date.now() / 1000) + COOKIE_TTL,
  });

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
