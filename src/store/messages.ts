import { DB } from "./database.js";
import type { Message } from "../types/index.js";
import { randomUUID } from "crypto";

function rowToMessage(row: Record<string, unknown>): Message {
  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    role: row.role as Message["role"],
    content: row.content as string | null,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
    createdAt: row.created_at as string,
  };
}

export function createMessage(
  sessionId: string,
  role: Message["role"],
  content: string | null,
  metadata?: Record<string, unknown>,
): Message {
  const db = DB.getInstance().raw;
  const id = randomUUID();
  db.query("INSERT INTO messages (id, session_id, role, content, metadata) VALUES (?, ?, ?, ?, ?)")
    .run(id, sessionId, role, content, metadata ? JSON.stringify(metadata) : null);
  db.query("UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(sessionId);
  return rowToMessage(db.query("SELECT * FROM messages WHERE id = ?").get(id) as Record<string, unknown>);
}

export function getMessages(sessionId: string): Message[] {
  const db = DB.getInstance().raw;
  const rows = db.query("SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC").all(sessionId) as Record<string, unknown>[];
  return rows.map(rowToMessage);
}
