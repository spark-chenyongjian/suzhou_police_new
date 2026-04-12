/**
 * Knowledge Graph & Timeline extraction from Wiki documents
 *
 * Extracts entities, relationships, and date events from Markdown content
 * without requiring LLM calls — uses regex and structural parsing.
 */

import { listWikiPagesByKb, getWikiPageContent } from "./page-manager.js";
import { listDocuments } from "../store/knowledge-bases.js";
import type { WikiPage } from "../types/index.js";

// ── Types ──────────────────────────────────────────────────────────────────

export interface GraphData {
  nodes: Array<{
    id: string;
    label: string;
    type: "document" | "entity" | "heading";
    meta?: string;
  }>;
  edges: Array<{
    source: string;
    target: string;
    label: string;
    weight: number;
  }>;
}

export interface TimelineData {
  events: Array<{
    id: string;
    timestamp: string;
    description: string;
    entity: string;
    confidence: "confirmed" | "estimated";
    source: string;
  }>;
}

// ── Date extraction patterns ───────────────────────────────────────────────

const DATE_PATTERNS_SRC = [
  // YYYY年MM月DD日
  /(\\d{4})年(\\d{1,2})月(\\d{1,2})日/.source,
  // YYYY年MM月
  /(\\d{4})年(\\d{1,2})月(?!日)/.source,
  // YYYY-MM-DD or YYYY/MM/DD
  /(\\d{4})[-/](\\d{1,2})[-/](\\d{1,2})/.source,
  // YYYY.MM.DD
  /(\\d{4})\\.(\\d{1,2})\\.(\\d{1,2})/.source,
];

// ── Entity extraction patterns ─────────────────────────────────────────────

// Chinese organization keywords
const ORG_SUFFIXES = /(?:公司|集团|银行|有限公司|股份|事务所|研究院|研究所|大学|学院|医院|法院|检察院|公安局|政府|部门|委员会|协会|基金会|中心|机构)/;

// Chinese location keywords — require 2+ chars before suffix to avoid false positives
// Exclude common suffixes that appear in non-location contexts (路 in 路由/路径, 号 in 号码)
const LOC_PATTERN = /(?:[\u4e00-\u9fff]{2,}(?:省|市|区|县|镇|乡|村|开发区|新区|园区|自贸区))|(?:[\u4e00-\u9fff]{2,4}(?:路|街|道)(?:[^\u4e00-\u9fff]|$))/;

// Money patterns
const MONEY_PATTERN_SRC = /[¥￥]?\s*[\d,.]+\s*(?:万|亿|元|美元|欧元|英镑|港币|日元|万元|亿元)/.source;

// Bold text or wiki-link entities
const BOLD_ENTITY_SRC = /\*\*([^*]{2,30})\*\*/.source;
const WIKI_LINK_SRC = /\[\[([^\]]{2,30})\]\]/.source;

// ── Entity extraction ──────────────────────────────────────────────────────

interface ExtractedEntity {
  name: string;
  type: "person" | "org" | "location" | "money" | "keyword";
  count: number;
}

