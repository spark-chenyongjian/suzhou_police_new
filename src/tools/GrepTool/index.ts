/**
 * GrepTool — 文件内容搜索
 *
 * 基于 ripgrep (rg) 的高性能内容搜索。
 */

import { z } from "zod";
import { execSync } from "child_process";

export const GrepToolSchema = z.object({
  pattern: z.string().describe("搜索正则表达式"),
  path: z.string().optional().describe("搜索目录路径"),
  glob: z.string().optional().describe("文件模式过滤 (如 *.ts)"),
  ignore_case: z.boolean().optional().default(false).describe("忽略大小写"),
  output_mode: z.enum(["content", "files_with_matches", "count"]).optional().default("content"),
  head_limit: z.number().optional().default(50).describe("结果数量限制"),
});

export const GrepTool = {
  name: "grep" as const,
  description: "在文件中搜索匹配正则表达式的内容。基于 ripgrep，支持正则、大小写、文件类型过滤。返回匹配行或文件列表。",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "正则表达式" },
      path: { type: "string", description: "搜索目录" },
      glob: { type: "string", description: "文件模式" },
      ignore_case: { type: "boolean", description: "忽略大小写" },
      output_mode: { type: "string", enum: ["content", "files_with_matches", "count"], description: "输出模式" },
      head_limit: { type: "number", description: "结果数量限制" },
    },
    required: ["pattern"],
  },
  isConcurrencySafe: true as const,

  async call(input: z.infer<typeof GrepToolSchema>): Promise<string> {
    const args: string[] = ["rg"];

    if (input.ignore_case) args.push("-i");

    const mode = input.output_mode || "content";
    if (mode === "files_with_matches") args.push("-l");
    else if (mode === "count") args.push("-c");
    else args.push("-n");

    args.push("--max-count", String(input.head_limit || 50));
    if (input.glob) args.push("--glob", input.glob);

    // Sanitize pattern
    const pattern = input.pattern.replace(/[`$\\]/g, (c) => `\\${c}`);
    args.push(pattern);

    if (input.path) args.push(input.path);

    try {
      const result = execSync(args.join(" "), {
        encoding: "utf-8",
        maxBuffer: 1024 * 1024,
        timeout: 10000,
      });
      return result.trim() || "(无匹配)";
    } catch (err: any) {
      if (err.status === 1) return "(无匹配)";
      return `[Error] ${err.message || String(err)}`;
    }
  },
};
