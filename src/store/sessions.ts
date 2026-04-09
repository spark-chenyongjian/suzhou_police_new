import { DB } from "./database.js";
import type { Session } from "../types/index.js";
import { randomUUID } from "crypto";

function rowToSession(row: Record<string, unknown>): Session {
  return {
    id: row.id as string,
    title: row.title as string | null,
    kbScope: row.kb_scope ? JSON.parse(row.kb_scope as string) : null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function createSession(title?: string, kbScope?: Record<string, unknown>): Session {
  const db = DB.getInstance().raw;
  const id = randomUUID();
  db.query("INSERT INTO sessions (id, title, kb_scope) VALUES (?, ?, ?)")
    .run(id, title || null, kbScope ? JSON.stringify(kbScope) : null);
  return rowToSession(db.query("SELECT * FROM sessions WHERE id = ?").get(id) as Record<string, unknown>);
}

export function listSessions(): Session[] {
  const db = DB.getInstance().raw;
  const rows = db.query("SELECT * FROM sessions ORDER BY updated_at DESC").all() as Record<string, unknown>[];
  return rows.map(rowToSession);
}

export function getSession(id: string): Session | undefined {
  const db = DB.getInstance().raw;
  const row = db.query("SELECT * FROM sessions WHERE id = ?").get(id);
  return row ? rowToSession(row as Record<string, unknown>) : undefined;
}

export function updateSession(id: string, title: string): void {
  const db = DB.getInstance().raw;
  db.query("UPDATE sessions SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(title, id);
}
