/**
 * wiki_lint — Agent 工具：Wiki 健康检查
 *
 * 检查项：
 * - orphans: 孤立页面（无入链无出链）
 * - missing_links: 提及实体但未创建链接的页面
 * - stale_summaries: L0/L1 摘要与 L2 内容不匹配
 * - index_sync: 索引页面与实际页面不同步
 */

import { z } from "zod";
import { DB } from "../../store/database.js";
import {
  listWikiPagesByKb,
  getWikiPageContent,
} from "../../wiki/page-manager.js";

type CheckType = "orphans" | "missing_links" | "stale_summaries" | "index_sync";

export const WikiLintToolSchema = z.object({
  kb_id: z.string().describe("知识库 ID"),
  checks: z.array(z.enum(["orphans", "missing_links", "stale_summaries", "index_sync"])).optional()
    .describe("要执行的检查项，默认全部"),
});

export const WikiLintTool = {
  name: "wiki_lint" as const,
  description:
    "对知识库的 Wiki 进行健康检查。检测孤立页面、缺失链接、过期摘要、索引不同步等问题。返回检查报告和修复建议。",
  inputSchema: {
    type: "object",
    properties: {
      kb_id: { type: "string", description: "知识库 ID" },
      checks: {
        type: "array",
        items: { type: "string", enum: ["orphans", "missing_links", "stale_summaries", "index_sync"] },
        description: "检查项 (默认全部)",
      },
    },
    required: ["kb_id"],
  },
  isConcurrencySafe: true as const,

  async call(input: z.infer<typeof WikiLintToolSchema>): Promise<string> {
    const db = DB.getInstance().raw;
    const kbId = input.kb_id;
    const checks = input.checks || ["orphans", "missing_links", "stale_summaries", "index_sync"] as CheckType[];

    const allChecks: CheckType[] = ["orphans", "missing_links", "stale_summaries", "index_sync"];
    const activeChecks = checks.filter((c) => allChecks.includes(c));
    const lines: string[] = [`## Wiki 健康检查: ${kbId}`, ""];

    // Get all pages for this KB
    const pages = listWikiPagesByKb(kbId);
    lines.push(`**页面总数**: ${pages.length}`);
    lines.push(`**检查项**: ${activeChecks.join(", ")}`);
    lines.push("");

    if (activeChecks.includes("orphans")) {
      lines.push("### 孤立页面检查");
      const pagesWithLinks = new Set<string>();
      const linkedRows = db.query(
        "SELECT DISTINCT source_page_id, target_page_id FROM wiki_links WHERE source_page_id IN (SELECT id FROM wiki_pages WHERE kb_id = ?) OR target_page_id IN (SELECT id FROM wiki_pages WHERE kb_id = ?)",
      ).all(kbId, kbId) as Record<string, unknown>[];
      for (const row of linkedRows) {
        pagesWithLinks.add(row.source_page_id as string);
        pagesWithLinks.add(row.target_page_id as string);
      }

      const orphans = pages.filter((p) => !pagesWithLinks.has(p.id));
      if (orphans.length === 0) {
        lines.push("✅ 无孤立页面");
      } else {
        lines.push(`⚠️ 发现 ${orphans.length} 个孤立页面:`);
        for (const p of orphans.slice(0, 20)) {
          lines.push(`  - \`${p.id}\` [${p.pageType}] ${p.title}`);
        }
        if (orphans.length > 20) lines.push(`  ... 还有 ${orphans.length - 20} 个`);
      }
      lines.push("");
    }

    if (activeChecks.includes("stale_summaries")) {
      lines.push("### 摘要新鲜度检查");
      const abstracts = pages.filter((p) => p.pageType === "abstract");
      const overviews = pages.filter((p) => p.pageType === "overview");
      const fulltexts = pages.filter((p) => p.pageType === "fulltext");

      // Check if abstracts/overviews have corresponding fulltexts
      const fulltextByDoc = new Map(fulltexts.map((p) => [p.docId, p]));

      let staleCount = 0;
      for (const abs of abstracts) {
        if (!abs.docId) continue;
        const ft = fulltextByDoc.get(abs.docId);
        if (ft && ft.updatedAt > abs.updatedAt) {
          staleCount++;
          if (staleCount <= 10) {
            lines.push(`  - ⚠️ \`${abs.id}\` 摘要过期 (摘要: ${abs.updatedAt}, 原文: ${ft.updatedAt})`);
          }
        }
      }
      for (const ov of overviews) {
        if (!ov.docId) continue;
        const ft = fulltextByDoc.get(ov.docId);
        if (ft && ft.updatedAt > ov.updatedAt) {
          staleCount++;
          if (staleCount <= 10) {
            lines.push(`  - ⚠️ \`${ov.id}\` 概览过期 (概览: ${ov.updatedAt}, 原文: ${ft.updatedAt})`);
          }
        }
      }
      if (staleCount === 0) {
        lines.push("✅ 所有摘要都是最新的");
      } else {
        lines.push(`⚠️ 共 ${staleCount} 个摘要需要更新`);
      }
      lines.push("");
    }

    if (activeChecks.includes("index_sync")) {
      lines.push("### 索引同步检查");
      // Check if all pages have FTS entries
      const ftsPages = db.query(
        "SELECT DISTINCT page_id FROM fts_content WHERE kb_id = ?",
      ).all(kbId) as Record<string, unknown>[];
      const ftsPageIds = new Set(ftsPages.map((r) => r.page_id as string));
      const unindexed = pages.filter((p) => !ftsPageIds.has(p.id) && p.pageType !== "entity");

      if (unindexed.length === 0) {
        lines.push("✅ 所有页面已索引");
      } else {
        lines.push(`⚠️ ${unindexed.length} 个页面未建立 FTS 索引:`);
        for (const p of unindexed.slice(0, 15)) {
          lines.push(`  - \`${p.id}\` [${p.pageType}] ${p.title}`);
        }
      }
      lines.push("");
    }

    if (activeChecks.includes("missing_links")) {
      lines.push("### 缺失链接检查");
      // Find pages that mention entity-like patterns [[...]] but don't have links
      let missingCount = 0;
      const entityPages = pages.filter((p) => p.pageType === "entity");
      const entityNames = new Set(entityPages.map((p) => p.title));

      const nonEntityPages = pages.filter((p) => p.pageType !== "entity");
      for (const page of nonEntityPages.slice(0, 50)) {
        const content = getWikiPageContent(page);
        const mentions = content.match(/\[\[([^\]]+)\]\]/g) || [];
        for (const mention of mentions) {
          const name = mention.slice(2, -2);
          if (entityNames.has(name)) {
            // Check if link exists
            const linkExists = db.query(
              "SELECT 1 FROM wiki_links WHERE source_page_id = ? AND entity_name = ?",
            ).get(page.id, name);
            if (!linkExists) {
              missingCount++;
              if (missingCount <= 10) {
                lines.push(`  - ⚠️ 页面 "${page.title}" 提及 [[${name}]] 但无链接`);
              }
            }
          }
        }
      }
      if (missingCount === 0) {
        lines.push("✅ 无缺失链接");
      } else {
        lines.push(`⚠️ 共发现 ${missingCount} 个缺失链接`);
      }
      lines.push("");
    }

    lines.push("---");
    lines.push("*检查完成。建议定期运行 wiki_lint 保持知识库健康。*");

    return lines.join("\n");
  },
};
