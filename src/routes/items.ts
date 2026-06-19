import { Hono } from "hono";
import sql from "../db";
import { writeLog } from "../middleware/logger";
import { broadcastToRoom } from "../index";
import { getProject, canAccess, isOwner } from "./projects";
import type { AppEnv } from "../types";

const items = new Hono<AppEnv>();

// Resolve actor name: authenticated user takes priority, else body.actor_name
function resolveActor(
  user: { username: string } | null,
  body: { actor_name?: string }
): string {
  return user?.username ?? body.actor_name?.trim() ?? "anonymous";
}

// Guard: fetch project and check access; return null + already-responded if denied
async function guard(
  c: any,
  requireOwner = false
): Promise<{ project: any; actorName: string } | null> {
  const slug = c.req.param("slug");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) {
    c.res = c.json({ error: "not found" }, 404);
    return null;
  }
  if (!canAccess(project, user?.id)) {
    c.res = c.json({ error: "access denied" }, 403);
    return null;
  }
  if (requireOwner && !isOwner(project, user?.id)) {
    c.res = c.json({ error: "owner only" }, 403);
    return null;
  }

  return { project, actorName: "" }; // actorName set per-handler after body parse
}

// GET / — list items with PICs and completion
items.get("/", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!canAccess(project, user?.id)) return c.json({ error: "access denied" }, 403);

  const rows = await sql`
    SELECT
      ci.id, ci.title, ci.description, ci.display_order, ci.created_at, ci.updated_at,
      COALESCE(
        json_agg(DISTINCT jsonb_build_object('id', ip.id, 'name', ip.name, 'assigned_by', ip.assigned_by))
        FILTER (WHERE ip.id IS NOT NULL), '[]'
      ) AS pics,
      jsonb_build_object(
        'id', ic.id,
        'done_by_name', ic.done_by_name,
        'notes', ic.notes,
        'completed_at', ic.completed_at
      ) FILTER (WHERE ic.id IS NOT NULL) AS completion
    FROM checklist_items ci
    LEFT JOIN item_pics ip ON ip.item_id = ci.id
    LEFT JOIN item_completions ic ON ic.item_id = ci.id
    WHERE ci.project_id = ${project.id}
    GROUP BY ci.id, ic.id
    ORDER BY ci.display_order ASC, ci.created_at ASC
  `;

  return c.json(rows);
});

// POST / — create item
items.post("/", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!canAccess(project, user?.id)) return c.json({ error: "access denied" }, 403);

  const body = await c.req.json<{
    title?: string;
    description?: string;
    display_order?: number;
    actor_name?: string;
  }>();
  const { title = "", description, display_order } = body;

  if (!title.trim()) return c.json({ error: "title is required" }, 400);

  const actorName = resolveActor(user, body);

  // Default display_order to max+1 if not provided
  const [{ max_order }] = await sql<{ max_order: number }[]>`
    SELECT COALESCE(MAX(display_order), -1) AS max_order
    FROM checklist_items WHERE project_id = ${project.id}
  `;
  const order = display_order ?? max_order + 1;

  const [item] = await sql`
    INSERT INTO checklist_items (project_id, title, description, display_order)
    VALUES (${project.id}, ${title.trim()}, ${description ?? null}, ${order})
    RETURNING id, title, description, display_order, created_at, updated_at
  `;

  await writeLog({
    project_id: project.id,
    item_id: item.id,
    actor_name: actorName,
    action: "item.created",
    payload: { title: item.title, description: item.description },
    ip: c.get("ip"),
    user_agent: c.get("userAgent"),
  });

  broadcastToRoom(slug, { event: "item.created", data: { ...item, pics: [], completion: null } });

  return c.json({ ...item, pics: [], completion: null }, 201);
});

