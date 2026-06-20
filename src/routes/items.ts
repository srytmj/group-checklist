import { Hono } from "hono";
import sql from "../db";
import { writeLog } from "../middleware/logger";
import { broadcastToRoom } from "../ws";
import { getProject, canAccess, isOwner } from "../lib/access";
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
      ci.id, ci.title, ci.description, ci.display_order, ci.item_type, ci.created_at, ci.updated_at,
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
    item_type?: string;
    actor_name?: string;
  }>();
  const { title = "", description, display_order, item_type } = body;
  const validType = item_type === 'section' ? 'section' : 'task';

  if (!title.trim()) return c.json({ error: "title is required" }, 400);

  const actorName = resolveActor(user, body);

  // Default display_order to max+1 if not provided
  const [{ max_order }] = await sql<{ max_order: number }[]>`
    SELECT COALESCE(MAX(display_order), -1) AS max_order
    FROM checklist_items WHERE project_id = ${project.id}
  `;
  const order = display_order ?? max_order + 1;

  const [item] = await sql`
    INSERT INTO checklist_items (project_id, title, description, display_order, item_type)
    VALUES (${project.id}, ${title.trim()}, ${description ?? null}, ${order}, ${validType})
    RETURNING id, title, description, display_order, item_type, created_at, updated_at
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

// Helper: parse a Markdown checklist into items
function parseMarkdown(content: string): { type: string; title: string; description: string }[] {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const items: { type: string; title: string; description: string }[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Section header: ## Title
    const secMatch = line.match(/^##\s+(.+)$/);
    if (secMatch) {
      const title = secMatch[1].trim();
      let description = "";
      // Peek past blank lines — if next real line isn't a heading or list item, it's the caption
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === "") j++;
      if (j < lines.length && !lines[j].match(/^#{1,6}\s/) && !lines[j].match(/^-\s+\[/)) {
        description = lines[j].trim();
        i = j + 1;
      } else {
        i++;
      }
      items.push({ type: "section", title, description });
      continue;
    }

    // Task: - [ ] Title  (also accepts - [x] for pre-ticked items)
    const taskMatch = line.match(/^-\s+\[[ xX]\]\s+(.+)$/);
    if (taskMatch) {
      const title = taskMatch[1].trim();
      let description = "";
      // Next line indented = description
      const j = i + 1;
      if (j < lines.length && /^\s+\S/.test(lines[j])) {
        description = lines[j].trim();
        i = j + 1;
      } else {
        i++;
      }
      items.push({ type: "task", title, description });
      continue;
    }

    i++;
  }

  return items;
}

// Helper: parse one CSV line respecting quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// POST /import — bulk create items from a CSV file (owner only)
items.post("/import", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!isOwner(project, user?.id)) return c.json({ error: "owner only" }, 403);

  const body = await c.req.json<{ content?: string; filename?: string }>();
  const raw = (body.content ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const filename = (body.filename ?? "").toLowerCase();

  // Detect format: prefer extension, fall back to content sniffing
  const isMd = filename.endsWith(".md") || filename.endsWith(".markdown");
  const isCsv = filename.endsWith(".csv");
  const useMarkdown = isMd || (!isCsv && (raw.trimStart().startsWith("#") || raw.includes("- [ ]")));

  let parsed: { type: string; title: string; description: string }[] = [];

  if (useMarkdown) {
    // ---- Markdown parser ----
    parsed = parseMarkdown(raw);
    if (parsed.length === 0) {
      return c.json({
        error:
          "No tasks or sections found.\n\nUse `## Heading` for sections and `- [ ] Title` for tasks:\n\n## Phase 1\n- [ ] First task\n  Optional description",
      }, 400);
    }
  } else {
    // ---- CSV parser ----
    const lines = raw.split("\n").filter((l) => l.trim());
    if (lines.length < 2) {
      return c.json({ error: "CSV must have a header row and at least one item row." }, 400);
    }

    const EXPECTED_HEADER = "type,title,description";
    if (lines[0].trim().toLowerCase() !== EXPECTED_HEADER) {
      return c.json({
        error: `Invalid CSV format — first row must be exactly:\n${EXPECTED_HEADER}\n\nFound: ${lines[0].trim()}`,
      }, 400);
    }

    const rowErrors: string[] = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols = parseCSVLine(lines[i]).map((s) => s.trim());
      const [type = "", title = "", description = ""] = cols;
      if (!["task", "section"].includes(type)) {
        rowErrors.push(`Row ${i + 1}: "type" must be "task" or "section" (found: "${type}")`);
        continue;
      }
      if (!title) { rowErrors.push(`Row ${i + 1}: "title" is required`); continue; }
      parsed.push({ type, title, description });
    }

    if (rowErrors.length > 0) return c.json({ error: rowErrors.join("\n") }, 400);
    if (parsed.length === 0) return c.json({ error: "No valid items found in the CSV." }, 400);
  }

  // Get current max display_order
  const [{ max_order }] = await sql<{ max_order: number }[]>`
    SELECT COALESCE(MAX(display_order), -1) AS max_order
    FROM checklist_items WHERE project_id = ${project.id}
  `;

  // Bulk insert
  const created: any[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const { type, title, description } = parsed[i];
    const [item] = await sql`
      INSERT INTO checklist_items (project_id, title, description, display_order, item_type)
      VALUES (${project.id}, ${title}, ${description || null}, ${max_order + 1 + i}, ${type})
      RETURNING id, title, description, display_order, item_type, created_at, updated_at
    `;
    created.push({ ...item, pics: [], completion: null });
  }

  await writeLog({
    project_id: project.id,
    actor_name: user?.username ?? "unknown",
    action: "item.created",
    payload: { imported: created.length, from: body.filename ?? "csv" },
    ip: c.get("ip"),
    user_agent: c.get("userAgent"),
  });

  for (const item of created) {
    broadcastToRoom(slug, { event: "item.created", data: item });
  }

  return c.json({ imported: created.length, items: created }, 201);
});

