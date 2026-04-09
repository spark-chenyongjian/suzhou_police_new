/**
 * report_generate — 生成结构化分析报告
 *
 * 将 Agent 分析过程中收集的信息整合为带溯源标注的报告，
 * 并可选择将报告回写为 Wiki 页面（知识复利）。
 */

import { z } from "zod";
import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { randomUUID } from "crypto";
import { DB } from "../../store/database.js";
import { createWikiPage } from "../../wiki/page-manager.js";

export const ReportGenerateInputSchema = z.object({
  kbId: z.string().describe("Knowledge base ID"),
  title: z.string().describe("Report title"),
  content: z.string().describe("Report content in Markdown format, with source citations"),
  reportType: z.enum(["analysis", "summary", "timeline", "comparison", "investigation"])
    .optional().default("analysis")
    .describe("Type of report"),
  writebackToWiki: z.boolean().optional().default(true)
    .describe("Whether to write the report back as a Wiki page for future reference"),
  sessionId: z.string().optional().describe("Session ID for linking"),
});

export type ReportGenerateInput = z.infer<typeof ReportGenerateInputSchema>;

const DATA_DIR = join(process.cwd(), "data");

export const ReportGenerateTool = {
  name: "report_generate" as const,
  description:
    "Generate a structured analysis report from research findings. The report is saved to the reports directory and optionally written back to the Wiki knowledge base for future reference (knowledge compounding). Use this as the final step after gathering all evidence.",
  inputSchema: {
    type: "object",
    properties: {
      kbId: { type: "string", description: "Knowledge base ID" },
      title: { type: "string", description: "Report title" },
      content: { type: "string", description: "Report content in Markdown with citations" },
      reportType: {
        type: "string",
        enum: ["analysis", "summary", "timeline", "comparison", "investigation"],
        description: "Report type",
      },
      writebackToWiki: { type: "boolean", description: "Write to Wiki for future reference" },
      sessionId: { type: "string", description: "Session ID" },
    },
    required: ["kbId", "title", "content"],
  },
  isConcurrencySafe: false as const,

  async call(input: ReportGenerateInput): Promise<string> {
    const reportId = randomUUID();
    const timestamp = new Date().toISOString();
    const reportType = input.reportType || "analysis";

    // Build report header
    const fullContent = [
      `# ${input.title}`,
      "",
      `**类型**: ${reportType} | **生成时间**: ${timestamp} | **知识库**: ${input.kbId}`,
      "",
      "---",
      "",
      input.content,
      "",
      "---",
      "",
      `*本报告由 DeepAnalyze 自动生成，report_id: ${reportId}*`,
    ].join("\n");

    // Save to reports directory
    const reportsDir = join(DATA_DIR, "wiki", input.kbId, "reports");
    mkdirSync(reportsDir, { recursive: true });
    const reportPath = join(reportsDir, `${reportId}.md`);
    writeFileSync(reportPath, fullContent, "utf-8");

    // Record in DB
    const db = DB.getInstance().raw;
    db.query(
      "INSERT INTO agent_tasks (id, session_id, agent_type, status, input, output) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      reportId,
      input.sessionId || null,
      "report",
      "completed",
      JSON.stringify({ kbId: input.kbId, title: input.title, reportType }),
      JSON.stringify({ reportPath }),
    );

    // Write back to Wiki (knowledge compounding)
    let wikiPageId: string | null = null;
    if (input.writebackToWiki !== false) {
      try {
        const page = createWikiPage({
          kbId: input.kbId,
          pageType: "report",
          title: input.title,
          content: fullContent,
          filePath: join("wiki", input.kbId, "reports", `${reportId}.md`),
          metadata: { reportType, reportId, sessionId: input.sessionId },
        });
        wikiPageId = page.id;
      } catch (err) {
        console.warn("[ReportGenerate] Wiki writeback failed:", err);
      }
    }

    return [
      `## 报告已生成`,
      "",
      `**标题**: ${input.title}`,
      `**类型**: ${reportType}`,
      `**报告 ID**: \`${reportId}\``,
      `**保存路径**: ${reportPath}`,
      wikiPageId ? `**Wiki 页面 ID**: \`${wikiPageId}\` (已回写到知识库)` : "",
      "",
      "报告内容预览：",
      "",
      input.content.slice(0, 1000) + (input.content.length > 1000 ? "\n...[截断，查看完整报告请使用 expand]" : ""),
    ]
      .filter((l) => l !== undefined)
      .join("\n");
  },
};
