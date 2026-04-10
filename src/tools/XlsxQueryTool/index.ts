/**
 * XlsxQueryTool — Agent 可查询结构化表格数据
 *
 * 支持三种查询模式：
 * 1. schema — 查看 Sheet 的列定义和统计信息
 * 2. search — 按条件筛选数据（类似 SQL WHERE）
 * 3. sql — 执行安全 SQL 子集（仅 SELECT）
 */

import { z } from "zod";
import {
  getSheet,
  listSheetsByDoc,
  listSheetsByKb,
  querySheetData,
  rawQuery,
  getColumnMetas,
} from "../../store/data-tables.js";

export const XlsxQueryToolSchema = z.object({
  action: z.enum(["list", "schema", "search", "sql"]).describe(
    "查询类型: list=列出Sheet, schema=查看列定义, search=条件查询, sql=执行SQL",
  ),
  kb_id: z.string().describe("知识库 ID"),
  sheet_id: z.string().optional().describe("Sheet ID (schema/search/sql 必填)"),
  doc_id: z.string().optional().describe("文档 ID (用于过滤特定文档的 Sheet)"),
  select: z.array(z.string()).optional().describe("要查询的列名"),
  where: z.string().optional().describe("WHERE 条件 (SQL 表达式)"),
  order_by: z.string().optional().describe("排序: '列名 ASC' 或 '列名 DESC'"),
  limit: z.number().optional().describe("返回行数限制 (最大 5000)"),
  offset: z.number().optional().describe("偏移量"),
  sql: z.string().optional().describe("自定义 SQL (仅 SELECT, action=sql 时使用)"),
});

export const XlsxQueryTool = {
  name: "xlsx_query" as const,
  description:
    "查询知识库中的结构化表格数据(Excel/CSV)。支持查看表结构(schema)、条件搜索(search)、执行SQL查询(sql)。海量数据存储在独立的SQLite数据表中，可高效聚合分析。返回 JSON 格式数据。",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["list", "schema", "search", "sql"],
        description: "查询类型: list=列出Sheet, schema=查看列定义, search=条件查询, sql=执行SQL",
      },
      kb_id: { type: "string", description: "知识库 ID" },
      sheet_id: { type: "string", description: "Sheet ID" },
      doc_id: { type: "string", description: "文档 ID (过滤特定文档的 Sheet)" },
      select: { type: "array", items: { type: "string" }, description: "要查询的列名" },
      where: { type: "string", description: "WHERE 条件" },
      order_by: { type: "string", description: "排序" },
      limit: { type: "number", description: "返回行数限制" },
      offset: { type: "number", description: "偏移量" },
      sql: { type: "string", description: "自定义 SQL (仅 SELECT)" },
    },
    required: ["action", "kb_id"],
  },
  isConcurrencySafe: true as const,

  async call(input: z.infer<typeof XlsxQueryToolSchema>): Promise<string> {
    const { action, kb_id } = input;

    switch (action) {
      case "list":
        return handleList(kb_id, input.doc_id);
      case "schema":
        return handleSchema(input.sheet_id || "");
      case "search":
        return handleSearch(input);
      case "sql":
        return handleSql(input);
      default:
        return `[Error] Unknown action: ${action}`;
    }
  },
};

function handleList(kbId: string, docId?: string): string {
  const sheets = docId ? listSheetsByDoc(docId) : listSheetsByKb(kbId);
  if (sheets.length === 0) {
    return "没有找到结构化表格数据。请确保已上传 Excel/CSV 文件。";
  }
  const lines = sheets.map((s) =>
    `- **${s.sheetName}** (ID: ${s.id}): ${s.rowCount} 行 × ${s.colCount} 列, Doc: ${s.docId}`,
  );
  return `## 可用表格 (${sheets.length} 个)\n${lines.join("\n")}`;
}

function handleSchema(sheetId: string): string {
  if (!sheetId) return "[Error] sheet_id is required for schema action";
  const sheet = getSheet(sheetId);
  if (!sheet) return `[Error] Sheet not found: ${sheetId}`;

  const metas = getColumnMetas(sheetId);

  const colLines = metas.map((m) => {
    const stats: string[] = [];
    if (m.minValue != null) stats.push(`min=${m.minValue}`);
    if (m.maxValue != null) stats.push(`max=${m.maxValue}`);
    if (m.avgValue != null) stats.push(`avg=${m.avgValue}`);
    stats.push(`distinct=${m.distinctCount}`);
    stats.push(`null=${m.nullCount}`);
    if (m.sampleValues.length > 0) stats.push(`samples=[${m.sampleValues.slice(0, 5).join(", ")}]`);

    return `  - **${m.colName}** (${m.detectedType}): ${stats.join(", ")}`;
  });

  return [
    `## 表结构: ${sheet.sheetName}`,
    `**行数:** ${sheet.rowCount}, **列数:** ${sheet.colCount}`,
    `**列定义:**`,
    ...colLines,
  ].join("\n");
}

function handleSearch(input: z.infer<typeof XlsxQueryToolSchema>): string {
  const sheetId = input.sheet_id;
  if (!sheetId) return "[Error] sheet_id is required for search action";

  try {
    const result = querySheetData(sheetId, {
      select: input.select,
      where: input.where,
      orderBy: input.order_by,
      limit: input.limit,
      offset: input.offset,
    });

    const lines = [
      `## 查询结果: ${result.sheetName}`,
      `**匹配行数:** ${result.totalRows}${result.truncated ? ` (已截断至 ${result.rows.length})` : ""}`,
      "",
    ];

    // Format as markdown table
    if (result.rows.length > 0) {
      const cols = result.columns;
      lines.push("| " + cols.join(" | ") + " |");
      lines.push("| " + cols.map(() => "---").join(" | ") + " |");
      for (const row of result.rows.slice(0, 200)) { // Cap at 200 for display
        lines.push("| " + cols.map((c) => String(row[c] ?? "")).join(" | ") + " |");
      }
      if (result.rows.length > 200) {
        lines.push(`\n... 还有 ${result.rows.length - 200} 行未显示`);
      }
    } else {
      lines.push("无匹配数据");
    }

    return lines.join("\n");
  } catch (err) {
    return `[Query Error] ${err instanceof Error ? err.message : String(err)}`;
  }
}

function handleSql(input: z.infer<typeof XlsxQueryToolSchema>): string {
  const sheetId = input.sheet_id;
  const sql = input.sql;
  if (!sheetId) return "[Error] sheet_id is required for sql action";
  if (!sql) return "[Error] sql is required for sql action";

  try {
    const result = rawQuery(sheetId, sql);

    const lines = [
      `## SQL 查询结果 (${result.totalRows} 行)`,
      "",
    ];

    if (result.rows.length > 0) {
      const cols = result.columns;
      lines.push("| " + cols.join(" | ") + " |");
      lines.push("| " + cols.map(() => "---").join(" | ") + " |");
      for (const row of result.rows.slice(0, 200)) {
        lines.push("| " + cols.map((c) => String(row[c] ?? "")).join(" | ") + " |");
      }
    } else {
      lines.push("无结果");
    }

    return lines.join("\n");
  } catch (err) {
    return `[SQL Error] ${err instanceof Error ? err.message : String(err)}`;
  }
}
