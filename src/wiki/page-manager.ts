/**
 * Wiki Page Manager
 * Handles CRUD for Wiki pages on both the filesystem (Markdown files)
 * and the SQLite metadata layer.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { createHash } from "crypto";
import { DB } from "../store/database.js";
import { DATA_DIR } from "../paths.js";
import type { WikiPage } from "../types/index.js";

export function wikiDir(kbId: string): string {
  return join(DATA_DIR, "wiki", kbId);
}

export function docDir(kbId: string, docId: string): string {
  return join(wikiDir(kbId), "documents", docId);
}

function rowToPage(row: Record<string, unknown>): WikiPage {
  return {
    id: row.id as string,
    kbId: row.kb_id as string,
    docId: row.doc_id as string | null,
    pageType: row.page_type as WikiPage["pageType"],
    title: row.title as string,
    filePath: row.file_path as string,
    contentHash: row.content_hash as string | null,
    tokenCount: row.token_count as number | null,
    metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function createWikiPage(opts: {
  kbId: string;
  docId?: string;
  pageType: WikiPage["pageType"];
  title: string;
  content: string;
  filePath: string;
  tokenCount?: number;
  metadata?: Record<string, unknown>;
}): WikiPage {
  const db = DB.getInstance().raw;
  const id = randomUUID();
  const hash = createHash("sha256").update(opts.content).digest("hex");

  // Write to filesystem
  const absPath = join(DATA_DIR, opts.filePath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, opts.content, "utf-8");

  // Write to DB
  db.query(`
    INSERT INTO wiki_pages (id, kb_id, doc_id, page_type, title, file_path, content_hash, token_count, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.kbId,
    opts.docId || null,
    opts.pageType,
    opts.title,
    opts.filePath,
    hash,
    opts.tokenCount || null,
    opts.metadata ? JSON.stringify(opts.metadata) : null,
  );

  return rowToPage(db.query("SELECT * FROM wiki_pages WHERE id = ?").get(id) as Record<string, unknown>);
}

export function updateWikiPage(id: string, content: string, tokenCount?: number): WikiPage {
  const db = DB.getInstance().raw;
  const page = getWikiPage(id);
  if (!page) throw new Error(`Wiki page not found: ${id}`);

  const hash = createHash("sha256").update(content).digest("hex");
  const absPath = join(DATA_DIR, page.filePath);
  writeFileSync(absPath, content, "utf-8");

  db.query(`
    UPDATE wiki_pages SET content_hash = ?, token_count = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
  `).run(hash, tokenCount || null, id);

  return rowToPage(db.query("SELECT * FROM wiki_pages WHERE id = ?").get(id) as Record<string, unknown>);
}

export function getWikiPage(id: string): WikiPage | null {
  const db = DB.getInstance().raw;
  const row = db.query("SELECT * FROM wiki_pages WHERE id = ?").get(id);
  return row ? rowToPage(row as Record<string, unknown>) : null;
}

export function getWikiPageContent(page: WikiPage): string {
  const absPath = join(DATA_DIR, page.filePath);
  if (!existsSync(absPath)) return "";
  return readFileSync(absPath, "utf-8");
}

export function deleteWikiPage(id: string): void {
  const db = DB.getInstance().raw;
  const page = getWikiPage(id);
  if (!page) return;
  try {
    const absPath = join(DATA_DIR, page.filePath);
    if (existsSync(absPath)) unlinkSync(absPath);
  } catch { /* ignore fs errors */ }
  db.query("DELETE FROM wiki_links WHERE source_page_id = ? OR target_page_id = ?").run(id, id);
  try { db.query("DELETE FROM fts_content WHERE page_id = ?").run(id); } catch { /* ignore */ }
  try { db.query("DELETE FROM page_embeddings WHERE page_id = ?").run(id); } catch { /* ignore */ }
  db.query("DELETE FROM wiki_pages WHERE id = ?").run(id);
}

export function listWikiPagesByDoc(docId: string): WikiPage[] {
  const db = DB.getInstance().raw;
  return (db.query("SELECT * FROM wiki_pages WHERE doc_id = ? ORDER BY page_type").all(docId) as Record<string, unknown>[]).map(rowToPage);
}

export function listWikiPagesByKb(kbId: string, pageType?: WikiPage["pageType"]): WikiPage[] {
  const db = DB.getInstance().raw;
  if (pageType) {
    return (db.query("SELECT * FROM wiki_pages WHERE kb_id = ? AND page_type = ?").all(kbId, pageType) as Record<string, unknown>[]).map(rowToPage);
  }
  return (db.query("SELECT * FROM wiki_pages WHERE kb_id = ?").all(kbId) as Record<string, unknown>[]).map(rowToPage);
}

export function upsertWikiLink(sourcePageId: string, targetPageId: string, linkType: string, entityName?: string, context?: string): void {
  const db = DB.getInstance().raw;
  // Avoid duplicate links
  const existing = db.query(
    "SELECT id FROM wiki_links WHERE source_page_id = ? AND target_page_id = ? AND link_type = ?",
  ).get(sourcePageId, targetPageId, linkType);
  if (!existing) {
    db.query(
      "INSERT INTO wiki_links (source_page_id, target_page_id, link_type, entity_name, context) VALUES (?, ?, ?, ?, ?)",
    ).run(sourcePageId, targetPageId, linkType, entityName || null, context || null);
  }
}

export function getBacklinks(pageId: string): Array<{ sourcePageId: string; linkType: string; entityName: string | null }> {
  const db = DB.getInstance().raw;
  return db.query(
    "SELECT source_page_id, link_type, entity_name FROM wiki_links WHERE target_page_id = ?",
  ).all(pageId) as Array<{ sourcePageId: string; linkType: string; entityName: string | null }>;
}

export function ensureWikiIndexExists(kbId: string): string {
  const indexPath = join(wikiDir(kbId), "index.md");
  if (!existsSync(indexPath)) {
    mkdirSync(dirname(indexPath), { recursive: true });
    writeFileSync(indexPath, `# 知识库索引\n\n*暂无文档*\n`, "utf-8");
  }
  return indexPath;
}
