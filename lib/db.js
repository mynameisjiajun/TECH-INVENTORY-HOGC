import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs";
import { readSheet } from "./sheets.js";

const IS_VERCEL = !!process.env.VERCEL;
const DB_DIR =
  process.env.DATABASE_DIR ||
  (IS_VERCEL ? "/tmp/data" : path.join(process.cwd(), "data"));
const DB_PATH = path.join(DB_DIR, "inventory.db");

// ─── PERSISTENCE NOTE ───────────────────────────────────────────────
// Vercel serverless uses ephemeral /tmp — the DB resets on every deploy.
// To keep user accounts, loans & settings persistent, deploy with a
// platform that supports persistent disk storage:
//
//   Railway  — Add a Volume mounted at /data, set DATABASE_DIR=/data
//   Fly.io   — Create a volume, mount at /data, set DATABASE_DIR=/data
//   Render   — Use a Persistent Disk at /data, set DATABASE_DIR=/data
//
// A Dockerfile is included in the project root for easy deployment.
// ─────────────────────────────────────────────────────────────────────

if (IS_VERCEL && !process.env.DATABASE_DIR) {
  console.warn(
    "⚠ Ephemeral /tmp storage — user data will be lost on redeploy. " +
      "Deploy on Railway/Fly.io with DATABASE_DIR=/data for persistence.",
  );
}

let db;
let _syncPromise = null;
let _needsSync = false;

export function getDb() {
  if (!db) {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    initializeSchema(db);

    // Check if DB is empty and needs sync
    const itemCount = db
      .prepare("SELECT COUNT(*) as count FROM storage_items")
      .get().count;
    if (itemCount === 0) {
      _needsSync = true;
    }
  }
  return db;
}

/**
 * Wait for the initial auto-sync to complete (if one is in progress).
 * Call this in API routes that read inventory data.
 */
export async function waitForSync() {
  getDb(); // Ensure DB is initialized and _needsSync is set
  if (!_needsSync) return;
  if (_syncPromise) {
    await _syncPromise;
    return;
  }
  _syncPromise = autoSyncFromSheets();
  try {
    await _syncPromise;
  } catch (err) {
    console.error("Auto-sync from Sheets failed:", err);
  } finally {
    _syncPromise = null;
    _needsSync = false;
  }
}

async function autoSyncFromSheets() {
  const sheetsId = process.env.GOOGLE_SHEETS_ID;
  const serviceEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!sheetsId || !serviceEmail || !privateKey) {
    console.warn("Auto-sync skipped: Google Sheets credentials not configured");
    return;
  }

  console.log("Auto-syncing inventory from Google Sheets (cold start)...");

  let spareData, deployedData;
  try {
    [spareData, deployedData] = await Promise.all([
      readSheet("Storage Spare", "B:L"),
      readSheet("DEPLOYED", "B:J"),
    ]);
  } catch (err) {
    console.error("Failed to read from Google Sheets:", err.message);
    return;
  }

  const seedAll = db.transaction(() => {
    let spareCount = 0;
    for (let i = 2; i < spareData.length; i++) {
      const row = spareData[i];
      const item = row[0] != null ? String(row[0]).trim() : "";
      if (!item) continue;
      const type = row[1] != null ? String(row[1]).trim() : "-";
      const brand = row[2] != null ? String(row[2]).trim() : "-";
      const model = row[3] != null ? String(row[3]).trim() : "-";
      const rawSpare = row[4] != null ? Number(row[4]) : 0;
      const quantitySpare = isNaN(rawSpare) ? 0 : rawSpare;
      const rawCurrent = row[5] != null ? Number(row[5]) : quantitySpare;
      const current = isNaN(rawCurrent) ? quantitySpare : rawCurrent;
      const location = row[7] != null ? String(row[7]).trim() : "-";
      const allocation = row[8] != null ? String(row[8]).trim() : "-";
      const status = row[9] != null ? String(row[9]).trim() : "";
      const remarks = row[10] != null ? String(row[10]).trim() : "";
      const sheetRow = i + 1;

      db.prepare(
        `
        INSERT INTO storage_items (item, type, brand, model, quantity_spare, current, location, allocation, status, remarks, sheet_row)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        item,
        type,
        brand,
        model,
        quantitySpare,
        current,
        location,
        allocation,
        status,
        remarks,
        sheetRow,
      );
      spareCount++;
    }

    let deployedCount = 0;
    for (let i = 2; i < deployedData.length; i++) {
      const row = deployedData[i];
      const item = row[0] != null ? String(row[0]).trim() : "";
      if (!item) continue;
      const type = row[1] != null ? String(row[1]).trim() : "-";
      const brand = row[2] != null ? String(row[2]).trim() : "-";
      const model = row[3] != null ? String(row[3]).trim() : "-";
      const rawQty = row[4] != null ? Number(row[4]) : 0;
      const quantity = isNaN(rawQty) ? 0 : rawQty;
      const location = row[5] != null ? String(row[5]).trim() : "-";
      const allocation = row[6] != null ? String(row[6]).trim() : "-";
      const status = row[7] != null ? String(row[7]).trim() : "";
      const remarks = row[8] != null ? String(row[8]).trim() : "";

      db.prepare(
        `
        INSERT INTO deployed_items (item, type, brand, model, quantity, location, allocation, status, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        item,
        type,
        brand,
        model,
        quantity,
        location,
        allocation,
        status,
        remarks,
      );
      deployedCount++;
    }

    console.log(
      `Auto-synced ${spareCount} storage items, ${deployedCount} deployed items`,
    );
  });

  seedAll();
}

function initializeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      email TEXT DEFAULT NULL,
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

    CREATE TABLE IF NOT EXISTS loan_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      loan_type TEXT NOT NULL DEFAULT 'temporary',
      items_json TEXT NOT NULL DEFAULT '[]',
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  // Migrate: add columns to existing tables that may predate schema changes
  const migrations = [
    "ALTER TABLE deployed_items ADD COLUMN loan_request_id INTEGER DEFAULT NULL",
    "ALTER TABLE deployed_items ADD COLUMN sheet_row INTEGER DEFAULT NULL",
    "ALTER TABLE loan_requests ADD COLUMN location TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN email TEXT DEFAULT NULL",
  ];
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch (_) {
      /* column already exists */
    }
  }

  // Indexes for performance
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_storage_items_type ON storage_items(type)",
    "CREATE INDEX IF NOT EXISTS idx_storage_items_brand ON storage_items(brand)",
    "CREATE INDEX IF NOT EXISTS idx_storage_items_sheet_row ON storage_items(sheet_row)",
    "CREATE INDEX IF NOT EXISTS idx_deployed_items_loan ON deployed_items(loan_request_id)",
    "CREATE INDEX IF NOT EXISTS idx_loan_requests_user ON loan_requests(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_loan_requests_status ON loan_requests(status)",
    "CREATE INDEX IF NOT EXISTS idx_loan_items_request ON loan_items(loan_request_id)",
    "CREATE INDEX IF NOT EXISTS idx_loan_items_item ON loan_items(item_id)",
    "CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(user_id, read)",
    "CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id)",
  ];
  for (const sql of indexes) {
    db.exec(sql);
  }

  // Seed default invite code from env if not already set
  const existing = db
    .prepare("SELECT value FROM app_settings WHERE key = 'invite_code'")
    .get();
  if (!existing) {
    const defaultCode = process.env.INVITE_CODE || "techministry2026";
    db.prepare(
      "INSERT INTO app_settings (key, value) VALUES ('invite_code', ?)",
    ).run(defaultCode);
  }

  // Auto-create admin user on fresh databases (critical for Vercel cold starts)
  const adminExists = db
    .prepare("SELECT id FROM users WHERE role = 'admin'")
    .get();
  if (!adminExists) {
    const adminPass = process.env.ADMIN_PASSWORD || "admin123";
    const adminName = process.env.ADMIN_DISPLAY_NAME || "Admin";
    const adminUser = (process.env.ADMIN_USERNAME || "admin")
      .trim()
      .toLowerCase();
    const hash = bcrypt.hashSync(adminPass, 10);
    db.prepare(
      "INSERT OR IGNORE INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)",
    ).run(adminUser, hash, adminName, "admin");
    console.log(
      `Admin user "${adminUser}" auto-created (change password after first login)`,
    );
  }
}

export function getSetting(key) {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM app_settings WHERE key = ?")
    .get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  const db = getDb();
  db.prepare(
    "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
  ).run(key, value);
}

/**
 * Ensure the JWT user exists in the DB (cold start recovery for Vercel).
 * On ephemeral DBs only the admin is auto-seeded; regular users need to
 * be re-created from the JWT payload so FK constraints don't fail.
 */
export function ensureUserExists(user) {
  if (!user) return;
  const db = getDb();
  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(user.id);
  if (!existing) {
    db.prepare(
      "INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)",
    ).run(
      user.id,
      user.username,
      "!cold-start-stub",
      user.display_name,
      user.role,
    );
  }
}

export default getDb;
