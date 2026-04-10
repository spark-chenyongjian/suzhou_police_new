/**
 * graph_build — Agent 工具：构建关系图谱
 *
 * 从实体和关系中构建关系图谱数据，
 * 存储为 Wiki 页面 + JSON 格式供前端可视化。
 */

import { z } from "zod";
import { randomUUID } from "crypto";
import { DB } from "../../store/database.js";
import { createWikiPage, upsertWikiLink, getWikiPage } from "../../wiki/page-manager.js";
import { indexPageInFts } from "../../wiki/search.js";
import { estimateTokensCJK } from "../../models/provider.js";

export const GraphBuildToolSchema = z.object({
  kb_id: z.string().describe("知识库 ID"),
  title: z.string().describe("图谱标题"),
  entities: z.array(z.object({
    name: z.string().describe("实体名称"),
    type: z.string().describe("实体类型 (person/org/location/event/...)"),
  })).describe("实体列表"),
  relations: z.array(z.object({
    from: z.string().describe("起始实体名称"),
    to: z.string().describe("目标实体名称"),
    relation: z.string().describe("关系描述"),
    source_id: z.string().optional().describe("来源页面 ID"),
    confidence: z.enum(["confirmed", "inferred"]).optional().default("confirmed").describe("可信度"),
  })).describe("关系列表"),
  writeback: z.boolean().optional().default(true).describe("是否回写到 Wiki"),
});

export const GraphBuildTool = {
  name: "graph_build" as const,
  description:
    "从实体和关系中构建关系图谱。将实体和关系存储到数据库，生成可视化的关系图谱文档。图谱数据以 JSON 格式附加在 Wiki 页面中，供前端渲染。",
  inputSchema: {
    type: "object",
    properties: {
      kb_id: { type: "string", description: "知识库 ID" },
      title: { type: "string", description: "图谱标题" },
      entities: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "实体名称" },
            type: { type: "string", description: "实体类型" },
          },
          required: ["name", "type"],
        },
        description: "实体列表",
      },
      relations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from: { type: "string", description: "起始实体" },
            to: { type: "string", description: "目标实体" },
            relation: { type: "string", description: "关系描述" },
            source_id: { type: "string", description: "来源页面 ID" },
            confidence: { type: "string", enum: ["confirmed", "inferred"], description: "可信度" },
          },
          required: ["from", "to", "relation"],
        },
        description: "关系列表",
      },
      writeback: { type: "boolean", description: "是否回写到 Wiki" },
    },
    required: ["kb_id", "title", "entities", "relations"],
  },
  isConcurrencySafe: false as const,

  async call(input: z.infer<typeof GraphBuildToolSchema>): Promise<string> {
    const { kb_id, title, entities, relations } = input;
    const db = DB.getInstance().raw;

    if (entities.length === 0) {
      return "[Error] 实体列表为空，无法构建图谱";
    }

    // Build entity map
    const entityMap = new Map(entities.map((e) => [e.name, e.type]));

    // Store entities as wiki_links (bidirectional)
    // Find or create pages for each entity mentioned in relations
    const entityPageIds = new Map<string, string>();

    for (const entity of entities) {
      // Check if entity page already exists
      const existing = db.query(
        "SELECT id FROM wiki_pages WHERE kb_id = ? AND title = ? AND page_type = 'entity'",
      ).get(kb_id, entity.name) as Record<string, unknown> | null;

      if (existing) {
        entityPageIds.set(entity.name, existing.id as string);
      } else if (input.writeback !== false) {
        const page = createWikiPage({
          kbId: kb_id,
          pageType: "entity",
          title: entity.name,
          content: `# ${entity.name}\n\n**类型**: ${entity.type}\n\n*自动生成的实体页面*`,
          filePath: `wiki/${kb_id}/entities/${entity.name.replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, "_")}.md`,
          metadata: { entityType: entity.type },
        });
        entityPageIds.set(entity.name, page.id);
      }
    }

    // Create relations as wiki_links
    for (const rel of relations) {
      const fromPageId = entityPageIds.get(rel.from);
      const toPageId = entityPageIds.get(rel.to);
      if (fromPageId && toPageId) {
        upsertWikiLink(fromPageId, toPageId, rel.relation, rel.from, rel.source_id);
        // Also create reverse link
        upsertWikiLink(toPageId, fromPageId, `${rel.relation}(反向)`, rel.to, rel.source_id);
      }
    }

    // Build graph document
    const lines: string[] = [
      `# ${title}`,
      "",
      `> 共 ${entities.length} 个实体，${relations.length} 条关系`,
      "",
      "## 实体",
      "",
    ];

    // Group entities by type
    const byType = new Map<string, string[]>();
    for (const e of entities) {
      if (!byType.has(e.type)) byType.set(e.type, []);
      byType.get(e.type)!.push(e.name);
    }
    for (const [type, names] of byType) {
      lines.push(`**${type}**: ${names.join("、")}`);
      lines.push("");
    }

    lines.push("## 关系");
    lines.push("");
    lines.push("| 来源 | 关系 | 目标 | 可信度 |");
    lines.push("|------|------|------|--------|");
    for (const rel of relations) {
      const conf = rel.confidence === "inferred" ? "推断" : "确认";
      lines.push(`| ${rel.from} | ${rel.relation} | ${rel.to} | ${conf} |`);
    }
    lines.push("");

    // Append JSON data for frontend rendering
    const graphData = {
      nodes: entities.map((e) => ({ id: e.name, type: e.type })),
      edges: relations.map((r) => ({
        from: r.from,
        to: r.to,
        label: r.relation,
        confidence: r.confidence || "confirmed",
        sourceId: r.source_id,
      })),
    };
    lines.push("<!-- graph_data");
    lines.push(JSON.stringify(graphData));
    lines.push("-->");

    const content = lines.join("\n");
    const tokens = estimateTokensCJK(content);

    // Writeback to Wiki
    let wikiPageId: string | null = null;
    if (input.writeback !== false) {
      const page = createWikiPage({
        kbId: kb_id,
        pageType: "report",
        title: `[图谱] ${title}`,
        content,
        filePath: `wiki/${kb_id}/reports/graph_${randomUUID().slice(0, 8)}.md`,
        tokenCount: tokens,
        metadata: {
          type: "graph",
          nodeCount: entities.length,
          edgeCount: relations.length,
          graphData,
        },
      });
      wikiPageId = page.id;
      indexPageInFts(page.id, kb_id, "fulltext", content);
    }

    return [
      `## 关系图谱已构建`,
      `**标题**: ${title}`,
      `**实体数**: ${entities.length}`,
      `**关系数**: ${relations.length}`,
      wikiPageId ? `**Wiki 页面**: \`${wikiPageId}\`` : "",
      "",
      "图谱预览:",
      "",
      ...lines.slice(0, 30),
      content.length > 2000 ? "\n...[截断]" : "",
    ].filter(Boolean).join("\n");
  },
};
