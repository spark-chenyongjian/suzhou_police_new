/**
 * GlobTool — 文件模式匹配搜索
 *
 * 基于 glob 模式查找文件。
 */

import { z } from "zod";
import { execSync } from "child_process";

export const GlobToolSchema = z.object({
  pattern: z.string().describe("Glob 模式 (如 **/*.ts)"),
  path: z.string().optional().describe("搜索目录路径"),
});

export const GlobTool = {
  name: "glob" as const,
  description: "使用 glob 模式查找文件。支持 **/*.ext 等模式。返回匹配的文件路径列表。",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob 模式 (如 **/*.ts)" },
      path: { type: "string", description: "搜索目录" },
    },
    required: ["pattern"],
  },
  isConcurrencySafe: true as const,

  async call(input: z.infer<typeof GlobToolSchema>): Promise<string> {
    const pattern = input.pattern.replace(/[`$\\]/g, "");
    const dir = input.path || ".";
    try {
      const result = execSync(`find "${dir}" -name "${pattern}" -type f 2>/dev/null | head -200`, {
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
        timeout: 10000,
      });
      return result.trim() || "(无匹配文件)";
    } catch (err) {
      return `[Error] ${err instanceof Error ? err.message : String(err)}`;
    }
  },
};
