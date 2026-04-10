/**
 * timeline_build — Agent 工具：从证据中构建时间线
 *
 * 将 Agent 收集到的事件按时间排序，生成分组时间线，
 * 并作为 Wiki 页面回写到知识库。
 */

import { z } from "zod";
import { randomUUID } from "crypto";
import { createWikiPage } from "../../wiki/page-manager.js";
import { indexPageInFts } from "../../wiki/search.js";
import { estimateTokensCJK } from "../../models/provider.js";

export const TimelineBuildToolSchema = z.object({
  kb_id: z.string().describe("知识库 ID"),
  title: z.string().describe("时间线标题"),
  events: z.array(z.object({
    timestamp: z.string().describe("事件时间 (ISO 格式或自然语言)"),
    description: z.string().describe("事件描述"),
    source_id: z.string().optional().describe("来源页面 ID"),
    source_location: z.string().optional().describe("来源位置描述"),
    confidence: z.enum(["confirmed", "inferred"]).optional().default("confirmed").describe("可信度"),
    entity: z.string().optional().describe("关联实体"),
  })).describe("事件列表"),
  group_by: z.enum(["day", "month", "entity"]).optional().describe("分组方式"),
  writeback: z.boolean().optional().default(true).describe("是否回写到 Wiki"),
});

export const TimelineBuildTool = {
  name: "timeline_build" as const,
  description:
    "从证据中构建结构化时间线。将事件按时间排序，支持按天/月/实体分组。结果可回写到 Wiki 供后续引用。每个事件标注来源和可信度。",
  inputSchema: {
    type: "object",
    properties: {
      kb_id: { type: "string", description: "知识库 ID" },
      title: { type: "string", description: "时间线标题" },
      events: {
        type: "array",
        items: {
          type: "object",
          properties: {
            timestamp: { type: "string", description: "事件时间" },
            description: { type: "string", description: "事件描述" },
            source_id: { type: "string", description: "来源页面 ID" },
            source_location: { type: "string", description: "来源位置" },
            confidence: { type: "string", enum: ["confirmed", "inferred"], description: "可信度" },
            entity: { type: "string", description: "关联实体" },
          },
          required: ["timestamp", "description"],
        },
        description: "事件列表",
      },
      group_by: { type: "string", enum: ["day", "month", "entity"], description: "分组方式" },
      writeback: { type: "boolean", description: "是否回写到 Wiki" },
    },
    required: ["kb_id", "title", "events"],
  },
  isConcurrencySafe: false as const,

  async call(input: z.infer<typeof TimelineBuildToolSchema>): Promise<string> {
    const { kb_id, title, events, group_by } = input;

    if (events.length === 0) {
      return "[Error] 事件列表为空，无法构建时间线";
    }

    // Sort events by timestamp
    const sorted = [...events].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );

    // Build timeline content
    const lines: string[] = [
      `# ${title}`,
      "",
      `> 时间线共 ${sorted.length} 个事件，按时间排序`,
      "",
    ];

    if (group_by === "entity") {
      // Group by entity
      const groups = new Map<string, typeof sorted>();
      for (const ev of sorted) {
        const key = ev.entity || "未分类";
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(ev);
      }
      for (const [entity, evts] of groups) {
        lines.push(`## ${entity}`);
        lines.push("");
        for (const ev of evts) {
          const conf = ev.confidence === "inferred" ? "🔴" : "🟢";
          const src = ev.source_id ? ` [来源](${ev.source_id})` : "";
          lines.push(`- **${ev.timestamp}** ${conf} ${ev.description}${src}`);
        }
        lines.push("");
      }
    } else if (group_by === "month") {
      // Group by month
      const groups = new Map<string, typeof sorted>();
      for (const ev of sorted) {
        const month = ev.timestamp.slice(0, 7); // YYYY-MM
        if (!groups.has(month)) groups.set(month, []);
        groups.get(month)!.push(ev);
      }
      for (const [month, evts] of groups) {
        lines.push(`## ${month}`);
        lines.push("");
        for (const ev of evts) {
          const conf = ev.confidence === "inferred" ? "🔴" : "🟢";
          const src = ev.source_id ? ` [来源](${ev.source_id})` : "";
          const entity = ev.entity ? ` [${ev.entity}]` : "";
          lines.push(`- **${ev.timestamp}** ${conf} ${ev.description}${entity}${src}`);
        }
        lines.push("");
      }
    } else {
      // Default: flat timeline
      lines.push("| 时间 | 可信度 | 事件 | 来源 |");
      lines.push("|------|--------|------|------|");
      for (const ev of sorted) {
        const conf = ev.confidence === "inferred" ? "推断" : "确认";
        const src = ev.source_location || ev.source_id || "";
        const entity = ev.entity ? ` [${ev.entity}]` : "";
        lines.push(`| ${ev.timestamp} | ${conf} | ${ev.description}${entity} | ${src} |`);
      }
      lines.push("");
    }

    // Legend
    lines.push("---");
    lines.push("*🟢 = 已确认  🔴 = 推断*");

    const content = lines.join("\n");
    const tokens = estimateTokensCJK(content);

    // Writeback to Wiki
    let wikiPageId: string | null = null;
    if (input.writeback !== false) {
      const page = createWikiPage({
        kbId: kb_id,
        pageType: "report",
        title: `[时间线] ${title}`,
        content,
        filePath: `wiki/${kb_id}/reports/timeline_${randomUUID().slice(0, 8)}.md`,
        tokenCount: tokens,
        metadata: { type: "timeline", eventCount: events.length },
      });
      wikiPageId = page.id;
      indexPageInFts(page.id, kb_id, "fulltext", content);
    }

    return [
      `## 时间线已构建`,
      `**标题**: ${title}`,
      `**事件数**: ${sorted.length}`,
      `**分组**: ${group_by || "按时间排序"}`,
      wikiPageId ? `**Wiki 页面**: \`${wikiPageId}\`` : "",
      "",
      "预览:",
      content.slice(0, 2000) + (content.length > 2000 ? "\n...[截断]" : ""),
    ].filter(Boolean).join("\n");
  },
};
