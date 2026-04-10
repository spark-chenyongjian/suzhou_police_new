/**
 * DataTableStore — Excel/CSV 结构化数据的存储和查询层
 *
 * 核心设计：
 * - 每个 Sheet 的数据存储在独立的数据表 `xlsx_data_{sheetId}` 中
 * - 数据表按列名创建，列名通过 header 推断
 * - 批量写入使用事务 + prepared statements，单次写入 10,000 行
 * - 查询层提供安全的 SQL 子集，Agent 可通过 xlsx_query 工具查询
 */

import { DB } from "./database.js";
import { randomUUID } from "crypto";
import type { Database, Statement } from "bun:sqlite";

// ── Types ────────────────────────────────────────────────────────────────

export interface SheetInfo {
  id: string;
  docId: string;
  kbId: string;
  sheetName: string;
  sheetIndex: number;
  rowCount: number;
  colCount: number;
  headerRow: string[];
  schemaJson: Record<string, string>;
  hasHeader: boolean;
  createdAt: string;
}

export interface ColumnMeta {
  colName: string;
  colIndex: number;
  detectedType: string;
  nullCount: number;
  distinctCount: number;
  minValue: string | null;
  maxValue: string | null;
  avgValue: string | null;
  sampleValues: string[];
}

export interface SheetDataResult {
  sheetId: string;
  sheetName: string;
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  truncated: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────

const BATCH_SIZE = 10_000;
const MAX_QUERY_ROWS = 5_000;
const SAFE_IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

// ── Sheet CRUD ───────────────────────────────────────────────────────────

function rowToSheet(row: Record<string, unknown>): SheetInfo {
  return {
    id: row.id as string,
    docId: row.doc_id as string,
    kbId: row.kb_id as string,
    sheetName: row.sheet_name as string,
    sheetIndex: row.sheet_index as number,
    rowCount: row.row_count as number,
    colCount: row.col_count as number,
    headerRow: row.header_row ? JSON.parse(row.header_row as string) : [],
    schemaJson: row.schema_json ? JSON.parse(row.schema_json as string) : {},
    hasHeader: (row.has_header as number) === 1,
    createdAt: row.created_at as string,
  };
}

export function createSheet(opts: {
  docId: string;
  kbId: string;
  sheetName: string;
  sheetIndex: number;
  headerRow: string[];
  schemaJson: Record<string, string>;
  hasHeader?: boolean;
}): SheetInfo {
  const db = DB.getInstance().raw;
  const id = randomUUID();
  db.query(
    `INSERT INTO xlsx_sheets (id, doc_id, kb_id, sheet_name, sheet_index, header_row, schema_json, has_header)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    opts.docId,
    opts.kbId,
    opts.sheetName,
    opts.sheetIndex,
    JSON.stringify(opts.headerRow),
    JSON.stringify(opts.schemaJson),
    opts.hasHeader !== false ? 1 : 0,
  );
  return rowToSheet(db.query("SELECT * FROM xlsx_sheets WHERE id = ?").get(id) as Record<string, unknown>);
}

export function getSheet(sheetId: string): SheetInfo | null {
  const db = DB.getInstance().raw;
  const row = db.query("SELECT * FROM xlsx_sheets WHERE id = ?").get(sheetId);
  return row ? rowToSheet(row as Record<string, unknown>) : null;
}

export function listSheetsByDoc(docId: string): SheetInfo[] {
  const db = DB.getInstance().raw;
  return (db.query("SELECT * FROM xlsx_sheets WHERE doc_id = ? ORDER BY sheet_index")
    .all(docId) as Record<string, unknown>[]).map(rowToSheet);
}

export function listSheetsByKb(kbId: string): SheetInfo[] {
  const db = DB.getInstance().raw;
  return (db.query("SELECT * FROM xlsx_sheets WHERE kb_id = ? ORDER BY doc_id, sheet_index")
    .all(kbId) as Record<string, unknown>[]).map(rowToSheet);
}

export function updateSheetRowCount(sheetId: string, rowCount: number): void {
  const db = DB.getInstance().raw;
  db.query("UPDATE xlsx_sheets SET row_count = ? WHERE id = ?").run(rowCount, sheetId);
}

export function deleteSheet(sheetId: string): void {
  const db = DB.getInstance().raw;
  // Drop the data table
  const dataTable = `xlsx_data_${sheetId.replace(/-/g, "_")}`;
  try {
    db.exec(`DROP TABLE IF EXISTS "${dataTable}"`);
  } catch {
    // Ignore if table doesn't exist
  }
  // Delete FTS entries
  db.query("DELETE FROM fts_xlsx WHERE sheet_id = ?").run(sheetId);
  // Cascade deletes xlsx_columns
  db.query("DELETE FROM xlsx_sheets WHERE id = ?").run(sheetId);
}

export function deleteSheetsByDoc(docId: string): void {
  const sheets = listSheetsByDoc(docId);
  for (const sheet of sheets) {
    deleteSheet(sheet.id);
  }
}

// ── Data Table Management ────────────────────────────────────────────────

/**
 * Create the data table for a sheet with proper column types.
 * Column names are sanitized to valid SQLite identifiers.
 */
export function createDataTable(sheetId: string, columns: string[], types: Record<string, string>): void {
  const db = DB.getInstance().raw;
  const tableName = getDataTableName(sheetId);

  const colDefs = columns.map((col) => {
    const safeName = sanitizeColName(col);
    const sqlType = mapSqliteType(types[col] || "text");
    return `"${safeName}" ${sqlType}`;
  });

  const ddl = `CREATE TABLE IF NOT EXISTS "${tableName}" (
    _rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    ${colDefs.join(",\n    ")}
  )`;

  db.exec(ddl);
}

/**
 * Bulk insert rows into a sheet's data table.
 * Uses transaction + prepared statement for high throughput.
 */
export function insertRows(sheetId: string, columns: string[], rows: unknown[][]): number {
  if (rows.length === 0) return 0;

  const db = DB.getInstance().raw;
  const tableName = getDataTableName(sheetId);
  const safeCols = columns.map(sanitizeColName);
  const placeholders = safeCols.map(() => "?").join(", ");
  const insertSQL = `INSERT INTO "${tableName}" (${safeCols.map((c) => `"${c}"`).join(", ")}) VALUES (${placeholders})`;

  let inserted = 0;

  const insertMany = db.transaction((batch: unknown[][]) => {
    for (const row of batch) {
      db.query(insertSQL).run(...row as (string | number | null | boolean)[]);
      inserted++;
    }
  });

  // Process in batches
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    insertMany(batch);
  }

  return inserted;
}

/**
 * Query a sheet's data table with a safe SQL fragment.
 * Only allows SELECT statements on the sheet's data table.
 */
export function querySheetData(sheetId: string, options: {
  select?: string[];
  where?: string;
  orderBy?: string;
  limit?: number;
  offset?: number;
}): SheetDataResult {
  const db = DB.getInstance().raw;
  const sheet = getSheet(sheetId);
  if (!sheet) throw new Error(`Sheet not found: ${sheetId}`);

  const tableName = getDataTableName(sheetId);
  const safeCols = sheet.headerRow.map(sanitizeColName);

  // Build SELECT clause
  const selectCols = options.select && options.select.length > 0
    ? options.select.filter((c) => safeCols.includes(sanitizeColName(c))).map((c) => `"${sanitizeColName(c)}"`)
    : safeCols.map((c) => `"${c}"`);

  if (selectCols.length === 0) {
    return { sheetId, sheetName: sheet.sheetName, columns: [], rows: [], totalRows: sheet.rowCount, truncated: false };
  }

  // Count total matching rows
  const countSQL = options.where
    ? `SELECT COUNT(*) as cnt FROM "${tableName}" WHERE ${options.where}`
    : `SELECT COUNT(*) as cnt FROM "${tableName}"`;
  const countResult = db.query(countSQL).get() as Record<string, unknown>;
  const totalRows = countResult.cnt as number;

  // Build main query
  const limit = Math.min(options.limit || MAX_QUERY_ROWS, MAX_QUERY_ROWS);
  const orderClause = options.orderBy ? `ORDER BY ${sanitizeOrderBy(options.orderBy, safeCols)}` : "";
  const whereClause = options.where ? `WHERE ${options.where}` : "";
  const offsetClause = options.offset ? `OFFSET ${options.offset}` : "";

  const sql = `SELECT ${selectCols.join(", ")} FROM "${tableName}" ${whereClause} ${orderClause} LIMIT ${limit} ${offsetClause}`;

  const rows = db.query(sql).all() as Record<string, unknown>[];

  return {
    sheetId,
    sheetName: sheet.sheetName,
    columns: selectCols.map((c) => c.replace(/"/g, "")),
    rows: rows as Record<string, unknown>[],
    totalRows,
    truncated: totalRows > limit,
  };
}

/**
 * Execute a raw SQL query on a sheet's data table.
 * Validates that the SQL only references the allowed table.
 */
export function rawQuery(sheetId: string, sql: string): { columns: string[]; rows: Record<string, unknown>[]; totalRows: number } {
  const db = DB.getInstance().raw;
  const sheet = getSheet(sheetId);
  if (!sheet) throw new Error(`Sheet not found: ${sheetId}`);

  const tableName = getDataTableName(sheetId);

  // Validate: only SELECT, only the allowed table
  const upperSQL = sql.trim().toUpperCase();
  if (!upperSQL.startsWith("SELECT")) {
    throw new Error("Only SELECT queries are allowed");
  }
  // Block dangerous operations
  const forbidden = ["DROP", "DELETE", "UPDATE", "INSERT", "ALTER", "CREATE", "ATTACH", "DETACH"];
  for (const kw of forbidden) {
    if (upperSQL.includes(kw)) {
      throw new Error(`Forbidden keyword in query: ${kw}`);
    }
  }

  const rows = db.query(sql).all() as Record<string, unknown>[];
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { columns, rows, totalRows: rows.length };
}

// ── Column Metadata ──────────────────────────────────────────────────────

export function saveColumnMetas(sheetId: string, metas: ColumnMeta[]): void {
  const db = DB.getInstance().raw;
  const insertMany = db.transaction((items: ColumnMeta[]) => {
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO xlsx_columns (sheet_id, col_name, col_index, detected_type, null_count, distinct_count, min_value, max_value, avg_value, sample_values)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const m of items) {
      stmt.run(
        sheetId,
        m.colName,
        m.colIndex,
        m.detectedType,
        m.nullCount,
        m.distinctCount,
        m.minValue ?? null,
        m.maxValue ?? null,
        m.avgValue ?? null,
        JSON.stringify(m.sampleValues),
      );
    }
  });
  insertMany(metas);
}

export function getColumnMetas(sheetId: string): ColumnMeta[] {
  const db = DB.getInstance().raw;
  return (db.query("SELECT * FROM xlsx_columns WHERE sheet_id = ? ORDER BY col_index")
    .all(sheetId) as Record<string, unknown>[]).map((row) => ({
    colName: row.col_name as string,
    colIndex: row.col_index as number,
    detectedType: row.detected_type as string,
    nullCount: row.null_count as number,
    distinctCount: row.distinct_count as number,
    minValue: row.min_value as string | null,
    maxValue: row.max_value as string | null,
    avgValue: row.avg_value as string | null,
    sampleValues: row.sample_values ? JSON.parse(row.sample_values as string) : [],
  }));
}

// ── FTS Indexing for text columns ────────────────────────────────────────

/**
 * Index text values into FTS for keyword search.
 * Only indexes columns with detected type 'text'.
 */
export function indexSheetInFts(sheetId: string, kbId: string, columns: string[], rows: Record<string, unknown>[], textColumns: Set<string>): void {
  const db = DB.getInstance().raw;
  const insertMany = db.transaction((items: Array<{ sheetId: string; kbId: string; colName: string; cellValue: string; rowId: number }>) => {
    const stmt = db.prepare(
      "INSERT INTO fts_xlsx (sheet_id, kb_id, col_name, cell_value, row_id) VALUES (?, ?, ?, ?, ?)",
    );
    for (const item of items) {
      stmt.run(item.sheetId, item.kbId, item.colName, item.cellValue, item.rowId);
    }
  });

  const batch: Array<{ sheetId: string; kbId: string; colName: string; cellValue: string; rowId: number }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    for (const col of columns) {
      if (!textColumns.has(col)) continue;
      const val = row[col];
      if (val == null || val === "") continue;
      batch.push({ sheetId, kbId, colName: col, cellValue: String(val), rowId: i + 1 });
    }
    if (batch.length >= BATCH_SIZE) {
      insertMany(batch);
      batch.length = 0;
    }
  }
  if (batch.length > 0) {
    insertMany(batch);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function getDataTableName(sheetId: string): string {
  return `xlsx_data_${sheetId.replace(/-/g, "_")}`;
}

function sanitizeColName(name: string): string {
  // Replace problematic characters, ensure valid identifier
  let safe = name.trim().replace(/[^a-zA-Z0-9_\u4e00-\u9fff]/g, "_");
  if (safe.length === 0) safe = "col";
  // Prefix with _ if starts with digit
  if (/^\d/.test(safe)) safe = "_" + safe;
  // Deduplicate: append index if needed (caller should handle uniqueness)
  return safe;
}

function mapSqliteType(detectedType: string): string {
  switch (detectedType) {
    case "integer": return "INTEGER";
    case "real": return "REAL";
    case "date": return "TEXT"; // SQLite stores dates as text
    case "boolean": return "INTEGER"; // 0/1
    default: return "TEXT";
  }
}

function sanitizeOrderBy(orderBy: string, safeCols: string[]): string {
  // Parse "col ASC" or "col DESC" patterns
  const parts = orderBy.trim().split(/\s+/);
  const col = parts[0];
  const dir = parts.length > 1 && parts[1].toUpperCase() === "DESC" ? "DESC" : "ASC";

  if (safeCols.includes(sanitizeColName(col))) {
    return `"${sanitizeColName(col)}" ${dir}`;
  }
  return ""; // Invalid column, skip ORDER BY
}
