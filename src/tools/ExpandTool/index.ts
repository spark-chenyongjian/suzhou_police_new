/**
 * expand — Agent 工具：逐层展开 Wiki 内容
 *
 * 参考 lossless-claw 的 expand 设计：
 * L0 -> L1 -> L2 -> 原始文档位置
 *
 * Agent 先搜索到 L0 摘要，用此工具按需展开细节，
 * 避免一次性加载全量文档消耗过多上下文。
 */

import { z } from "zod";
import { getWikiPage, getWikiPageContent, listWikiPagesByDoc } from "../../wiki/page-manager.js";

export const ExpandInputSchema = z.object({
  pageId: z.string().optional().describe("Page ID to expand (returned by kb_search)"),
  docId: z.string().optional().describe("Document ID to expand to a specific level"),
  level: z.enum(["l0", "l1", "l2", "abstract", "overview", "fulltext"]).optional()
    .describe("Target level when using docId"),
  section: z.string().optional().describe("Optional: section heading to focus on"),
});

export type ExpandInput = z.infer<typeof ExpandInputSchema>;

const LEVEL_MAP: Record<string, string> = {
  l0: "abstract", abstract: "abstract",
  l1: "overview", overview: "overview",
  l2: "fulltext", fulltext: "fulltext",
};

export const ExpandTool = {
  name: "expand" as const,
  description:
    "Expand a Wiki page to get its full content. Use this after kb_search returns a pageId. Can expand by pageId directly, or by docId + level (l0/l1/l2). Optionally filter to a specific section heading. Use l0→l1→l2 progressively to drill down without loading unnecessary content.",
  inputSchema: {
    type: "object",
    properties: {
      pageId: { type: "string", description: "Page ID from kb_search results" },
      docId: { type: "string", description: "Document ID to expand" },
      level: { type: "string", enum: ["l0", "l1", "l2", "abstract", "overview", "fulltext"], description: "Target level" },
      section: { type: "string", description: "Optional section heading to filter" },
    },
  },
  isConcurrencySafe: true as const,

  async call(input: ExpandInput): Promise<string> {
    let content: string;
    let pageTitle: string;
    let pageType: string;

    if (input.pageId) {
      const page = getWikiPage(input.pageId);
      if (!page) return `[expand] Page not found: ${input.pageId}`;
      content = getWikiPageContent(page);
      pageTitle = page.title;
      pageType = page.pageType;
    } else if (input.docId) {
      const targetType = LEVEL_MAP[input.level?.toLowerCase() || "l1"] || "overview";
      const pages = listWikiPagesByDoc(input.docId);
      const page = pages.find((p) => p.pageType === targetType);
      if (!page) return `[expand] No ${input.level || "l1"} page for document ${input.docId}`;
      content = getWikiPageContent(page);
      pageTitle = page.title;
      pageType = page.pageType;
    } else {
      return "[expand] Either pageId or docId must be provided.";
    }

    // Filter to section if requested
    if (input.section && content) {
      content = extractSection(content, input.section);
    }

    const header = [
      `## Expand: ${pageTitle} [${pageType.toUpperCase()}]`,
      "",
    ].join("\n");

    return header + content;
  },
};

function extractSection(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const headingLower = heading.toLowerCase();
  let found = false;
  let depth = 0;
  const result: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.*)/);
    if (match) {
      const level = match[1].length;
      const text = match[2].toLowerCase();
      if (!found && text.includes(headingLower)) {
        found = true;
        depth = level;
        result.push(line);
      } else if (found) {
        if (level <= depth && result.length > 1) break; // end of section
        result.push(line);
      }
    } else if (found) {
      result.push(line);
    }
  }

  if (result.length === 0) {
    return `*Section "${heading}" not found. Full content:\n\n${markdown}`;
  }
  return result.join("\n");
}
