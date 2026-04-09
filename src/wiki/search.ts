/**
 * 三路融合检索引擎
 *
 * 路径1: FTS5 全文检索 (BM25) — 精确关键词、专有名词、编号
 * 路径2: 向量语义检索 (sqlite-vec，可选) — 语义相关
 * 路径3: 链接遍历 — 从命中文档出发沿正反向链接扩展
 *
 * 融合: RRF (Reciprocal Rank Fusion) 合并三路结果
 *
 * 设计参考: design.md §4.6
 */

import { DB } from "../store/database.js";
import { getWikiPage, getWikiPageContent } from "./page-manager.js";
import type { WikiPage } from "../types/index.js";

export interface SearchHit {
  pageId: string;
  kbId: string;
  title: string;
  pageType: WikiPage["pageType"];
  snippet: string;
  score: number;
  sources: Array<"fts" | "vector" | "link">;
}

export interface SearchOptions {
  query: string;
  kbId: string;
  topK?: number;
  levels?: Array<"abstract" | "overview" | "fulltext">;
  expandLinks?: boolean;
}

// ─── FTS5 Search ─────────────────────────────────────────────────────────────

export function ftsSearch(
  query: string,
  kbId: string,
  levels: string[] = ["abstract", "overview", "fulltext"],
  limit = 20,
): Array<{ pageId: string; rank: number; snippet: string }> {
  const db = DB.getInstance().raw;
  try {
    const levelList = levels.map(() => "?").join(", ");
    const rows = db.query(`
      SELECT page_id, rank, snippet(fts_content, 3, '<b>', '</b>', '...', 32) AS snippet
      FROM fts_content
      WHERE fts_content MATCH ?
        AND kb_id = ?
        AND level IN (${levelList})
      ORDER BY rank
      LIMIT ?
    `).all(query, kbId, ...levels, limit) as Array<{ page_id: string; rank: number; snippet: string }>;

    return rows.map((r, i) => ({ pageId: r.page_id, rank: i + 1, snippet: r.snippet }));
  } catch {
    return [];
  }
}

// ─── Link traversal ───────────────────────────────────────────────────────────

export function linkTraversal(
  seedPageIds: string[],
  maxDepth = 2,
  maxExpand = 20,
): Set<string> {
  const db = DB.getInstance().raw;
  const visited = new Set<string>(seedPageIds);
  let frontier = [...seedPageIds];

  for (let depth = 0; depth < maxDepth; depth++) {
    const next: string[] = [];
    for (const pageId of frontier) {
      // Forward links
      const fwd = db.query(
        "SELECT target_page_id FROM wiki_links WHERE source_page_id = ? LIMIT 10",
      ).all(pageId) as Array<{ target_page_id: string }>;
      // Backward links
      const bwd = db.query(
        "SELECT source_page_id FROM wiki_links WHERE target_page_id = ? LIMIT 10",
      ).all(pageId) as Array<{ source_page_id: string }>;

      for (const r of fwd) {
        if (!visited.has(r.target_page_id)) {
          visited.add(r.target_page_id);
          next.push(r.target_page_id);
        }
      }
      for (const r of bwd) {
        if (!visited.has(r.source_page_id)) {
          visited.add(r.source_page_id);
          next.push(r.source_page_id);
        }
      }
    }
    frontier = next;
    if (visited.size >= maxExpand) break;
  }

  // Remove seeds from result
  seedPageIds.forEach((id) => visited.delete(id));
  return visited;
}

// ─── RRF Fusion ───────────────────────────────────────────────────────────────

const RRF_K = 60;

function rrfScore(ranks: number[]): number {
  return ranks.reduce((sum, r) => sum + 1 / (RRF_K + r), 0);
}

// ─── Main search ──────────────────────────────────────────────────────────────

export async function kbSearch(opts: SearchOptions): Promise<SearchHit[]> {
  const { query, kbId, topK = 10, levels = ["abstract", "overview"], expandLinks = true } = opts;

  const db = DB.getInstance().raw;

  // ── FTS5 search ──
  const ftsHits = ftsSearch(query, kbId, levels, 30);
  const ftsMap = new Map(ftsHits.map((h) => [h.pageId, h]));

  // ── Link traversal from FTS hits ──
  const linkHitIds = new Set<string>();
  if (expandLinks && ftsHits.length > 0) {
    const seeds = ftsHits.slice(0, 10).map((h) => h.pageId);
    const expanded = linkTraversal(seeds, 1, 30);
    expanded.forEach((id) => linkHitIds.add(id));
  }

  // ── Merge all candidate page IDs ──
  const allCandidateIds = new Set<string>([
    ...ftsHits.map((h) => h.pageId),
    ...linkHitIds,
  ]);

  // ── Build unified scoring map ──
  const scoreMap = new Map<
    string,
    { ftsRank?: number; linkRank?: number; snippet: string; sources: Set<"fts" | "vector" | "link"> }
  >();

  for (const hit of ftsHits) {
    scoreMap.set(hit.pageId, {
      ftsRank: hit.rank,
      snippet: hit.snippet,
      sources: new Set(["fts"]),
    });
  }

  let linkRank = 1;
  for (const id of linkHitIds) {
    const existing = scoreMap.get(id);
    if (existing) {
      existing.sources.add("link");
      existing.linkRank = linkRank++;
    } else {
      scoreMap.set(id, { linkRank: linkRank++, snippet: "", sources: new Set(["link"]) });
    }
  }

  // ── RRF scoring ──
  const results: SearchHit[] = [];
  for (const [pageId, info] of scoreMap) {
    const ranks: number[] = [];
    if (info.ftsRank) ranks.push(info.ftsRank);
    if (info.linkRank) ranks.push(info.linkRank);
    const score = rrfScore(ranks);

    // Fetch page metadata from DB
    const row = db.query("SELECT id, kb_id, title, page_type FROM wiki_pages WHERE id = ?").get(pageId) as {
      id: string; kb_id: string; title: string; page_type: WikiPage["pageType"];
    } | null;
    if (!row) continue;

    results.push({
      pageId,
      kbId: row.kb_id,
      title: row.title,
      pageType: row.page_type,
      snippet: info.snippet,
      score,
      sources: [...info.sources],
    });
  }

  // Sort by RRF score descending, take topK
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

// ─── FTS index management ────────────────────────────────────────────────────

export function indexPageInFts(pageId: string, kbId: string, level: string, content: string): void {
  const db = DB.getInstance().raw;
  // Remove old entry if exists
  db.query("DELETE FROM fts_content WHERE page_id = ?").run(pageId);
  // Insert new
  db.query("INSERT INTO fts_content (page_id, kb_id, level, content) VALUES (?, ?, ?, ?)")
    .run(pageId, kbId, level, content);
}

export function removePageFromFts(pageId: string): void {
  DB.getInstance().raw.query("DELETE FROM fts_content WHERE page_id = ?").run(pageId);
}
