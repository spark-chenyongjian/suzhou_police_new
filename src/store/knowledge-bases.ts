import { DB } from "./database.js";
import type { KnowledgeBase, Document } from "../types/index.js";
import { randomUUID } from "crypto";

function rowToKb(row: Record<string, unknown>): KnowledgeBase {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string | null,
    ownerId: row.owner_id as string,
    visibility: row.visibility as KnowledgeBase["visibility"],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToDoc(row: Record<string, unknown>): Document {
  return {
    id: row.id as string,
    kbId: row.kb_id as string,
    filename: row.filename as string,
    filePath: row.file_path as string,
    fileHash: row.file_hash as string,
    fileSize: row.file_size as number | null,
    fileType: row.file_type as string | null,
    status: row.status as Document["status"],
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
    createdAt: row.created_at as string,
  };
}

// ── Knowledge Base CRUD ────────────────────────────────────────────────────

export function createKnowledgeBase(opts: {
  name: string;
  description?: string;
  ownerId?: string;
  visibility?: KnowledgeBase["visibility"];
}): KnowledgeBase {
  const db = DB.getInstance().raw;
  const id = randomUUID();
  db.query(
    "INSERT INTO knowledge_bases (id, name, description, owner_id, visibility) VALUES (?, ?, ?, ?, ?)",
  ).run(
    id,
    opts.name,
    opts.description || null,
    opts.ownerId || "system",
    opts.visibility || "private",
  );
  return rowToKb(db.query("SELECT * FROM knowledge_bases WHERE id = ?").get(id) as Record<string, unknown>);
}

export function listKnowledgeBases(): KnowledgeBase[] {
  const db = DB.getInstance().raw;
  return (db.query("SELECT * FROM knowledge_bases ORDER BY updated_at DESC").all() as Record<string, unknown>[]).map(rowToKb);
}

export function getKnowledgeBase(id: string): KnowledgeBase | null {
  const db = DB.getInstance().raw;
  const row = db.query("SELECT * FROM knowledge_bases WHERE id = ?").get(id);
  return row ? rowToKb(row as Record<string, unknown>) : null;
}

export function updateKnowledgeBase(id: string, opts: { name?: string; description?: string }): KnowledgeBase | null {
  const db = DB.getInstance().raw;
  if (opts.name !== undefined) {
    db.query("UPDATE knowledge_bases SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(opts.name, id);
  }
  if (opts.description !== undefined) {
    db.query("UPDATE knowledge_bases SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(opts.description, id);
  }
  return getKnowledgeBase(id);
}

export function deleteKnowledgeBase(id: string): void {
  const db = DB.getInstance().raw;
  db.query("DELETE FROM documents WHERE kb_id = ?").run(id);
  db.query("DELETE FROM wiki_pages WHERE kb_id = ?").run(id);
  db.query("DELETE FROM knowledge_bases WHERE id = ?").run(id);
}

// ── Document CRUD ─────────────────────────────────────────────────────────

export function createDocument(opts: {
  kbId: string;
  filename: string;
  filePath: string;
  fileHash: string;
  fileSize?: number;
  fileType?: string;
}): Document {
  const db = DB.getInstance().raw;
  const id = randomUUID();
  db.query(
    "INSERT INTO documents (id, kb_id, filename, file_path, file_hash, file_size, file_type, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    opts.kbId,
    opts.filename,
    opts.filePath,
    opts.fileHash,
    opts.fileSize || null,
    opts.fileType || null,
    "uploaded",
  );
  return rowToDoc(db.query("SELECT * FROM documents WHERE id = ?").get(id) as Record<string, unknown>);
}

export function updateDocumentStatus(id: string, status: Document["status"], metadata?: Record<string, unknown>): void {
  const db = DB.getInstance().raw;
  if (metadata) {
    db.query("UPDATE documents SET status = ?, metadata = ? WHERE id = ?")
      .run(status, JSON.stringify(metadata), id);
  } else {
    db.query("UPDATE documents SET status = ? WHERE id = ?").run(status, id);
  }
}

export function listDocuments(kbId: string): Document[] {
  const db = DB.getInstance().raw;
  return (db.query("SELECT * FROM documents WHERE kb_id = ? ORDER BY created_at DESC").all(kbId) as Record<string, unknown>[]).map(rowToDoc);
}

export function getDocument(id: string): Document | null {
  const db = DB.getInstance().raw;
  const row = db.query("SELECT * FROM documents WHERE id = ?").get(id);
  return row ? rowToDoc(row as Record<string, unknown>) : null;
}

export function deleteDocument(id: string): void {
  const db = DB.getInstance().raw;
  db.query("DELETE FROM wiki_pages WHERE doc_id = ?").run(id);
  db.query("DELETE FROM documents WHERE id = ?").run(id);
}