// PATCH /reorder — bulk update display_order (must be before /:id to avoid UUID parse error)
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
    RETURNING id, title, description, display_order, item_type, created_at, updated_at
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

// DELETE /batch — bulk delete items (owner only)
items.delete("/batch", async (c) => {
  const slug = c.req.param("slug");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!isOwner(project, user?.id)) return c.json({ error: "owner only" }, 403);

  const body = await c.req.json<{ ids?: number[] }>();
  const ids = body.ids ?? [];
  if (!Array.isArray(ids) || ids.length === 0) return c.json({ error: "ids required" }, 400);

  await sql`DELETE FROM checklist_items WHERE id = ANY(${ids}::int[]) AND project_id = ${project.id}`;

  await writeLog({
    project_id: project.id,
    actor_name: user?.username ?? "unknown",
    action: "item.deleted",
    payload: { batch: true, count: ids.length },
    ip: c.get("ip"),
    user_agent: c.get("userAgent"),
  });

  for (const id of ids) {
    broadcastToRoom(slug, { event: "item.deleted", data: { id } });
  }

  return c.json({ deleted: ids.length });
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

// GET /:id/comments — list comments for an item
items.get("/:id/comments", async (c) => {
  const slug = c.req.param("slug");
  const itemId = c.req.param("id");
  const user = c.get("user");

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!canAccess(project, user?.id)) return c.json({ error: "access denied" }, 403);

  const rows = await sql`
    SELECT id, item_id, author_name, body, created_at
    FROM item_comments
    WHERE item_id = ${itemId}
    ORDER BY created_at ASC
  `;

  return c.json({ comments: rows });
});

// DELETE /:id/comments/:commentId — delete own comment within 5 minutes
items.delete("/:id/comments/:commentId", async (c) => {
  const slug = c.req.param("slug");
  const itemId = c.req.param("id");
  const commentId = c.req.param("commentId");
  const user = c.get("user");

  if (!user) return c.json({ error: "sign in to delete comments" }, 401);

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!canAccess(project, user.id)) return c.json({ error: "access denied" }, 403);

  const [comment] = await sql`
    SELECT id, author_id, created_at FROM item_comments
    WHERE id = ${commentId} AND item_id = ${itemId}
  `;
  if (!comment) return c.json({ error: "comment not found" }, 404);
  if (comment.author_id !== user.id) return c.json({ error: "you can only delete your own comments" }, 403);

  const ageMs = Date.now() - new Date(comment.created_at).getTime();
  if (ageMs > 5 * 60 * 1000) return c.json({ error: "comments can only be deleted within 5 minutes of posting" }, 403);

  await sql`DELETE FROM item_comments WHERE id = ${commentId}`;
  broadcastToRoom(slug, { event: "comment.deleted", data: { item_id: itemId, comment_id: commentId } });

  return c.json({ ok: true });
});

// POST /:id/comments — add comment (registered users only)
items.post("/:id/comments", async (c) => {
  const slug = c.req.param("slug");
  const itemId = c.req.param("id");
  const user = c.get("user");

  if (!user) return c.json({ error: "sign in to comment" }, 401);

  const project = await getProject(slug);
  if (!project) return c.json({ error: "not found" }, 404);
  if (!canAccess(project, user.id)) return c.json({ error: "access denied" }, 403);

  const body = await c.req.json<{ body?: string }>();
  const text = body.body?.trim() ?? "";
  if (!text) return c.json({ error: "body is required" }, 400);

  const [comment] = await sql`
    INSERT INTO item_comments (item_id, author_name, author_id, body)
    VALUES (${itemId}, ${user.username}, ${user.id}, ${text})
    RETURNING id, item_id, author_name, body, created_at
  `;

  broadcastToRoom(slug, { event: "comment.added", data: comment });

  return c.json(comment, 201);
});

export default items;
