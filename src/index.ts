import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { logger } from "hono/logger";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import { requestMeta } from "./middleware/logger";
import authRoutes from "./routes/auth";
import projectRoutes from "./routes/projects";

const app = new Hono();

// WebSocket rooms: slug -> Set of raw ws clients
const rooms = new Map<string, Set<ServerWebSocket<unknown>>>();

export function broadcastToRoom(slug: string, message: object) {
  const clients = rooms.get(slug);
  if (!clients || clients.size === 0) return;
  const payload = JSON.stringify(message);
  for (const ws of clients) {
    try {
      ws.send(payload);
    } catch {
      clients.delete(ws);
    }
  }
}

// Global middleware
app.use("*", logger());
app.use("*", requestMeta);

// Health check
app.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));

// API routes
app.route("/api/auth", authRoutes);
app.route("/api/projects", projectRoutes);

// WebSocket: /ws/:slug
const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket<unknown>>();

app.get(
  "/ws/:slug",
  upgradeWebSocket((c) => {
    const slug = c.req.param("slug");
    return {
      onOpen(_evt, ws) {
        const raw = ws.raw as ServerWebSocket<unknown>;
        if (!rooms.has(slug)) rooms.set(slug, new Set());
        rooms.get(slug)!.add(raw);
        console.log(`[ws] joined ${slug} (${rooms.get(slug)!.size} clients)`);
      },
      onClose(_evt, ws) {
        const raw = ws.raw as ServerWebSocket<unknown>;
        rooms.get(slug)?.delete(raw);
        if (rooms.get(slug)?.size === 0) rooms.delete(slug);
        console.log(`[ws] left ${slug}`);
      },
      onMessage(evt) {
        // Heartbeat: client sends "ping", server sends "pong"
        if (evt.data === "ping") {
          (evt.target as ServerWebSocket<unknown>).send("pong");
        }
      },
      onError(evt) {
        console.error(`[ws] error in ${slug}:`, evt);
      },
    };
  })
);

// Static files
app.use("/*", serveStatic({ root: "./public" }));

// SPA fallback
app.get("*", serveStatic({ path: "./public/index.html" }));

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
  websocket,
};

console.log(`Server running on http://localhost:${port}`);
