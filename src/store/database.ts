import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "fs";
import { dirname, join } from "path";
import { runMigration001 } from "./migrations/001_init.js";
import { runMigration002 } from "./migrations/002_xlsx_tables.js";
import { DATA_DIR } from "../paths.js";

export class DB {
  private db: Database;
  private static instance: DB | null = null;

  private constructor(dbPath: string) {
    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
  }

  static getInstance(dbPath?: string): DB {
    if (!DB.instance) {
      const path = dbPath || join(DATA_DIR, "deepanalyze.db");
      DB.instance = new DB(path);
    }
    return DB.instance;
  }

  get raw(): Database {
    return this.db;
  }

  migrate(): void {
    this.db.exec("CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
    runMigration001(this.db);
    runMigration002(this.db);
  }

  close(): void {
    this.db.close();
  }
}
