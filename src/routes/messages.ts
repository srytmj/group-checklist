import { Hono } from "hono";
import sql from "../db";
import { getProject, canAccess } from "../lib/access";
import { broadcastToRoom } from "../ws";
import type { AppEnv } from "../types";

const messages = new Hono<AppEnv>();

// GET / — latest 50 messages (oldest first for chat display)
messages.get("/", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!canAccess(project, user?.id)) return c.json({ error: "access denied" }, 403);

  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10), 200);

  // Fetch latest N, then reverse so oldest is first (chat order)
  const rows = await sql`
    SELECT * FROM (
      SELECT id, sender_name, body, created_at
      FROM project_messages
      WHERE project_id = ${project.id}
      ORDER BY created_at DESC
      LIMIT ${limit}
    ) sub
    ORDER BY created_at ASC
  `;

  return c.json({ messages: rows });
});

// POST / — send a message
messages.post("/", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!canAccess(project, user?.id)) return c.json({ error: "access denied" }, 403);

  const body = await c.req.json<{ body?: string; sender_name?: string }>();
  const msgBody = body.body?.trim() ?? "";
  if (!msgBody) return c.json({ error: "body is required" }, 400);

  const senderName = user?.username ?? body.sender_name?.trim() ?? "";
  if (!senderName) return c.json({ error: "sender_name is required for guests" }, 400);

  const [msg] = await sql`
    INSERT INTO project_messages (project_id, sender_name, body)
    VALUES (${project.id}, ${senderName}, ${msgBody})
    RETURNING id, sender_name, body, created_at
  `;

  broadcastToRoom(slug, { event: "message.created", data: msg });

  return c.json(msg, 201);
});

export default messages;
