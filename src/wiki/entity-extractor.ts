/**
 * Entity Extractor — 从 L1 概览中提取实体，用于构建正反向链接
 *
 * 使用 Agent (LLM) 而非 NER 模型：
 * - 无需额外模型部署
 * - 利用 LLM 的上下文理解能力处理复杂实体
 * - 输出结构化 JSON
 *
 * 设计参考: design.md §4.5 正反向链接机制
 */

import { getModelRouter } from "../models/router.js";

export interface ExtractedEntity {
  name: string;
  type: "person" | "org" | "location" | "time" | "amount" | "case" | "event" | "other";
  aliases?: string[];
  mentions: number;
  context?: string; // 首次出现的上下文片段
}

export interface EntityExtractionResult {
  entities: ExtractedEntity[];
  rawOutput: string;
}

export async function extractEntities(
  content: string,
  filename: string,
): Promise<EntityExtractionResult> {
  const router = getModelRouter();
  const truncated = content.length > 8000 ? content.slice(0, 8000) + "\n...[截断]" : content;

  const resp = await router.chat([
    {
      role: "system",
      content: `你是一个实体提取专家。从给定文档内容中提取所有重要实体。
只输出 JSON，格式如下（不要有任何其他文字）：
{
  "entities": [
    {
      "name": "实体名称",
      "type": "person|org|location|time|amount|case|event|other",
      "aliases": ["别名1", "别名2"],
      "mentions": 出现次数,
      "context": "首次出现的上下文（30字以内）"
    }
  ]
}
实体类型说明：
- person: 人名
- org: 机构/公司/部门
- location: 地点
- time: 时间/日期
- amount: 金额/数量
- case: 案件/事件编号
- event: 重要事件
- other: 其他重要概念`,
    },
    {
      role: "user",
      content: `文档：${filename}\n\n内容：\n${truncated}`,
    },
  ]);

  const raw = resp.content;
  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1] : raw;
    const parsed = JSON.parse(jsonStr.trim());
    return { entities: parsed.entities || [], rawOutput: raw };
  } catch {
    return { entities: [], rawOutput: raw };
  }
}

/**
 * Find matching pages for extracted entities and create wiki links.
 * Called after compileDocument() finishes.
 */
export async function buildEntityLinks(
  kbId: string,
  sourcePageId: string, // L1 page ID
  entities: ExtractedEntity[],
): Promise<void> {
  const { DB } = await import("../store/database.js");
  const { upsertWikiLink } = await import("./page-manager.js");
  const db = DB.getInstance().raw;

  for (const entity of entities) {
    // Search for existing pages that match this entity name
    const namesToSearch = [entity.name, ...(entity.aliases || [])];
    for (const name of namesToSearch) {
      const rows = db.query(
        "SELECT id FROM wiki_pages WHERE kb_id = ? AND (title LIKE ? OR title LIKE ?)",
      ).all(kbId, `%${name}%`, `[L1] %${name}%`) as Array<{ id: string }>;

      for (const row of rows) {
        if (row.id !== sourcePageId) {
          upsertWikiLink(sourcePageId, row.id, "entity_ref", entity.name, entity.context);
        }
      }
    }

    // Auto-create entity page if entity appears 3+ times
    if (entity.mentions >= 3) {
      await ensureEntityPage(kbId, entity);
    }
  }
}

async function ensureEntityPage(kbId: string, entity: ExtractedEntity): Promise<void> {
  const { DB } = await import("../store/database.js");
  const db = DB.getInstance().raw;
  const { createWikiPage } = await import("./page-manager.js");

  // Check if entity page already exists
  const existing = db.query(
    "SELECT id FROM wiki_pages WHERE kb_id = ? AND page_type = 'entity' AND title = ?",
  ).get(kbId, entity.name);

  if (!existing) {
    const content = [
      `# ${entity.name}`,
      "",
      `**类型**: ${entity.type}`,
      entity.aliases?.length ? `**别名**: ${entity.aliases.join("、")}` : "",
      "",
      "## 出现文档",
      "",
      "*此页面由系统自动生成，将随知识库更新自动维护。*",
    ]
      .filter(Boolean)
      .join("\n");

    const { join } = await import("path");
    createWikiPage({
      kbId,
      pageType: "entity",
      title: entity.name,
      content,
      filePath: join("wiki", kbId, "entities", `${entity.name.replace(/[^\w\u4e00-\u9fff]/g, "_")}.md`),
      metadata: { entityType: entity.type, aliases: entity.aliases },
    });
  }
}
