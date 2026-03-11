import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(process.cwd(), 'data', 'inventory.db');

let db;

export function getDb() {
  if (!db) {
    // Ensure data directory exists
    const dataDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initializeSchema(db);
  }
  return db;
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS storage_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item TEXT NOT NULL,
      type TEXT DEFAULT '-',
      brand TEXT DEFAULT '-',
      model TEXT DEFAULT '-',
      quantity_spare INTEGER DEFAULT 0,
      current INTEGER DEFAULT 0,
      location TEXT DEFAULT '-',
      allocation TEXT DEFAULT '-',
      status TEXT DEFAULT '',
      remarks TEXT DEFAULT '',
      sheet_row INTEGER DEFAULT NULL
    );

    CREATE TABLE IF NOT EXISTS deployed_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item TEXT NOT NULL,
      type TEXT DEFAULT '-',
      brand TEXT DEFAULT '-',
      model TEXT DEFAULT '-',
      quantity INTEGER DEFAULT 0,
      location TEXT DEFAULT '-',
      allocation TEXT DEFAULT '-',
      status TEXT DEFAULT '',
      remarks TEXT DEFAULT '',
      loan_request_id INTEGER DEFAULT NULL,
      sheet_row INTEGER DEFAULT NULL,
      FOREIGN KEY (loan_request_id) REFERENCES loan_requests(id)
    );

    CREATE TABLE IF NOT EXISTS loan_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      loan_type TEXT NOT NULL CHECK(loan_type IN ('temporary', 'permanent')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected', 'returned')),
      purpose TEXT NOT NULL,
      department TEXT DEFAULT '',
      location TEXT DEFAULT '',
      start_date TEXT NOT NULL,
      end_date TEXT,
      admin_notes TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS loan_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      loan_request_id INTEGER NOT NULL,
      item_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (loan_request_id) REFERENCES loan_requests(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES storage_items(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      link TEXT DEFAULT '',
      read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id INTEGER,
      details TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrate: add columns to existing tables that may predate schema changes
  const migrations = [
    'ALTER TABLE deployed_items ADD COLUMN loan_request_id INTEGER DEFAULT NULL',
    'ALTER TABLE deployed_items ADD COLUMN sheet_row INTEGER DEFAULT NULL',
    "ALTER TABLE loan_requests ADD COLUMN location TEXT DEFAULT ''",
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (_) { /* column already exists */ }
  }

  // Seed default invite code from env if not already set
  const existing = db.prepare("SELECT value FROM app_settings WHERE key = 'invite_code'").get();
  if (!existing) {
    const defaultCode = process.env.INVITE_CODE || 'techministry2026';
    db.prepare("INSERT INTO app_settings (key, value) VALUES ('invite_code', ?)").run(defaultCode);
  }
}

export function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
}

export default getDb;
