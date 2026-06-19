import { Hono } from "hono";
import sql from "../db";
import { getProject, canAccess, isOwner } from "../lib/access";
import type { AppEnv } from "../types";

const logs = new Hono<AppEnv>();

// GET / — fetch logs for a project
// Query params:
//   level = "public" | "admin" (admin requires owner)
//   limit = number (default 50, max 200)
//   before = ISO timestamp (cursor-based pagination)
logs.get("/", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!canAccess(project, user?.id)) return c.json({ error: "access denied" }, 403);

  const levelParam = c.req.query("level") ?? "public";
  const rawLimit = parseInt(c.req.query("limit") ?? "50", 10);
  const before = c.req.query("before"); // ISO timestamp

  // Admin logs only visible to owner
  if (levelParam === "admin" && !isOwner(project, user?.id)) {
    return c.json({ error: "owner only" }, 403);
  }

  const limit = Math.min(Math.max(rawLimit, 1), 200);
  const level = levelParam as "public" | "admin";

  let rows;

  if (before) {
    rows = await sql`
      SELECT id, item_id, actor_name, action, payload, ip, user_agent, log_level, created_at
      FROM logs
      WHERE project_id = ${project.id}
        AND log_level = ${level}
        AND created_at < ${before}::timestamptz
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  } else {
    rows = await sql`
      SELECT id, item_id, actor_name, action, payload, ip, user_agent, log_level, created_at
      FROM logs
      WHERE project_id = ${project.id}
        AND log_level = ${level}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
  }

  return c.json({
    logs: rows,
    next_before: rows.length === limit ? rows[rows.length - 1].created_at : null,
  });
});

export default logs;
