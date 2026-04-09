/**
 * kb_search — Agent 工具：三路融合知识库检索
 *
 * Agent 通过此工具在知识库中检索相关文档，
 * 返回 L0/L1 摘要 + 命中片段 + 溯源标注。
 */

import { z } from "zod";
import { kbSearch } from "../../wiki/search.js";

export const KbSearchInputSchema = z.object({
  query: z.string().describe("Search query in natural language or keywords"),
  kbId: z.string().describe("Knowledge base ID to search in"),
  topK: z.number().int().min(1).max(50).optional().default(10).describe("Number of results to return"),
  levels: z.array(z.enum(["abstract", "overview", "fulltext"])).optional()
    .describe("Wiki levels to search (default: abstract + overview)"),
  expandLinks: z.boolean().optional().default(true).describe("Expand results via link traversal"),
});

export type KbSearchInput = z.infer<typeof KbSearchInputSchema>;

export const KbSearchTool = {
  name: "kb_search" as const,
  description:
    "Search the knowledge base using hybrid retrieval (BM25 full-text + link traversal + RRF fusion). Returns ranked results with snippets and relevance scores. Use this as the primary tool for finding relevant documents and passages. Start with abstract/overview levels for efficiency, then use expand tool to drill into specifics.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query" },
      kbId: { type: "string", description: "Knowledge base ID" },
      topK: { type: "number", description: "Number of results (default: 10)" },
      levels: {
        type: "array",
        items: { type: "string", enum: ["abstract", "overview", "fulltext"] },
        description: "Which Wiki levels to search",
      },
      expandLinks: { type: "boolean", description: "Follow links to expand results" },
    },
    required: ["query", "kbId"],
  },
  isConcurrencySafe: true as const,

  async call(input: KbSearchInput): Promise<string> {
    const hits = await kbSearch({
      query: input.query,
      kbId: input.kbId,
      topK: input.topK || 10,
      levels: input.levels,
      expandLinks: input.expandLinks !== false,
    });

    if (hits.length === 0) {
      return `## kb_search: 未找到结果\n\n查询: "${input.query}"\n知识库: ${input.kbId}\n\n建议尝试不同关键词或扩大搜索范围。`;
    }

    const lines = [
      `## kb_search 结果 (${hits.length}条)`,
      `查询: "${input.query}"`,
      "",
    ];

    for (const hit of hits) {
      lines.push(`### [${hit.pageType.toUpperCase()}] ${hit.title}`);
      lines.push(`- **page_id**: \`${hit.pageId}\``);
      lines.push(`- **score**: ${hit.score.toFixed(4)}`);
      lines.push(`- **来源**: ${hit.sources.join(", ")}`);
      if (hit.snippet) {
        lines.push(`- **片段**: ${hit.snippet}`);
      }
      lines.push(`- *使用 expand("${hit.pageId}") 查看完整内容*`);
      lines.push("");
    }

    return lines.join("\n");
  },
};
