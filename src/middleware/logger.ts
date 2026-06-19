import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types";
import sql from "../db";

// Attaches ip + userAgent to context for use in route handlers
export const requestMeta = createMiddleware<AppEnv>(async (c, next) => {
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0].trim() ??
    c.req.header("x-real-ip") ??
    "unknown";
  const userAgent = c.req.header("user-agent") ?? "";
  c.set("ip", ip);
  c.set("userAgent", userAgent);
  await next();
});

// Write an entry to the logs table
export async function writeLog(params: {
  project_id: string;
  item_id?: string | null;
  actor_name: string;
  action: string;
  payload?: object | null;
  ip: string;
  user_agent: string;
  log_level?: "public" | "admin";
}) {
  try {
    await sql`
      INSERT INTO logs (project_id, item_id, actor_name, action, payload, ip, user_agent, log_level)
      VALUES (
        ${params.project_id},
        ${params.item_id ?? null},
        ${params.actor_name},
        ${params.action},
        ${params.payload ? sql.json(params.payload as Record<string, unknown>) : null},
        ${params.ip},
        ${params.user_agent},
        ${params.log_level ?? "public"}
      )
    `;
  } catch (err) {
    // Log failures must never crash the main request
    console.error("[writeLog] failed:", err);
  }
}
