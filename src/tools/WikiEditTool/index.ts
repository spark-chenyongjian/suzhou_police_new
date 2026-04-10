/**
 * wiki_edit — Agent 工具：编辑 Wiki 页面内容
 *
 * 支持 create / update / append 三种操作，
 * 用于知识复利（分析结果回写 Wiki）。
 */

import { z } from "zod";
import {
  createWikiPage,
  getWikiPage,
  updateWikiPage,
  listWikiPagesByKb,
} from "../../wiki/page-manager.js";
import { indexPageInFts } from "../../wiki/search.js";
import { estimateTokensCJK } from "../../models/provider.js";

export const WikiEditToolSchema = z.object({
  kb_id: z.string().describe("知识库 ID"),
  operation: z.enum(["create", "update", "append"]).describe("操作类型"),
  title: z.string().describe("页面标题"),
  content: z.string().describe("页面内容 (Markdown)"),
  page_id: z.string().optional().describe("页面 ID (update/append 时必填)"),
  page_type: z.enum(["entity", "report", "note"]).optional().default("note").describe("页面类型 (create 时)"),
  metadata: z.record(z.unknown()).optional().describe("额外元数据"),
});

export const WikiEditTool = {
  name: "wiki_edit" as const,
  description:
    "编辑知识库中的 Wiki 页面。支持创建新页面、更新已有页面、追加内容到已有页面。用于将分析结果、实体信息回写到知识库（知识复利）。创建/更新后会自动更新 FTS 全文索引。",
  inputSchema: {
    type: "object",
    properties: {
      kb_id: { type: "string", description: "知识库 ID" },
      operation: { type: "string", enum: ["create", "update", "append"], description: "操作类型" },
      title: { type: "string", description: "页面标题" },
      content: { type: "string", description: "Markdown 内容" },
      page_id: { type: "string", description: "页面 ID (update/append)" },
      page_type: { type: "string", enum: ["entity", "report", "note"], description: "页面类型" },
      metadata: { type: "object", description: "额外元数据" },
    },
    required: ["kb_id", "operation", "title", "content"],
  },
  isConcurrencySafe: false as const,

  async call(input: z.infer<typeof WikiEditToolSchema>): Promise<string> {
    const { kb_id, operation, title, content } = input;

    switch (operation) {
      case "create": {
        const filePath = `wiki/${kb_id}/notes/${title.replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, "_")}.md`;
        const tokens = estimateTokensCJK(content);
        const page = createWikiPage({
          kbId: kb_id,
          pageType: input.page_type || "note",
          title,
          content,
          filePath,
          tokenCount: tokens,
          metadata: input.metadata,
        });
        indexPageInFts(page.id, kb_id, "fulltext", content);
        return `## Wiki 页面已创建\n- **ID**: ${page.id}\n- **标题**: ${title}\n- **类型**: ${input.page_type || "note"}\n- **Token 数**: ${tokens}`;
      }

      case "update": {
        const pageId = input.page_id;
        if (!pageId) return "[Error] update 操作需要提供 page_id";
        const page = getWikiPage(pageId);
        if (!page) return `[Error] 页面不存在: ${pageId}`;
        if (page.kbId !== kb_id) return `[Error] 页面不属于该知识库`;
        const tokens = estimateTokensCJK(content);
        updateWikiPage(pageId, content, tokens);
        indexPageInFts(pageId, kb_id, "fulltext", content);
        return `## Wiki 页面已更新\n- **ID**: ${pageId}\n- **标题**: ${title}\n- **Token 数**: ${tokens}`;
      }

      case "append": {
        const pageId = input.page_id;
        if (!pageId) return "[Error] append 操作需要提供 page_id";
        const page = getWikiPage(pageId);
        if (!page) return `[Error] 页面不存在: ${pageId}`;
        if (page.kbId !== kb_id) return `[Error] 页面不属于该知识库`;

        const { getWikiPageContent } = await import("../../wiki/page-manager.js");
        const existingContent = getWikiPageContent(page);
        const newContent = existingContent + "\n\n---\n\n" + content;
        const tokens = estimateTokensCJK(newContent);
        updateWikiPage(pageId, newContent, tokens);
        indexPageInFts(pageId, kb_id, "fulltext", newContent);
        return `## 内容已追加到 Wiki 页面\n- **ID**: ${pageId}\n- **原标题**: ${page.title}\n- **新 Token 数**: ${tokens}`;
      }

      default:
        return `[Error] 未知操作: ${operation}`;
    }
  },
};
