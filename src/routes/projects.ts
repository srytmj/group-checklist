import { Hono } from "hono";
import { customAlphabet } from "nanoid";
import sql from "../db";
import { authMiddleware } from "./auth";
import { writeLog } from "../middleware/logger";
import { broadcastToRoom } from "../ws";
import { getProject, canAccess, isOwner } from "../lib/access";
import itemsRouter from "./items";
import logsRouter from "./logs";
import messagesRouter from "./messages";
import type { AppEnv } from "../types";

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 10);

const projects = new Hono<AppEnv>();

projects.use("*", authMiddleware);

projects.route("/:slug/items", itemsRouter);
projects.route("/:slug/logs", logsRouter);
projects.route("/:slug/messages", messagesRouter);

// GET /api/projects
projects.get("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "not authenticated" }, 401);

  const rows = await sql`
    SELECT id, name, slug, visibility, created_at, updated_at
    FROM projects
    WHERE owner_id = ${user.id}
    ORDER BY updated_at DESC
  `;
  return c.json(rows);
});

// POST /api/projects
projects.post("/", async (c) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "not authenticated" }, 401);

  const body = await c.req.json<{ name?: string; visibility?: "public" | "private" }>();
  const { name = "", visibility = "private" } = body;

  if (!name.trim()) return c.json({ error: "name is required" }, 400);
  if (!["public", "private"].includes(visibility)) {
    return c.json({ error: "visibility must be public or private" }, 400);
  }

  const slug = nanoid();

  const [project] = await sql`
    INSERT INTO projects (owner_id, name, slug, visibility)
    VALUES (${user.id}, ${name.trim()}, ${slug}, ${visibility})
    RETURNING id, name, slug, visibility, created_at, updated_at
  `;

  await writeLog({
    project_id: project.id,
    actor_name: user.username,
    action: "project.created",
    payload: { name: project.name, visibility: project.visibility },
    ip: c.get("ip"),
    user_agent: c.get("userAgent"),
    log_level: "admin",
  });

  return c.json(project, 201);
});

// GET /api/projects/:slug
projects.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!canAccess(project, user?.id)) return c.json({ error: "access denied" }, 403);

  const items = await sql`
    SELECT
      ci.id, ci.title, ci.description, ci.display_order, ci.created_at, ci.updated_at,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object('id', ip.id, 'name', ip.name, 'assigned_by', ip.assigned_by))
        FILTER (WHERE ip.id IS NOT NULL), '[]'
      ) AS pics,
      CASE WHEN ic.id IS NOT NULL THEN
        jsonb_build_object(
          'id', ic.id,
          'done_by_name', ic.done_by_name,
          'notes', ic.notes,
          'completed_at', ic.completed_at
        )
      END AS completion
    FROM checklist_items ci
    LEFT JOIN item_pics ip ON ip.item_id = ci.id
    LEFT JOIN item_completions ic ON ic.item_id = ci.id
    WHERE ci.project_id = ${project.id}
    GROUP BY ci.id, ic.id
    ORDER BY ci.display_order ASC, ci.created_at ASC
  `;

  return c.json({ ...project, is_owner: isOwner(project, user?.id), items });
});

// PATCH /api/projects/:slug
projects.patch("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");
  if (!user) return c.json({ error: "not authenticated" }, 401);

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!isOwner(project, user.id)) return c.json({ error: "owner only" }, 403);

  const body = await c.req.json<{ name?: string; visibility?: "public" | "private" }>();
  const updates: Record<string, string> = {};
  const old: Record<string, string> = {};

  if (body.name?.trim()) { old.name = project.name; updates.name = body.name.trim(); }
  if (body.visibility) {
    if (!["public", "private"].includes(body.visibility)) {
      return c.json({ error: "visibility must be public or private" }, 400);
    }
    old.visibility = project.visibility;
    updates.visibility = body.visibility;
  }

  if (Object.keys(updates).length === 0) return c.json({ error: "nothing to update" }, 400);

  const [updated] = await sql`
    UPDATE projects
    SET
      name       = COALESCE(${updates.name ?? null}, name),
      visibility = COALESCE(${(updates.visibility as "public" | "private") ?? null}, visibility)
    WHERE id = ${project.id}
    RETURNING id, name, slug, visibility, created_at, updated_at
  `;

  await writeLog({
    project_id: project.id,
    actor_name: user.username,
    action: "project.updated",
    payload: { old, new: updates },
    ip: c.get("ip"),
    user_agent: c.get("userAgent"),
    log_level: "admin",
  });

  broadcastToRoom(slug, { event: "project.updated", data: updated });
  return c.json(updated);
});

// DELETE /api/projects/:slug
projects.delete("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");
  if (!user) return c.json({ error: "not authenticated" }, 401);

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!isOwner(project, user.id)) return c.json({ error: "owner only" }, 403);

  await sql`DELETE FROM projects WHERE id = ${project.id}`;

  broadcastToRoom(slug, { event: "project.deleted", data: { slug } });
  return c.json({ ok: true });
});

export default projects;
