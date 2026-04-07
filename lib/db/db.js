import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { readSheet } from "@/lib/services/sheets.js";
import { createClient } from "@supabase/supabase-js";

const IS_VERCEL = !!process.env.VERCEL;
const DB_DIR =
  process.env.DATABASE_DIR ||
  (IS_VERCEL ? "/tmp/data" : path.join(process.cwd(), "data"));
const DB_PATH = path.join(DB_DIR, "inventory.db");

// ─── ARCHITECTURE NOTE ────────────────────────────────────────────────
// SQLite (this file) manages INVENTORY ONLY:
//   - storage_items   → synced from "Storage Spare" Google Sheet
//   - deployed_items  → synced from "DEPLOYED" Google Sheet
//
// All other data (users, loans, templates, notifications, audit, settings)
// is stored in Supabase (persistent, survives Vercel cold starts).
//
// On cold start, inventory is auto-synced from Google Sheets.
// Real-time updates come via the Google Apps Script webhook → /api/items/webhook
// ─────────────────────────────────────────────────────────────────────

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

    // Check if inventory is empty and needs sync from Sheets
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
 * Wait for the initial inventory auto-sync to complete.
 * Call this in API routes that read inventory data.
 */
export async function waitForSync() {
  getDb();
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
  const syncStart = Date.now();

  const [spareData, deployedData] = await Promise.all([
    readSheet("Storage Spare", "B:L"),
    readSheet("DEPLOYED", "B:J"),
  ]);

  const seedAll = db.transaction(() => {
    // Pre-load existing sheet_row → id map to avoid N+1 SELECTs in the loop
    const existingBySheetRow = new Map(
      db
        .prepare(
          "SELECT id, sheet_row FROM storage_items WHERE sheet_row IS NOT NULL",
        )
        .all()
        .map((r) => [r.sheet_row, r.id]),
    );

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
      // Always start current = quantity_spare; approved loans are deducted below
      // so cold-start stock is always correct regardless of whether Sheets col G
      // was updated before the previous instance died.
      const current = quantitySpare;
      const location = row[7] != null ? String(row[7]).trim() : "-";
      const allocation = row[8] != null ? String(row[8]).trim() : "-";
      const status = row[9] != null ? String(row[9]).trim() : "";
      const remarks = row[10] != null ? String(row[10]).trim() : "";
      const sheetRow = i + 1;

      if (existingBySheetRow.has(sheetRow)) {
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

    db.prepare("DELETE FROM deployed_items").run();

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

  // ── Replay approved loans from Supabase ────────────────────────────────────
  // This makes cold starts self-healing: current stock is always
  // quantity_spare − approved_loan_quantities, regardless of whether
  // the Google Sheets write-back succeeded before the previous instance died.
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && supabaseKey) {
      const client = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      const { data: approvedLoans } = await client
        .from("loan_requests")
        .select("id")
        .eq("status", "approved");

      if (approvedLoans && approvedLoans.length > 0) {
        const approvedIds = approvedLoans.map((l) => l.id);
        const { data: approvedItems } = await client
          .from("loan_items")
          .select("sheet_row, quantity")
          .in("loan_request_id", approvedIds);

        if (approvedItems && approvedItems.length > 0) {
          const deductApproved = db.transaction(() => {
            for (const item of approvedItems) {
              if (item.sheet_row) {
                db.prepare(
                  "UPDATE storage_items SET current = MAX(0, current - ?) WHERE sheet_row = ?",
                ).run(item.quantity, item.sheet_row);
              }
            }
          });
          deductApproved();
          console.log(
            `Replayed ${approvedItems.length} approved loan item deductions from Supabase`,
          );
        }
      }
    }
  } catch (err) {
    console.error(
      "Failed to replay approved loans on cold start:",
      err.message,
    );
  }

  console.log(
    `Cold-start inventory sync completed in ${Date.now() - syncStart}ms`,
  );
}

function initializeSchema(db) {
  db.exec(`
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
      sheet_row INTEGER DEFAULT NULL
    );
  `);

  runStartupMigrations(db);

  // Indexes for performance
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_storage_items_type ON storage_items(type)",
    "CREATE INDEX IF NOT EXISTS idx_storage_items_brand ON storage_items(brand)",
    "CREATE INDEX IF NOT EXISTS idx_storage_items_sheet_row ON storage_items(sheet_row)",
    "CREATE INDEX IF NOT EXISTS idx_storage_items_current ON storage_items(current)",
    "CREATE INDEX IF NOT EXISTS idx_deployed_items_loan ON deployed_items(loan_request_id)",
  ];
  for (const sql of indexes) {
    db.exec(sql);
  }

  // Remove duplicate storage items (keep lowest id per sheet_row)
  try {
    db.exec(`
      DELETE FROM storage_items WHERE id NOT IN (
        SELECT MIN(id) FROM storage_items GROUP BY sheet_row
      ) AND sheet_row IS NOT NULL
    `);
  } catch (_) {
    /* table might be empty */
  }
}

function hasColumn(db, tableName, columnName) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return cols.some((c) => c.name === columnName);
}

function runStartupMigrations(db) {
  // Schema drift guard: older DBs may be missing deployed_items.loan_request_id.
  // Use an ADD COLUMN IF NOT EXISTS pattern via PRAGMA guard for SQLite compatibility.
  if (!hasColumn(db, "deployed_items", "loan_request_id")) {
    db.exec(
      "ALTER TABLE deployed_items ADD COLUMN loan_request_id INTEGER DEFAULT NULL",
    );
  }
}

export default getDb;
