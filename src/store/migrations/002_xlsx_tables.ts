import type { Database } from "bun:sqlite";

/**
 * Migration 002: 结构化表格存储（Excel/CSV 大数据优化）
 *
 * 设计原则：
 * - 每个 Excel Sheet 存为独立的 xlsx_data_{sheetId} 虚拟表（动态创建）
 * - xlsx_sheets 记录 sheet 元信息（行数、列数、schema）
 * - xlsx_columns 记录列元信息（类型推断、统计摘要），支持智能查询
 * - 使用 SQLite 事务 + 批量 INSERT 实现高吞吐写入
 *
 * 查询优化：
 * - 每个数据表自动创建列索引（基于使用频率检测）
 * - 支持 SQL 直接查询，避免将海量数据序列化为 Markdown
 */
export function runMigration002(db: Database): void {
  const applied = db.query("SELECT COUNT(*) as c FROM _migrations WHERE name = ?").get("002_xlsx_tables") as { c: number };
  if (applied.c > 0) return;

  db.exec(`
    -- Sheet 元信息表
    CREATE TABLE xlsx_sheets (
      id TEXT PRIMARY KEY,
      doc_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      kb_id TEXT NOT NULL REFERENCES knowledge_bases(id),
      sheet_name TEXT NOT NULL,
      sheet_index INTEGER NOT NULL DEFAULT 0,
      row_count INTEGER NOT NULL DEFAULT 0,
      col_count INTEGER NOT NULL DEFAULT 0,
      header_row TEXT,           -- JSON array of column names
      schema_json TEXT,          -- JSON: {col_name: detected_type}
      has_header INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 列元信息 + 统计摘要（用于 Agent 智能查询）
    CREATE TABLE xlsx_columns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sheet_id TEXT NOT NULL REFERENCES xlsx_sheets(id) ON DELETE CASCADE,
      col_name TEXT NOT NULL,
      col_index INTEGER NOT NULL,
      detected_type TEXT DEFAULT 'text',  -- text | integer | real | date | boolean
      null_count INTEGER DEFAULT 0,
      distinct_count INTEGER DEFAULT 0,
      min_value TEXT,
      max_value TEXT,
      avg_value TEXT,
      sample_values TEXT,  -- JSON array of up to 10 sample values
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(sheet_id, col_name)
    );

    -- 索引
    CREATE INDEX idx_xlsx_sheets_doc ON xlsx_sheets(doc_id);
    CREATE INDEX idx_xlsx_sheets_kb ON xlsx_sheets(kb_id);
    CREATE INDEX idx_xlsx_columns_sheet ON xlsx_columns(sheet_id);

    -- FTS 索引：对文本列的值建立全文索引，支持关键词搜索
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_xlsx USING fts5(
      sheet_id,
      kb_id,
      col_name,
      cell_value,
      row_id,
      tokenize 'unicode61'
    );
  `);

  db.query("INSERT INTO _migrations (name) VALUES (?)").run("002_xlsx_tables");
  console.log("Migration 002_xlsx_tables applied.");
}
