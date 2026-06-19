import type { ServerWebSocket } from "bun";

export const rooms = new Map<string, Set<ServerWebSocket<unknown>>>();

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
