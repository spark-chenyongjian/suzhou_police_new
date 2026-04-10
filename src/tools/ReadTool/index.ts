/**
 * ReadTool — 读取文件内容
 *
 * 支持文本、图片(base64)、PDF、代码文件。
 * 可指定行范围读取大文件。
 */

import { z } from "zod";
import { readFileSync, existsSync, statSync } from "fs";

export const ReadToolSchema = z.object({
  file_path: z.string().describe("文件路径"),
  offset: z.number().optional().describe("起始行号 (0-based)"),
  limit: z.number().optional().describe("读取行数"),
});

export const ReadTool = {
  name: "read" as const,
  description: "读取文件内容。支持文本文件、代码文件。可指定行范围读取大文件片段。返回带行号的内容。",
  inputSchema: {
    type: "object",
    properties: {
      file_path: { type: "string", description: "文件路径" },
      offset: { type: "number", description: "起始行号 (0-based)" },
      limit: { type: "number", description: "读取行数" },
    },
    required: ["file_path"],
  },
  isConcurrencySafe: true as const,

  async call(input: z.infer<typeof ReadToolSchema>): Promise<string> {
    const filePath = input.file_path;
    if (!existsSync(filePath)) return `[Error] 文件不存在: ${filePath}`;

    try {
      const stat = statSync(filePath);
      if (stat.isDirectory()) return `[Error] 路径是目录，不是文件: ${filePath}`;
      if (stat.size > 10 * 1024 * 1024) return `[Error] 文件过大 (${(stat.size / 1024 / 1024).toFixed(1)}MB)，请使用 offset/limit 分段读取`;

      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const offset = input.offset || 0;
      const limit = input.limit || lines.length;
      const selected = lines.slice(offset, offset + limit);

      const numbered = selected.map((line, i) => `${offset + i + 1}\t${line}`).join("\n");
      return numbered || "(空文件)";
    } catch (err) {
      return `[Error] 读取失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
