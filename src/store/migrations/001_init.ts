import type { Database } from "bun:sqlite";

export function runMigration001(db: Database): void {
  const applied = db.query("SELECT COUNT(*) as c FROM _migrations WHERE name = ?").get("001_init") as { c: number };
  if (applied.c > 0) return;

  db.exec(`
    CREATE TABLE knowledge_bases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      owner_id TEXT NOT NULL,
      visibility TEXT DEFAULT 'private',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE documents (
      id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL REFERENCES knowledge_bases(id),
      filename TEXT NOT NULL,
      file_path TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      file_size INTEGER,
      file_type TEXT,
      status TEXT DEFAULT 'uploaded',
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE wiki_pages (
      id TEXT PRIMARY KEY,
      kb_id TEXT NOT NULL REFERENCES knowledge_bases(id),
      doc_id TEXT REFERENCES documents(id),
      page_type TEXT NOT NULL,
      title TEXT NOT NULL,
      file_path TEXT NOT NULL,
      content_hash TEXT,
      token_count INTEGER,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE wiki_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_page_id TEXT NOT NULL REFERENCES wiki_pages(id),
      target_page_id TEXT NOT NULL REFERENCES wiki_pages(id),
      link_type TEXT NOT NULL,
      entity_name TEXT,
      context TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kb_id TEXT NOT NULL REFERENCES knowledge_bases(id),
      name TEXT NOT NULL,
      category TEXT,
      UNIQUE(kb_id, name)
    );

    CREATE TABLE document_tags (
      doc_id TEXT NOT NULL REFERENCES documents(id),
      tag_id INTEGER NOT NULL REFERENCES tags(id),
      PRIMARY KEY (doc_id, tag_id)
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      kb_scope TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      detail TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE agent_tasks (
      id TEXT PRIMARY KEY,
      parent_task_id TEXT,
      session_id TEXT REFERENCES sessions(id),
      agent_type TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      input TEXT,
      output TEXT,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    );

    CREATE TABLE plugins (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT,
      enabled INTEGER DEFAULT 1,
      config TEXT
    );

    CREATE TABLE skills (
      id TEXT PRIMARY KEY,
      plugin_id TEXT REFERENCES plugins(id),
      name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      config TEXT
    );

    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS fts_content USING fts5(
      page_id,
      kb_id,
      level,
      content,
      tokenize 'unicode61'
    );

    CREATE INDEX idx_documents_kb_id ON documents(kb_id);
    CREATE INDEX idx_documents_status ON documents(status);
    CREATE INDEX idx_wiki_pages_kb_id ON wiki_pages(kb_id);
    CREATE INDEX idx_wiki_pages_doc_id ON wiki_pages(doc_id);
    CREATE INDEX idx_wiki_pages_page_type ON wiki_pages(page_type);
    CREATE INDEX idx_wiki_links_source ON wiki_links(source_page_id);
    CREATE INDEX idx_wiki_links_target ON wiki_links(target_page_id);
    CREATE INDEX idx_messages_session_id ON messages(session_id);
    CREATE INDEX idx_agent_tasks_status ON agent_tasks(status);
    CREATE INDEX idx_agent_tasks_session_id ON agent_tasks(session_id);
  `);

  db.query("INSERT INTO _migrations (name) VALUES (?)").run("001_init");
  console.log("Migration 001_init applied.");
}
