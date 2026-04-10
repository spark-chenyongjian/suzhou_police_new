/**
 * xlsx_analyze — Agent 工具：自动生成 Excel 数据统计摘要
 *
 * 对指定 Sheet 执行聚合分析，自动生成：
 * - 数值列：sum/avg/min/max/count
 * - 文本列：top-N 频率分布、去重计数
 * - 交叉分组：按指定列分组统计
 */

import { z } from "zod";
import { DB } from "../../store/database.js";
import { getSheet, getColumnMetas, type SheetInfo } from "../../store/data-tables.js";

export const XlsxAnalyzeToolSchema = z.object({
  sheet_id: z.string().describe("Sheet ID"),
  group_by: z.string().optional().describe("分组列名"),
  metrics: z.array(z.string()).optional().describe("要统计的数值列（默认全部数值列）"),
  top_n: z.number().optional().default(10).describe("文本列 Top-N 频率"),
});

export const XlsxAnalyzeTool = {
  name: "xlsx_analyze" as const,
  description:
    "对 Excel Sheet 数据执行聚合统计分析。自动计算数值列的 sum/avg/min/max，文本列的频率分布。支持按指定列分组。适合快速了解数据分布特征。",
  inputSchema: {
    type: "object",
    properties: {
      sheet_id: { type: "string", description: "Sheet ID" },
      group_by: { type: "string", description: "分组列名" },
      metrics: { type: "array", items: { type: "string" }, description: "要统计的数值列" },
      top_n: { type: "number", description: "文本列 Top-N (默认 10)" },
    },
    required: ["sheet_id"],
  },
  isConcurrencySafe: true as const,

  async call(input: z.infer<typeof XlsxAnalyzeToolSchema>): Promise<string> {
    const sheet = getSheet(input.sheet_id);
    if (!sheet) return `[Error] Sheet not found: ${input.sheet_id}`;

    const db = DB.getInstance().raw;
    const tableName = `xlsx_data_${sheet.id.replace(/-/g, "_")}`;
    const metas = getColumnMetas(sheet.id);
    const topN = input.top_n || 10;

    const numericCols = metas.filter((m) => m.detectedType === "integer" || m.detectedType === "real");
    const textCols = metas.filter((m) => m.detectedType === "text");

    const lines: string[] = [
      `## 数据分析: ${sheet.sheetName}`,
      `**总行数**: ${sheet.rowCount}, **总列数**: ${sheet.colCount}`,
      "",
    ];

    // ── Numeric column statistics ──
    const targetNumCols = input.metrics
      ? numericCols.filter((c) => input.metrics!.includes(c.colName))
      : numericCols;

    if (targetNumCols.length > 0) {
      lines.push("### 数值列统计");
      lines.push("");

      if (input.group_by) {
        // Grouped statistics
        lines.push(`按 **${input.group_by}** 分组:`);
        lines.push("");

        for (const col of targetNumCols) {
          try {
            const sql = `SELECT "${sanitizeCol(input.group_by)}" as grp, COUNT(*) as cnt, SUM("${sanitizeCol(col.colName)}") as sum, AVG("${sanitizeCol(col.colName)}") as avg, MIN("${sanitizeCol(col.colName)}") as min, MAX("${sanitizeCol(col.colName)}") as max FROM "${tableName}" GROUP BY "${sanitizeCol(input.group_by)}" ORDER BY sum DESC LIMIT 50`;
            const rows = db.query(sql).all() as Record<string, unknown>[];
            lines.push(`**${col.colName}**:`);
            lines.push("| 分组 | 计数 | 合计 | 均值 | 最小 | 最大 |");
            lines.push("|------|------|------|------|------|------|");
            for (const row of rows) {
              lines.push(`| ${row.grp ?? "null"} | ${row.cnt} | ${fmt(row.sum)} | ${fmt(row.avg)} | ${fmt(row.min)} | ${fmt(row.max)} |`);
            }
            lines.push("");
          } catch (err) {
            lines.push(`**${col.colName}**: 分析失败 - ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } else {
        // Overall statistics
        lines.push("| 列 | 计数 | 合计 | 均值 | 最小 | 最大 |");
        lines.push("|----|------|------|------|------|------|");
        for (const col of targetNumCols) {
          try {
            const sql = `SELECT COUNT(*) as cnt, SUM("${sanitizeCol(col.colName)}") as sum, AVG("${sanitizeCol(col.colName)}") as avg, MIN("${sanitizeCol(col.colName)}") as min, MAX("${sanitizeCol(col.colName)}") as max FROM "${tableName}"`;
            const row = db.query(sql).get() as Record<string, unknown>;
            lines.push(`| ${col.colName} | ${row.cnt} | ${fmt(row.sum)} | ${fmt(row.avg)} | ${fmt(row.min)} | ${fmt(row.max)} |`);
          } catch {
            lines.push(`| ${col.colName} | - | - | - | - | - |`);
          }
        }
        lines.push("");
      }
    }

    // ── Text column frequency distribution ──
    if (textCols.length > 0 && !input.group_by) {
      lines.push("### 文本列频率分布 (Top " + topN + ")");
      lines.push("");
      for (const col of textCols.slice(0, 10)) {
        try {
          const sql = `SELECT "${sanitizeCol(col.colName)}" as val, COUNT(*) as cnt FROM "${tableName}" WHERE "${sanitizeCol(col.colName)}" IS NOT NULL GROUP BY "${sanitizeCol(col.colName)}" ORDER BY cnt DESC LIMIT ${topN}`;
          const rows = db.query(sql).all() as Record<string, unknown>[];
          lines.push(`**${col.colName}** (${col.distinctCount} 去重, null=${col.nullCount}):`);
          for (const row of rows) {
            lines.push(`  - ${row.val}: ${row.cnt}`);
          }
          lines.push("");
        } catch {
          // skip on error
        }
      }
    }

    // ── Cross-tab summary if group_by specified ──
    if (input.group_by && textCols.length > 0) {
      lines.push("### 分组分布");
      lines.push("");
      try {
        const sql = `SELECT "${sanitizeCol(input.group_by)}" as grp, COUNT(*) as cnt FROM "${tableName}" GROUP BY "${sanitizeCol(input.group_by)}" ORDER BY cnt DESC LIMIT 50`;
        const rows = db.query(sql).all() as Record<string, unknown>[];
        lines.push(`**${input.group_by}** 分布:`);
        for (const row of rows) {
          const pct = ((row.cnt as number) / sheet.rowCount * 100).toFixed(1);
          lines.push(`  - ${row.grp ?? "null"}: ${row.cnt} (${pct}%)`);
        }
        lines.push("");
      } catch {
        // skip
      }
    }

    return lines.join("\n");
  },
};

function sanitizeCol(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, "_");
}

function fmt(val: unknown): string {
  if (val == null) return "-";
  const n = Number(val);
  if (isNaN(n)) return String(val);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