function extractEntitiesFromText(text: string): ExtractedEntity[] {
  const entityMap = new Map<string, ExtractedEntity>();

  const addEntity = (name: string, type: ExtractedEntity["type"]) => {
    const key = `${type}:${name}`;
    const existing = entityMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      entityMap.set(key, { name, type, count: 1 });
    }
  };

  // 1. Extract organizations
  const orgMatches = text.matchAll(new RegExp(`([\\u4e00-\\u9fff]{2,15}${ORG_SUFFIXES.source})`, "g"));
  for (const m of orgMatches) {
    addEntity(m[1], "org");
  }

  // 2. Extract locations
  const locMatches = text.matchAll(new RegExp(`(${LOC_PATTERN.source})`, "g"));
  for (const m of locMatches) {
    addEntity(m[1], "location");
  }

  // 3. Extract money amounts
  const moneyMatches = text.matchAll(new RegExp(MONEY_PATTERN_SRC, "g"));
  for (const m of moneyMatches) {
    addEntity(m[0].trim(), "money");
  }

  // 4. Extract bold text entities
  const boldMatches = text.matchAll(new RegExp(BOLD_ENTITY_SRC, "g"));
  for (const m of boldMatches) {
    const label = m[1].trim();
    if (label.length >= 2 && label.length <= 30) {
      addEntity(label, "keyword");
    }
  }

  // 5. Extract wiki-link entities
  const linkMatches = text.matchAll(new RegExp(WIKI_LINK_SRC, "g"));
  for (const m of linkMatches) {
    addEntity(m[1].trim(), "keyword");
  }

  // 6. Extract key terms from headings (## headings → entity)
  const headingMatches = text.matchAll(new RegExp(/^#{1,4}\s+(.+)$/.source, "gm"));
  for (const m of headingMatches) {
    const heading = m[1].replace(/[#*`\[\]]/g, "").trim();
    if (heading.length >= 2 && heading.length <= 50) {
      addEntity(heading, "keyword");
    }
  }

  return [...entityMap.values()];
}

// ── Date extraction ────────────────────────────────────────────────────────

interface DateMatch {
  date: string; // YYYY-MM-DD format
  context: string; // surrounding text
  sourceDoc: string;
}

export function extractDatesFromText(text: string, docName: string): DateMatch[] {
  const results: DateMatch[] = [];
  const lines = text.split("\n");

  // Create fresh RegExp instances each call to avoid stale lastIndex issues
  const datePatterns = [
    new RegExp("(\\d{4})年(\\d{1,2})月(\\d{1,2})日", "g"),
    new RegExp("(\\d{4})年(\\d{1,2})月(?!日)", "g"),
    new RegExp("(\\d{4})[-/](\\d{1,2})[-/](\\d{1,2})", "g"),
    new RegExp("(\\d{4})\\.(\\d{1,2})\\.(\\d{1,2})", "g"),
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("```") || trimmed.startsWith("|")) continue;

    for (const pattern of datePatterns) {
      pattern.lastIndex = 0; // Reset global regex state
      const matches = trimmed.matchAll(pattern);
      for (const m of matches) {
        let dateStr: string;
        const year = m[1];
        const month = m[2]?.padStart(2, "0");
        const day = m[3]?.padStart(2, "0");

        if (year && month && day) {
          dateStr = `${year}-${month}-${day}`;
        } else if (year && month) {
          dateStr = `${year}-${month}`;
        } else {
          continue;
        }

        // Validate date
        const y = parseInt(year);
        if (y < 1900 || y > 2100) continue;

        results.push({
          date: dateStr,
          context: trimmed.slice(0, 200),
          sourceDoc: docName,
        });
      }
    }
  }

  return results;
}

// ── Graph building ─────────────────────────────────────────────────────────

export function buildWikiGraph(kbId: string): GraphData {
  const pages = listWikiPagesByKb(kbId);
  const docs = listDocuments(kbId);

  // Get L2 (fulltext) pages grouped by docId
  const docContents = new Map<string, { page: WikiPage; content: string; filename: string }>();

  for (const page of pages) {
    if (page.pageType !== "fulltext" || !page.docId) continue;
    const content = getWikiPageContent(page);
    if (!content) continue;
    const doc = docs.find((d) => d.id === page.docId);
    docContents.set(page.docId, { page, content, filename: doc?.filename || page.title });
  }

  // If no L2 pages, fall back to L1 overview pages
  if (docContents.size === 0) {
    for (const page of pages) {
      if (page.pageType !== "overview" || !page.docId) continue;
      const content = getWikiPageContent(page);
      if (!content) continue;
      const doc = docs.find((d) => d.id === page.docId);
      if (!docContents.has(page.docId)) {
        docContents.set(page.docId, { page, content, filename: doc?.filename || page.title });
      }
    }
  }

  const nodes: GraphData["nodes"] = [];
  const edges: GraphData["edges"] = [];
  const edgeSet = new Set<string>();

  // Document-level entities
  const docEntities = new Map<string, ExtractedEntity[]>();

  for (const [docId, { content, filename }] of docContents) {
    // Add document node
    nodes.push({
      id: `doc:${docId}`,
      label: filename.replace(/\.[^.]+$/, ""),
      type: "document",
    });

    // Extract entities from this document
    const entities = extractEntitiesFromText(content);
    // Filter: keep meaningful entities, drop likely false positives
    const significant = entities.filter((e) => {
      if (e.name.length < 2) return false;
      // Skip entities that look like code/technical terms (contain English mixed with Chinese poorly)
      if (/[a-zA-Z]/.test(e.name) && /[\u4e00-\u9fff]/.test(e.name) && e.name.length < 4) return false;
      return true;
    });
    docEntities.set(docId, significant);

    // Add entity nodes and edges
    for (const entity of significant) {
      const entityId = `entity:${entity.type}:${entity.name}`;
      const existing = nodes.find((n) => n.id === entityId);
      if (!existing) {
        nodes.push({
          id: entityId,
          label: entity.name,
          type: "entity",
          meta: entity.type,
        });
      }

      // Add doc → entity edge
      const edgeKey = `doc:${docId}→${entityId}`;
      if (!edgeSet.has(edgeKey)) {
        edgeSet.add(edgeKey);
        edges.push({
          source: `doc:${docId}`,
          target: entityId,
          label: entity.type === "org" ? "机构" :
                 entity.type === "location" ? "地点" :
                 entity.type === "money" ? "金额" :
                 entity.type === "person" ? "人物" : "提及",
          weight: entity.count,
        });
      }
    }
  }

  // Add cross-document edges (documents sharing entities)
  const entityDocs = new Map<string, string[]>();
  for (const [docId, entities] of docEntities) {
    for (const entity of entities) {
      const entityId = `entity:${entity.type}:${entity.name}`;
      if (!entityDocs.has(entityId)) entityDocs.set(entityId, []);
      entityDocs.get(entityId)!.push(docId);
    }
  }

  // Documents sharing entities get connected
  for (const [, docIds] of entityDocs) {
    if (docIds.length < 2) continue;
    for (let i = 0; i < docIds.length; i++) {
      for (let j = i + 1; j < docIds.length; j++) {
        const key = `cross:${docIds[i]}:${docIds[j]}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({
            source: `doc:${docIds[i]}`,
            target: `doc:${docIds[j]}`,
            label: "关联",
            weight: 1,
          });
        }
      }
    }
  }

  return { nodes, edges };
}

// ── Timeline building ──────────────────────────────────────────────────────

export function buildWikiTimeline(kbId: string): TimelineData {
  const pages = listWikiPagesByKb(kbId);
  const docs = listDocuments(kbId);

  const events: TimelineData["events"] = [];
  const seenDates = new Set<string>();

  // Read all L2 pages and extract dates
  for (const page of pages) {
    if (page.pageType !== "fulltext" || !page.docId) continue;
    const content = getWikiPageContent(page);
    if (!content) continue;

    const doc = docs.find((d) => d.id === page.docId);
    const docName = doc?.filename || page.title;

    const dateMatches = extractDatesFromText(content, docName);

    for (const dm of dateMatches) {
      // Deduplicate by date+context
      const dedupeKey = `${dm.date}:${dm.context.slice(0, 50)}`;
      if (seenDates.has(dedupeKey)) continue;
      seenDates.add(dedupeKey);

      events.push({
        id: `ev-${events.length}`,
        timestamp: dm.date,
        description: dm.context,
        entity: "",
        confidence: "confirmed",
        source: dm.sourceDoc,
      });
    }
  }

  // Sort by date
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return { events };
}
