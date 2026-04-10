/**
 * Excel Parser — 流式解析 Excel 文件到结构化存储
 *
 * 核心设计：
 * 1. 使用 xlsx 库逐 Sheet 读取（支持 .xlsx/.xls/.csv）
 * 2. 自动类型推断（integer/real/date/text/boolean）
 * 3. 分块批量写入 SQLite（每 10,000 行一次事务）
 * 4. 自动计算列统计信息（min/max/avg/distinct/null_count/sample）
 * 5. 文本列值同步写入 FTS5 索引
 */

import * as XLSX from "xlsx";
import {
  createSheet,
  createDataTable,
  insertRows,
  updateSheetRowCount,
  saveColumnMetas,
  indexSheetInFts,
  deleteSheetsByDoc,
  type ColumnMeta,
} from "../store/data-tables.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface ExcelParseOptions {
  docId: string;
  kbId: string;
  filePath: string;
  filename: string;
  maxRowsPerSheet?: number; // 0 = unlimited
  onProgress?: (stage: string) => void;
}

export interface ExcelParseResult {
  sheets: Array<{
    sheetName: string;
    sheetId: string;
    rowCount: number;
    colCount: number;
  }>;
  totalRows: number;
}

// ── Type Inference ───────────────────────────────────────────────────────

type DetectedType = "text" | "integer" | "real" | "date" | "boolean";

function inferValueType(value: unknown): DetectedType {
  if (value == null) return "text";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "real";
  }
  if (value instanceof Date) return "date";
  const str = String(value).trim();
  if (str === "") return "text";

  // Try parse as number
  const num = Number(str);
  if (!isNaN(num) && isFinite(num)) {
    return Number.isInteger(num) ? "integer" : "real";
  }

  // Try parse as date
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(str)) return "date";

  return "text";
}

function inferColumnType(values: unknown[]): DetectedType {
  const typeCounts: Record<string, number> = { text: 0, integer: 0, real: 0, date: 0, boolean: 0 };
  let nonNullCount = 0;

  for (const val of values) {
    if (val == null || String(val).trim() === "") continue;
    nonNullCount++;
    const t = inferValueType(val);
    typeCounts[t]++;
  }

  if (nonNullCount === 0) return "text";

  // If >70% of values are one type, use that type
  for (const [type, count] of Object.entries(typeCounts)) {
    if (count / nonNullCount > 0.7) return type as DetectedType;
  }

  // If mix of integer and real, use real
  if ((typeCounts.integer + typeCounts.real) / nonNullCount > 0.7) return "real";

  return "text";
}

// ── Main Parse Function ─────────────────────────────────────────────────

