import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs";
import { readSheet, clearAndWriteSheet } from "./sheets.js";

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
let _usersRestored = false;

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
 * Ensure users are restored from Google Sheets on cold start.
 * This runs independently of inventory sync — call in any API route that needs auth.
 */
let _usersRestorePromise = null;
export async function ensureUsersRestored() {
  if (_usersRestored) return;
  if (_usersRestorePromise) {
    await _usersRestorePromise;
    return;
  }
  getDb(); // ensure DB is initialized
  _usersRestorePromise = restoreUsersFromSheet();
  try {
    await _usersRestorePromise;
  } catch (err) {
    console.error("User restore failed:", err);
  } finally {
    _usersRestorePromise = null;
    _usersRestored = true;
  }
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

  // Restore users, templates, and loans from Sheets first
  await restoreUsersFromSheet();
  await restoreTemplatesFromSheet();
  await restoreLoansFromSheet();

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

      // Upsert by sheet_row to prevent duplicates
      const existing = db
        .prepare("SELECT id FROM storage_items WHERE sheet_row = ?")
        .get(sheetRow);
      if (existing) {
        db.prepare(
          `UPDATE storage_items SET item=?, type=?, brand=?, model=?, quantity_spare=?, current=?,
           location=?, allocation=?, status=?, remarks=? WHERE sheet_row = ?`,
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
      } else {
        db.prepare(
          `INSERT INTO storage_items (item, type, brand, model, quantity_spare, current, location, allocation, status, remarks, sheet_row)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      }
      spareCount++;
    }

    // Remove deployed items from sheets (keep loan-based ones)
    db.prepare(
      "DELETE FROM deployed_items WHERE loan_request_id IS NULL",
    ).run();

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
        `INSERT INTO deployed_items (item, type, brand, model, quantity, location, allocation, status, remarks)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

    CREATE TABLE IF NOT EXISTS activity_feed (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      description TEXT NOT NULL,
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
      order_idx INTEGER DEFAULT 0,
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
    "ALTER TABLE loan_templates ADD COLUMN order_idx INTEGER DEFAULT 0",
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

  // Remove duplicate storage items (keep the one with lowest id per sheet_row)
  try {
    db.exec(`
      DELETE FROM storage_items WHERE id NOT IN (
        SELECT MIN(id) FROM storage_items GROUP BY sheet_row
      ) AND sheet_row IS NOT NULL
    `);
  } catch (_) {
    /* table might be empty */
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

/**
 * Restore users from the "Users" sheet in Google Sheets (cold start recovery).
 * Sheet columns: A=id, B=username, C=password_hash, D=display_name, E=role, F=email, G=created_at
 */
async function restoreUsersFromSheet() {
  try {
    const data = await readSheet("Users", "A:G");
    if (!data || data.length < 2) return; // no data or only header

    const db = getDb();
    let restored = 0;
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (!row || !row[1]) continue; // skip empty rows
      const id = row[0] != null ? Number(row[0]) : null;
      const username = String(row[1]).trim();
      const passwordHash = row[2] != null ? String(row[2]) : "!cold-start-stub";
      const displayName = row[3] != null ? String(row[3]).trim() : username;
      const role = row[4] != null ? String(row[4]).trim() : "user";
      const email =
        row[5] != null && String(row[5]).trim() ? String(row[5]).trim() : null;

      const existing = db
        .prepare("SELECT id FROM users WHERE username = ?")
        .get(username);
      if (existing) {
        // Update existing user with latest data from Sheets (restore password hash)
        db.prepare(
          "UPDATE users SET password_hash = ?, display_name = ?, role = ?, email = ? WHERE username = ?",
        ).run(passwordHash, displayName, role, email, username);
      } else {
        // Insert with original ID if possible
        if (id) {
          db.prepare(
            "INSERT OR IGNORE INTO users (id, username, password_hash, display_name, role, email) VALUES (?, ?, ?, ?, ?, ?)",
          ).run(id, username, passwordHash, displayName, role, email);
        } else {
          db.prepare(
            "INSERT OR IGNORE INTO users (username, password_hash, display_name, role, email) VALUES (?, ?, ?, ?, ?)",
          ).run(username, passwordHash, displayName, role, email);
        }
      }
      restored++;
    }
    if (restored > 0) {
      console.log(`Restored ${restored} users from Google Sheets`);
    }
  } catch (err) {
    // Sheet might not exist yet — that's OK
    if (!err.message?.includes("Unable to parse range")) {
      console.error("Failed to restore users from Sheet:", err.message);
    }
  }
}

/**
 * Sync all users to the "Users" sheet in Google Sheets for persistence.
 * Call this after any user mutation (register, password change, role change, delete).
 */
export async function syncUsersToSheet() {
  if (
    !process.env.GOOGLE_SHEETS_ID ||
    !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    !process.env.GOOGLE_PRIVATE_KEY
  )
    return;

  try {
    const db = getDb();
    const users = db
      .prepare(
        "SELECT id, username, password_hash, display_name, role, email, created_at FROM users",
      )
      .all();
    const header = [
      [
        "ID",
        "Username",
        "Password Hash",
        "Display Name",
        "Role",
        "Email",
        "Created At",
      ],
    ];
    const rows = users.map((u) => [
      u.id,
      u.username,
      u.password_hash,
      u.display_name,
      u.role,
      u.email || "",
      u.created_at || "",
    ]);
    await clearAndWriteSheet("Users", [...header, ...rows]);
    console.log(`Synced ${users.length} users to Google Sheets`);
  } catch (err) {
    console.error("Failed to sync users to Sheet:", err.message);
  }
}

/**
 * Restore presets (loan_templates) from Google Sheets.
 * Columns: A=id, B=name, C=description, D=loan_type, E=items_json, F=created_by, G=created_at, H=order_idx
 */
async function restoreTemplatesFromSheet() {
  try {
    const data = await readSheet("Presets", "A:H");
    if (!data || data.length < 2) return;

    const db = getDb();
    let restored = 0;
    
    // Clear existing to avoid ID conflicts since Sheets is source of truth here
    db.prepare("DELETE FROM loan_templates").run();
    db.prepare("UPDATE sqlite_sequence SET seq = 0 WHERE name = 'loan_templates'").run();

    const stmt = db.prepare(`
      INSERT INTO loan_templates (id, name, description, loan_type, items_json, created_by, created_at, order_idx)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (!row || !row[0]) continue;
        const id = Number(row[0]);
        const name = String(row[1] || "").trim();
        const desc = String(row[2] || "").trim();
        const type = String(row[3] || "temporary").trim();
        const items = String(row[4] || "[]").trim();
        const created_by = Number(row[5] || 1); // fallback to admin (usually id 1)
        const created_at = String(row[6] || "").trim();
        const order_idx = Number(row[7] || 0);

        try {
            stmt.run(id, name, desc, type, items, created_by, created_at || null, order_idx);
            restored++;
        } catch (err) {
            console.error(`Failed to restore template id ${id}:`, err.message);
        }
    }
    if (restored > 0) {
      console.log(`Restored ${restored} templates from Google Sheets`);
    }

  } catch (err) {
    if (!err.message?.includes("Unable to parse range")) {
      console.error("Failed to restore templates from Sheet:", err.message);
    }
  }
}

/**
 * Sync all presets to Google Sheets.
 */
export async function syncTemplatesToSheet() {
  if (!process.env.GOOGLE_SHEETS_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) return;
  try {
    const db = getDb();
    const templates = db.prepare("SELECT * FROM loan_templates ORDER BY order_idx ASC, id ASC").all();
    const header = [["ID", "Name", "Description", "Loan Type", "Items JSON", "Created By ID", "Created At", "Order Index"]];
    const rows = templates.map((t) => [
      t.id, t.name, t.description || "", t.loan_type, t.items_json, t.created_by, t.created_at || "", t.order_idx || 0
    ]);
    await clearAndWriteSheet("Presets", [...header, ...rows]);
    console.log(`Synced ${templates.length} templates to Google Sheets`);
  } catch (err) {
    console.error("Failed to sync templates to Sheet:", err.message);
  }
}

/**
 * Restore loan requests from Google Sheets.
 * Columns: A=id, B=user_id, C=loan_type, D=status, E=purpose, F=department, G=location, H=start_date, I=end_date, J=admin_notes, K=created_at, L=updated_at, M=Items_JSON
 */
async function restoreLoansFromSheet() {
    try {
        const data = await readSheet("Loan Receipts", "A:M");
        if (!data || data.length < 2) return;
    
        const db = getDb();
        let restored = 0;
        
        // Clear existing local loans to rebuild from source of truth
        db.prepare("DELETE FROM loan_items").run();
        db.prepare("DELETE FROM loan_requests").run();
        db.prepare("UPDATE sqlite_sequence SET seq = 0 WHERE name = 'loan_requests'").run();
        db.prepare("UPDATE sqlite_sequence SET seq = 0 WHERE name = 'loan_items'").run();
        // Nullify deployed items loan_request_id before we recreate them
        db.prepare("UPDATE deployed_items SET loan_request_id = NULL").run();
    
        const tx = db.transaction(() => {
            const insertReq = db.prepare(`
                INSERT INTO loan_requests (id, user_id, loan_type, status, purpose, department, location, start_date, end_date, admin_notes, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const insertItem = db.prepare(`
                INSERT INTO loan_items (loan_request_id, item_id, quantity)
                VALUES (?, ?, ?)
            `);

            for (let i = 1; i < data.length; i++) {
                const row = data[i];
                if (!row || !row[0]) continue;
                const loanId = Number(row[0]);
                const userId = Number(row[1]);
                const type = String(row[2] || "temporary");
                const status = String(row[3] || "pending");
                const purpose = String(row[4] || "");
                const dept = String(row[5] || "");
                const loc = String(row[6] || "");
                const start = String(row[7] || "");
                const end = row[8] ? String(row[8]) : null;
                const notes = String(row[9] || "");
                const created = String(row[10] || "");
                const updated = String(row[11] || "");
                const itemsJson = String(row[12] || "[]");
                
                insertReq.run(loanId, userId, type, status, purpose, dept, loc, start, end, notes, created || null, updated || null);
                
                try {
                    const items = JSON.parse(itemsJson);
                    for(const item of items) {
                        insertItem.run(loanId, item.item_id, item.quantity);
                    }
                } catch(e) {
                    // JSON parse error
                }
                restored++;
            }
        });

        tx();
        if (restored > 0) {
          console.log(`Restored ${restored} loans from Google Sheets`);
        }
      } catch (err) {
        if (!err.message?.includes("Unable to parse range")) {
          console.error("Failed to restore loans from Sheet:", err.message);
        }
      }
}

/**
 * Sync all loan requests to Google Sheets.
 */
export async function syncLoansToSheet() {
    if (!process.env.GOOGLE_SHEETS_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) return;
    try {
      const db = getDb();
      const loans = db.prepare("SELECT * FROM loan_requests ORDER BY created_at ASC").all();
      
      const header = [["ID", "User ID", "Loan Type", "Status", "Purpose", "Department", "Location", "Start Date", "End Date", "Admin Notes", "Created At", "Updated At", "Items JSON"]];
      const rows = [];

      for(const loan of loans) {
          const items = db.prepare("SELECT item_id, quantity FROM loan_items WHERE loan_request_id = ?").all(loan.id);
          rows.push([
              loan.id, loan.user_id, loan.loan_type, loan.status, loan.purpose, 
              loan.department || "", loan.location || "", loan.start_date, loan.end_date || "", 
              loan.admin_notes || "", loan.created_at || "", loan.updated_at || "",
              JSON.stringify(items)
          ]);
      }

      await clearAndWriteSheet("Loan Receipts", [...header, ...rows]);
      console.log(`Synced ${loans.length} loans to Google Sheets`);
    } catch (err) {
      console.error("Failed to sync loans to Sheet:", err.message);
    }
}

export function logActivity(db, userId, action, description) {
  try {
    db.prepare(
      "INSERT INTO activity_feed (user_id, action, description) VALUES (?, ?, ?)"
    ).run(userId, action, description);
  } catch (err) {
    console.error("Failed to log activity:", err.message);
  }
}

export default getDb;