// PATCH /:id — update item title/description
items.patch("/:id", async (c) => {
  const slug = c.req.param("slug");
  const itemId = c.req.param("id");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!canAccess(project, user?.id)) return c.json({ error: "access denied" }, 403);

  const [item] = await sql`SELECT * FROM checklist_items WHERE id = ${itemId} AND project_id = ${project.id}`;
  if (!item) return c.json({ error: "item not found" }, 404);

  const body = await c.req.json<{
    title?: string;
    description?: string;
    actor_name?: string;
  }>();
  const actorName = resolveActor(user, body);
  const old = { title: item.title, description: item.description };

  const [updated] = await sql`
    UPDATE checklist_items
    SET
      title       = COALESCE(${body.title?.trim() ?? null}, title),
      description = COALESCE(${body.description ?? null}, description)
    WHERE id = ${itemId}
    RETURNING id, title, description, display_order, created_at, updated_at
  `;

  await writeLog({
    project_id: project.id,
    item_id: itemId,
    actor_name: actorName,
    action: "item.updated",
    payload: { old, new: { title: updated.title, description: updated.description } },
    ip: c.get("ip"),
    user_agent: c.get("userAgent"),
  });

  broadcastToRoom(slug, { event: "item.updated", data: updated });

  return c.json(updated);
});

// DELETE /:id — delete item
items.delete("/:id", async (c) => {
  const slug = c.req.param("slug");
  const itemId = c.req.param("id");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!canAccess(project, user?.id)) return c.json({ error: "access denied" }, 403);

  const [item] = await sql`SELECT * FROM checklist_items WHERE id = ${itemId} AND project_id = ${project.id}`;
  if (!item) return c.json({ error: "item not found" }, 404);

  const actorName = resolveActor(user, {});

  await sql`DELETE FROM checklist_items WHERE id = ${itemId}`;

  await writeLog({
    project_id: project.id,
    item_id: null,
    actor_name: actorName,
    action: "item.deleted",
    payload: { title: item.title },
    ip: c.get("ip"),
    user_agent: c.get("userAgent"),
  });

  broadcastToRoom(slug, { event: "item.deleted", data: { id: itemId } });

  return c.json({ ok: true });
});

// PATCH /reorder — bulk update display_order
items.patch("/reorder", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!canAccess(project, user?.id)) return c.json({ error: "access denied" }, 403);

  const body = await c.req.json<{
    order: { id: string; display_order: number }[];
    actor_name?: string;
  }>();
  const { order = [] } = body;

  if (!Array.isArray(order) || order.length === 0) {
    return c.json({ error: "order array is required" }, 400);
  }

  const actorName = resolveActor(user, body);

  // Update in a transaction
  await sql.begin(async (tx) => {
    for (const { id, display_order } of order) {
      await tx`
        UPDATE checklist_items
        SET display_order = ${display_order}
        WHERE id = ${id} AND project_id = ${project.id}
      `;
    }
  });

  await writeLog({
    project_id: project.id,
    actor_name: actorName,
    action: "item.reordered",
    payload: { order },
    ip: c.get("ip"),
    user_agent: c.get("userAgent"),
  });

  broadcastToRoom(slug, { event: "item.reordered", data: { order } });

  return c.json({ ok: true });
});

// POST /:id/pics — add PIC to item
items.post("/:id/pics", async (c) => {
  const slug = c.req.param("slug");
  const itemId = c.req.param("id");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!canAccess(project, user?.id)) return c.json({ error: "access denied" }, 403);

  const [item] = await sql`SELECT id FROM checklist_items WHERE id = ${itemId} AND project_id = ${project.id}`;
  if (!item) return c.json({ error: "item not found" }, 404);

  const body = await c.req.json<{ name?: string; actor_name?: string }>();
  const { name = "" } = body;
  if (!name.trim()) return c.json({ error: "name is required" }, 400);

  const actorName = resolveActor(user, body);

  const [pic] = await sql`
    INSERT INTO item_pics (item_id, name, assigned_by)
    VALUES (${itemId}, ${name.trim()}, ${actorName})
    RETURNING id, item_id, name, assigned_by, created_at
  `;

  await writeLog({
    project_id: project.id,
    item_id: itemId,
    actor_name: actorName,
    action: "item.pic_added",
    payload: { name: pic.name },
    ip: c.get("ip"),
    user_agent: c.get("userAgent"),
  });

  broadcastToRoom(slug, { event: "item.pic_added", data: { item_id: itemId, pic } });

  return c.json(pic, 201);
});

