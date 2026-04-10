/**
 * WebFetchTool — 抓取 URL 内容
 *
 * 获取网页内容并转为纯文本/Markdown。
 */

import { z } from "zod";

export const WebFetchToolSchema = z.object({
  url: z.string().describe("要抓取的 URL"),
  format: z.enum(["text", "html"]).optional().default("text").describe("返回格式"),
});

export const WebFetchTool = {
  name: "web_fetch" as const,
  description: "抓取指定 URL 的网页内容，返回纯文本。适合读取网页文章、API 文档等。",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL" },
      format: { type: "string", enum: ["text", "html"], description: "返回格式" },
    },
    required: ["url"],
  },
  isConcurrencySafe: true as const,

  async call(input: z.infer<typeof WebFetchToolSchema>): Promise<string> {
    try {
      const resp = await fetch(input.url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) return `[Error] HTTP ${resp.status}: ${resp.statusText}`;

      const contentType = resp.headers.get("content-type") || "";
      const text = await resp.text();

      if (input.format === "html") return text.slice(0, 50000);

      // Strip HTML tags for text format
      const stripped = text
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      return stripped.slice(0, 30000) || "(空内容)";
    } catch (err) {
      return `[Error] 抓取失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
