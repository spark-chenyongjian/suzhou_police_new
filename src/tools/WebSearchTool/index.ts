/**
 * WebSearchTool — 联网搜索
 *
 * 通过 DuckDuckGo Lite 或配置的搜索 API 进行搜索。
 */

import { z } from "zod";

export const WebSearchToolSchema = z.object({
  query: z.string().describe("搜索关键词"),
  max_results: z.number().optional().default(5).describe("最大结果数"),
});

export const WebSearchTool = {
  name: "web_search" as const,
  description: "在互联网上搜索信息。返回搜索结果标题、链接和摘要。适合查找公开资料、新闻、技术文档等。",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "搜索关键词" },
      max_results: { type: "number", description: "最大结果数" },
    },
    required: ["query"],
  },
  isConcurrencySafe: true as const,

  async call(input: z.infer<typeof WebSearchToolSchema>): Promise<string> {
    const query = encodeURIComponent(input.query);
    const maxResults = input.max_results || 5;

    try {
      const resp = await fetch(
        `https://html.duckduckgo.com/html/?q=${query}`,
        { headers: { "User-Agent": "Mozilla/5.0" } },
      );
      const html = await resp.text();

      // Extract results from DuckDuckGo HTML
      const results: Array<{ title: string; url: string; snippet: string }> = [];
      const resultRegex = /<a rel="nofollow" class="result__a" href="([^"]+)">([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      let match;
      while ((match = resultRegex.exec(html)) !== null && results.length < maxResults) {
        results.push({
          url: match[1],
          title: match[2].replace(/<[^>]+>/g, "").trim(),
          snippet: match[3].replace(/<[^>]+>/g, "").trim(),
        });
      }

      if (results.length === 0) {
        return `搜索 "${input.query}" 无结果`;
      }

      return results.map((r, i) =>
        `### ${i + 1}. ${r.title}\n**URL**: ${r.url}\n${r.snippet}`,
      ).join("\n\n");
    } catch (err) {
      return `[Error] 搜索失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