// DELETE /:id/pics/:picId — remove PIC
items.delete("/:id/pics/:picId", async (c) => {
  const slug = c.req.param("slug");
  const itemId = c.req.param("id");
  const picId = c.req.param("picId");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!canAccess(project, user?.id)) return c.json({ error: "access denied" }, 403);

  const [pic] = await sql`SELECT * FROM item_pics WHERE id = ${picId} AND item_id = ${itemId}`;
  if (!pic) return c.json({ error: "pic not found" }, 404);

  const actorName = resolveActor(user, {});

  await sql`DELETE FROM item_pics WHERE id = ${picId}`;

  await writeLog({
    project_id: project.id,
    item_id: itemId,
    actor_name: actorName,
    action: "item.pic_removed",
    payload: { name: pic.name },
    ip: c.get("ip"),
    user_agent: c.get("userAgent"),
  });

  broadcastToRoom(slug, { event: "item.pic_removed", data: { item_id: itemId, pic_id: picId } });

  return c.json({ ok: true });
});

// POST /:id/complete — mark item as complete
items.post("/:id/complete", async (c) => {
  const slug = c.req.param("slug");
  const itemId = c.req.param("id");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!canAccess(project, user?.id)) return c.json({ error: "access denied" }, 403);

  const [item] = await sql`SELECT id FROM checklist_items WHERE id = ${itemId} AND project_id = ${project.id}`;
  if (!item) return c.json({ error: "item not found" }, 404);

  const body = await c.req.json<{
    done_by_name?: string;
    notes?: string;
    actor_name?: string;
  }>();
  const { done_by_name = "", notes } = body;

  if (!done_by_name.trim()) return c.json({ error: "done_by_name is required" }, 400);

  const actorName = resolveActor(user, body);

  // UPSERT — replace if already exists (idempotent re-complete)
  const [completion] = await sql`
    INSERT INTO item_completions (item_id, done_by_name, notes)
    VALUES (${itemId}, ${done_by_name.trim()}, ${notes ?? null})
    ON CONFLICT (item_id) DO UPDATE
      SET done_by_name = EXCLUDED.done_by_name,
          notes = EXCLUDED.notes,
          completed_at = NOW()
    RETURNING id, item_id, done_by_name, notes, completed_at
  `;

  await writeLog({
    project_id: project.id,
    item_id: itemId,
    actor_name: actorName,
    action: "item.completed",
    payload: { done_by_name: completion.done_by_name, notes: completion.notes },
    ip: c.get("ip"),
    user_agent: c.get("userAgent"),
  });

  broadcastToRoom(slug, { event: "item.completed", data: { item_id: itemId, completion } });

  return c.json(completion, 201);
});

// DELETE /:id/complete — undo completion
items.delete("/:id/complete", async (c) => {
  const slug = c.req.param("slug");
  const itemId = c.req.param("id");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!canAccess(project, user?.id)) return c.json({ error: "access denied" }, 403);

  const [completion] = await sql`SELECT * FROM item_completions WHERE item_id = ${itemId}`;
  if (!completion) return c.json({ error: "item is not completed" }, 404);

  const actorName = resolveActor(user, {});

  await sql`DELETE FROM item_completions WHERE item_id = ${itemId}`;

  await writeLog({
    project_id: project.id,
    item_id: itemId,
    actor_name: actorName,
    action: "item.uncompleted",
    payload: { done_by_name: completion.done_by_name },
    ip: c.get("ip"),
    user_agent: c.get("userAgent"),
  });

  broadcastToRoom(slug, { event: "item.uncompleted", data: { item_id: itemId } });

  return c.json({ ok: true });
});

export default items;