export async function parseExcelToStore(opts: ExcelParseOptions): Promise<ExcelParseResult> {
  const { docId, kbId, filePath, filename, maxRowsPerSheet = 0, onProgress } = opts;

  // Clean up existing sheets for this doc (retry support)
  deleteSheetsByDoc(docId);

  onProgress?.(`读取 Excel 文件: ${filename}`);

  // CSV files: read as UTF-8 string first to preserve Chinese encoding
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  let workbook: XLSX.WorkBook;
  if (ext === "csv") {
    const { readFileSync } = await import("fs");
    const csvContent = readFileSync(filePath, "utf-8");
    workbook = XLSX.read(csvContent, { type: "string", cellDates: true, cellNF: true });
  } else {
    workbook = XLSX.readFile(filePath, {
      type: "file",
      cellDates: true,
      cellNF: true,
      cellStyles: false,
    });
  }

  const result: ExcelParseResult = { sheets: [], totalRows: 0 };

  for (let si = 0; si < workbook.SheetNames.length; si++) {
    const sheetName = workbook.SheetNames[si];
    const worksheet = workbook.Sheets[sheetName];

    onProgress?.(`解析 Sheet: ${sheetName}`);

    // Convert to array of arrays
    const rawData: unknown[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: null,
      blankrows: false,
    });

    if (rawData.length === 0) continue;

    // First row as header
    const headerRow = inferHeaders(rawData[0], rawData.length > 1 ? rawData[1] : []);
    const dataRows = rawData.slice(1); // Skip header row

    if (dataRows.length === 0) {
      // Sheet with only header, still create it
      const schema: Record<string, string> = {};
      headerRow.forEach((h) => { schema[h] = "text"; });

      const sheet = createSheet({
        docId,
        kbId,
        sheetName,
        sheetIndex: si,
        headerRow,
        schemaJson: schema,
      });
      createDataTable(sheet.id, headerRow, schema);

      result.sheets.push({ sheetName, sheetId: sheet.id, rowCount: 0, colCount: headerRow.length });
      continue;
    }

    // Limit rows if specified
    const limitedRows = maxRowsPerSheet > 0 ? dataRows.slice(0, maxRowsPerSheet) : dataRows;
    const colCount = headerRow.length;

    // Infer column types from a sample (first 1000 rows)
    const sampleSize = Math.min(limitedRows.length, 1000);
    const schema: Record<string, string> = {};
    for (let col = 0; col < colCount; col++) {
      const values = limitedRows.slice(0, sampleSize).map((row) => row[col]);
      schema[headerRow[col]] = inferColumnType(values);
    }

    // Create sheet metadata + data table
    const sheet = createSheet({
      docId,
      kbId,
      sheetName,
      sheetIndex: si,
      headerRow,
      schemaJson: schema,
    });
    createDataTable(sheet.id, headerRow, schema);

    // Normalize and insert rows
    onProgress?.(`写入数据: ${sheetName} (${limitedRows.length} 行)`);
    const normalizedRows = limitedRows.map((row) => normalizeRow(row, colCount, schema, headerRow));
    insertRows(sheet.id, headerRow, normalizedRows);
    updateSheetRowCount(sheet.id, limitedRows.length);

    // Compute column statistics
    onProgress?.(`计算统计信息: ${sheetName}`);
    const metas = computeColumnStats(headerRow, schema, limitedRows);
    saveColumnMetas(sheet.id, metas);

    // Index text columns into FTS
    const textColumns = new Set(
      headerRow.filter((h) => schema[h] === "text"),
    );
    if (textColumns.size > 0) {
      onProgress?.(`建立全文索引: ${sheetName}`);
      const rowObjects = limitedRows.map((row) => {
        const obj: Record<string, unknown> = {};
        headerRow.forEach((h, i) => { obj[h] = row[i]; });
        return obj;
      });
      indexSheetInFts(sheet.id, kbId, headerRow, rowObjects, textColumns);
    }

    result.sheets.push({
      sheetName,
      sheetId: sheet.id,
      rowCount: limitedRows.length,
      colCount,
    });
    result.totalRows += limitedRows.length;
  }

  onProgress?.(`完成: ${result.sheets.length} 个 Sheet, 共 ${result.totalRows} 行`);
  return result;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function inferHeaders(firstRow: unknown[], secondRow: unknown[]): string[] {
  // Check if first row looks like headers (strings, not numbers)
  const isLikelyHeader = firstRow.every((v) => v == null || typeof v === "string");

  if (isLikelyHeader && firstRow.length > 0) {
    return firstRow.map((v, i) => {
      const name = String(v ?? "").trim();
      return name || `col_${i + 1}`;
    });
  }

  // If not, generate column names
  return firstRow.map((_, i) => `col_${i + 1}`);
}

function normalizeRow(row: unknown[], colCount: number, schema: Record<string, string>, headers: string[]): unknown[] {
  const normalized: unknown[] = [];
  for (let i = 0; i < colCount; i++) {
    let val = i < row.length ? row[i] : null;
    if (val == null || String(val).trim() === "") {
      normalized.push(null);
      continue;
    }
    const type = schema[headers[i]];
    switch (type) {
      case "integer": {
        const num = Number(val);
        val = isNaN(num) ? val : Math.round(num);
        break;
      }
      case "real": {
        const num = Number(val);
        val = isNaN(num) ? val : num;
        break;
      }
      case "boolean":
        val = val ? 1 : 0;
        break;
      case "date":
        val = val instanceof Date ? val.toISOString().slice(0, 10) : String(val);
        break;
      default:
        val = String(val);
    }
    normalized.push(val);
  }
  return normalized;
}

function computeColumnStats(headers: string[], schema: Record<string, string>, rows: unknown[][]): ColumnMeta[] {
  return headers.map((colName, colIdx) => {
    const type = schema[colName];
    const values = rows.map((r) => r[colIdx]).filter((v) => v != null && String(v).trim() !== "");

    const nullCount = rows.length - values.length;
    const distinctValues = new Set(values.map(String));
    const sampleValues = [...distinctValues].slice(0, 10);

    let minValue: string | null = null;
    let maxValue: string | null = null;
    let avgValue: string | null = null;

    if (type === "integer" || type === "real") {
      const nums = values.map(Number).filter((n) => !isNaN(n));
      if (nums.length > 0) {
        minValue = String(Math.min(...nums));
        maxValue = String(Math.max(...nums));
        avgValue = String(nums.reduce((a, b) => a + b, 0) / nums.length);
      }
    } else {
      // Text/date: min/max as lexicographic
      const strs = values.map(String).sort();
      if (strs.length > 0) {
        minValue = strs[0];
        maxValue = strs[strs.length - 1];
      }
    }

    return {
      colName,
      colIndex: colIdx,
      detectedType: type,
      nullCount,
      distinctCount: distinctValues.size,
      minValue,
      maxValue,
      avgValue,
      sampleValues,
    };
  });
}
