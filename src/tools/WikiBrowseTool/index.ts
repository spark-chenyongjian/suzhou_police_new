/**
 * wiki_browse — Agent 工具：浏览知识库索引和实体页面
 *
 * 让 Agent 像浏览 Wiki 一样导航知识库：
 * - 查看知识库全局 index.md
 * - 列出所有文档摘要
 * - 查找特定实体页面
 */

import { z } from "zod";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { listWikiPagesByKb } from "../../wiki/page-manager.js";

const DATA_DIR = join(process.cwd(), "data");

export const WikiBrowseInputSchema = z.object({
  kbId: z.string().describe("Knowledge base ID"),
  view: z.enum(["index", "abstracts", "entities", "page"]).describe("What to browse"),
  pageId: z.string().optional().describe("Specific page ID (for view=page)"),
});

export type WikiBrowseInput = z.infer<typeof WikiBrowseInputSchema>;

export const WikiBrowseTool = {
  name: "wiki_browse" as const,
  description:
    "Browse the knowledge base Wiki. Use view=index for the global overview, view=abstracts to list all document summaries (L0), view=entities to see entity pages, or view=page with a pageId to read a specific page.",
  inputSchema: {
    type: "object",
    properties: {
      kbId: { type: "string", description: "Knowledge base ID" },
      view: {
        type: "string",
        enum: ["index", "abstracts", "entities", "page"],
        description: "Browse mode",
      },
      pageId: { type: "string", description: "Page ID (required for view=page)" },
    },
    required: ["kbId", "view"],
  },
  isConcurrencySafe: true as const,

  async call(input: WikiBrowseInput): Promise<string> {
    const { kbId, view } = input;

    if (view === "index") {
      const indexPath = join(DATA_DIR, "wiki", kbId, "index.md");
      if (!existsSync(indexPath)) {
        return `## 知识库索引\n\n知识库 ${kbId} 尚无文档。`;
      }
      return `## 知识库索引\n\n${readFileSync(indexPath, "utf-8")}`;
    }

    if (view === "abstracts") {
      const pages = listWikiPagesByKb(kbId, "abstract");
      if (pages.length === 0) {
        return `## 文档摘要列表\n\n知识库 ${kbId} 尚无已编译文档。`;
      }
      const lines = [`## 文档摘要列表 (${pages.length}篇)`, ""];
      for (const page of pages) {
        const absPath = join(DATA_DIR, page.filePath);
        const content = existsSync(absPath) ? readFileSync(absPath, "utf-8") : "(内容缺失)";
        lines.push(`### ${page.title}`);
        lines.push(`**page_id**: \`${page.id}\``);
        lines.push(content.slice(0, 500));
        lines.push("");
      }
      return lines.join("\n");
    }

    if (view === "entities") {
      const entDir = join(DATA_DIR, "wiki", kbId, "entities");
      if (!existsSync(entDir)) {
        return `## 实体页面\n\n知识库 ${kbId} 尚无实体页面。`;
      }
      const { readdirSync } = await import("fs");
      const files = readdirSync(entDir).filter((f) => f.endsWith(".md"));
      if (files.length === 0) return `## 实体页面\n\n暂无实体页面。`;
      const lines = [`## 实体页面列表 (${files.length}个)`, ""];
      for (const f of files) {
        lines.push(`- ${f.replace(".md", "")} → \`entities/${f}\``);
      }
      return lines.join("\n");
    }

    if (view === "page") {
      if (!input.pageId) return "[wiki_browse] pageId is required for view=page";
      const { getWikiPage, getWikiPageContent } = await import("../../wiki/page-manager.js");
      const page = getWikiPage(input.pageId);
      if (!page) return `[wiki_browse] Page not found: ${input.pageId}`;
      return `## ${page.title}\n\n${getWikiPageContent(page)}`;
    }

    return "[wiki_browse] Unknown view.";
  },
};
