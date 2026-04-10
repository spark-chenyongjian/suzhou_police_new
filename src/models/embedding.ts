/**
 * Embedding 模块 — 文本向量化 + 向量检索
 *
 * 通过 OpenAI 兼容的 /v1/embeddings API 生成向量，
 * 使用 JSON 数组存储在 SQLite 中（轻量方案，无需 sqlite-vec 扩展）。
 *
 * 性能优化：
 * - 批量 embedding（最多 100 条/批）
 * - 余弦相似度计算在 JS 中完成（适合 <100K 向量的场景）
 * - 超大规模时建议迁移到 sqlite-vec 或专用向量库
 */

import { getModelRouter } from "./router.js";
import { DB } from "../store/database.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface EmbeddingEntry {
  pageId: string;
  kbId: string;
  level: string;
  content: string;
  vector: number[];
}

// ── Embedding Generation ────────────────────────────────────────────────

/**
 * Generate embedding vector for a single text.
 * Uses the configured embedding model via OpenAI-compatible API.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const router = getModelRouter();
  const modelName = router.getDefaultModel("embedding");
  const provider = router.getProvider(modelName);

  // Truncate to avoid token limits (embedding models typically accept ~512-8192 tokens)
  const truncated = text.length > 8000 ? text.slice(0, 8000) : text;

  // Use the provider's endpoint directly for embeddings
  const config = (provider as any).config as { endpoint: string; apiKey?: string; model: string };
  if (!config?.endpoint) {
    throw new Error("Embedding model not configured");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  const resp = await fetch(`${config.endpoint}/embeddings`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.model,
      input: truncated,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Embedding API error: ${resp.status} ${await resp.text()}`);
  }

  const data = await resp.json() as { data: Array<{ embedding: number[] }> };
  if (!data.data?.[0]?.embedding) {
    throw new Error("No embedding returned from API");
  }

  return data.data[0].embedding;
}

/**
 * Generate embeddings for multiple texts in batch.
 */
export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  // Process in batches of 50
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i += 50) {
    const batch = texts.slice(i, i + 50);
    const batchResults = await Promise.all(batch.map(generateEmbedding));
    results.push(...batchResults);
  }
  return results;
}

// ── Vector Storage ──────────────────────────────────────────────────────

const EMBEDDING_TABLE = "page_embeddings";

export function ensureEmbeddingTable(): void {
  const db = DB.getInstance().raw;
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${EMBEDDING_TABLE} (
      page_id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL,
      level TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      vector TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_embeddings_kb ON ${EMBEDDING_TABLE}(kb_id);
  `);
}

export function storeEmbedding(pageId: string, kbId: string, level: string, contentHash: string, vector: number[]): void {
  const db = DB.getInstance().raw;
  db.query(
    `INSERT OR REPLACE INTO ${EMBEDDING_TABLE} (page_id, kb_id, level, content_hash, vector) VALUES (?, ?, ?, ?, ?)`,
  ).run(pageId, kbId, level, contentHash, JSON.stringify(vector));
}

export function getEmbedding(pageId: string): { vector: number[]; contentHash: string } | null {
  const db = DB.getInstance().raw;
  const row = db.query(`SELECT vector, content_hash FROM ${EMBEDDING_TABLE} WHERE page_id = ?`).get(pageId) as Record<string, string> | null;
  if (!row) return null;
  return { vector: JSON.parse(row.vector), contentHash: row.content_hash };
}

export function deleteEmbedding(pageId: string): void {
  DB.getInstance().raw.query(`DELETE FROM ${EMBEDDING_TABLE} WHERE page_id = ?`).run(pageId);
}

// ── Vector Search ───────────────────────────────────────────────────────

/**
 * Search for similar pages using cosine similarity.
 * Loads all vectors for the KB into memory and computes similarity.
 * Suitable for KBs with up to ~100K pages.
 */
export async function vectorSearch(query: string, kbId: string, topK = 10, levels?: string[]): Promise<Array<{ pageId: string; score: number }>> {
  const queryVector = await generateEmbedding(query);
  const db = DB.getInstance().raw;

  let sql = `SELECT page_id, vector FROM ${EMBEDDING_TABLE} WHERE kb_id = ?`;
  const params: (string | string[])[] = [kbId];
  if (levels && levels.length > 0) {
    const placeholders = levels.map(() => "?").join(", ");
    sql += ` AND level IN (${placeholders})`;
    params.push(...levels);
  }

  const rows = db.query(sql).all(...params) as Array<{ page_id: string; vector: string }>;

  // Compute cosine similarity for all vectors
  const scored: Array<{ pageId: string; score: number }> = [];
  for (const row of rows) {
    const vec = JSON.parse(row.vector) as number[];
    const score = cosineSimilarity(queryVector, vec);
    scored.push({ pageId: row.page_id, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

// ── Indexing Pipeline ───────────────────────────────────────────────────

/**
 * Index a page's content: generate embedding and store.
 * Skips if content hasn't changed (same hash).
 */
export async function indexPageEmbedding(pageId: string, kbId: string, level: string, content: string): Promise<void> {
  const { createHash } = await import("crypto");
  const contentHash = createHash("sha256").update(content).digest("hex").slice(0, 16);

  // Skip if already indexed with same content
  const existing = getEmbedding(pageId);
  if (existing && existing.contentHash === contentHash) return;

  // Truncate content for embedding
  const truncated = content.length > 2000 ? content.slice(0, 2000) : content;
  const vector = await generateEmbedding(truncated);
  storeEmbedding(pageId, kbId, level, contentHash, vector);
}

/**
 * Batch index all pages in a KB that don't have embeddings yet.
 */
export async function indexKbEmbeddings(kbId: string, onProgress?: (current: number, total: number) => void): Promise<number> {
  const { listWikiPagesByKb, getWikiPageContent } = await import("../wiki/page-manager.js");
  const pages = listWikiPagesByKb(kbId);
  let indexed = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    try {
      const content = getWikiPageContent(page);
      if (!content) continue;
      const level = page.pageType === "abstract" ? "abstract" : page.pageType === "overview" ? "overview" : "fulltext";
      await indexPageEmbedding(page.id, kbId, level, content);
      indexed++;
    } catch (err) {
      console.warn(`[Embedding] Failed to index page ${page.id}:`, err);
    }
    onProgress?.(i + 1, pages.length);
  }

  return indexed;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
