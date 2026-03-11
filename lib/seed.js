const { google } = require('googleapis');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// --- Load .env.local manually (seed runs outside Next.js) ---
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;
const SERVICE_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

if (!SPREADSHEET_ID || !SERVICE_EMAIL || !PRIVATE_KEY || PRIVATE_KEY.includes('YOUR_KEY_HERE')) {
  console.error('\nMissing Google Sheets credentials.');
  console.error('Fill in .env.local with GOOGLE_SHEETS_ID, GOOGLE_SERVICE_ACCOUNT_EMAIL, and GOOGLE_PRIVATE_KEY.\n');
  process.exit(1);
}

const DB_PATH = path.join(__dirname, '..', 'data', 'inventory.db');

async function main() {
  // --- Google Sheets auth ---
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: SERVICE_EMAIL,
      private_key: PRIVATE_KEY,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });

  console.log('Connecting to Google Sheets...');

  // --- Read sheets (skip empty col A by reading from B onward) ---
  const [spareRes, deployedRes] = await Promise.all([
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "'Storage Spare'!B:L",
      valueRenderOption: 'UNFORMATTED_VALUE',
    }),
    sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "'DEPLOYED'!B:J",
      valueRenderOption: 'UNFORMATTED_VALUE',
    }),
  ]);

  const spareData = spareRes.data.values || [];
  const deployedData = deployedRes.data.values || [];

  console.log(`Read ${spareData.length} rows from Storage Spare, ${deployedData.length} rows from DEPLOYED`);

  // --- Prepare SQLite ---
  const dataDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
    console.log('Deleted existing database');
  }

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

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
  `);

  console.log('Schema created');

  // ========== SEED STORAGE SPARE ==========
  // Reading from B:L means indices match the old xlsx parser:
  // [0]=Item, [1]=Type, [2]=Brand, [3]=Model, [4]=Qty Spare, [5]=Current,
  // [6]=Loaned(formula), [7]=Location, [8]=Allocation, [9]=Status, [10]=Remarks
  //
  // sheet_row stores the 1-based row number in Google Sheets.
  // Since we read from row 1, API index i corresponds to sheet row (i + 1).
  // Data rows start at index 2 (sheet row 3).

  const insertItem = db.prepare(`
    INSERT INTO storage_items (item, type, brand, model, quantity_spare, current, location, allocation, status, remarks, sheet_row)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let spareCount = 0;
  for (let i = 2; i < spareData.length; i++) {
    const row = spareData[i];
    const item = row[0] != null ? String(row[0]).trim() : '';
    if (!item) continue;

    const type = row[1] != null ? String(row[1]).trim() : '-';
    const brand = row[2] != null ? String(row[2]).trim() : '-';
    const model = row[3] != null ? String(row[3]).trim() : '-';
    const quantitySpare = typeof row[4] === 'number' ? row[4] : 0;
    const current = typeof row[5] === 'number' ? row[5] : quantitySpare;
    const location = row[7] != null ? String(row[7]).trim() : '-';
    const allocation = row[8] != null ? String(row[8]).trim() : '-';
    const status = row[9] != null ? String(row[9]).trim() : '';
    const remarks = row[10] != null ? String(row[10]).trim() : '';
    const sheetRow = i + 1;

    insertItem.run(item, type, brand, model, quantitySpare, current, location, allocation, status, remarks, sheetRow);
    spareCount++;
  }
  console.log(`Seeded ${spareCount} storage spare items`);

  // ========== SEED DEPLOYED ==========
  // Reading from B:J:
  // [0]=Item, [1]=Type, [2]=Brand, [3]=Model, [4]=Quantity, [5]=Location,
  // [6]=Allocation, [7]=Status, [8]=Remarks

  const insertDeployed = db.prepare(`
    INSERT INTO deployed_items (item, type, brand, model, quantity, location, allocation, status, remarks)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let deployedCount = 0;
  for (let i = 2; i < deployedData.length; i++) {
    const row = deployedData[i];
    const item = row[0] != null ? String(row[0]).trim() : '';
    if (!item) continue;

    const type = row[1] != null ? String(row[1]).trim() : '-';
    const brand = row[2] != null ? String(row[2]).trim() : '-';
    const model = row[3] != null ? String(row[3]).trim() : '-';
    const quantity = typeof row[4] === 'number' ? row[4] : 0;
    const location = row[5] != null ? String(row[5]).trim() : '-';
    const allocation = row[6] != null ? String(row[6]).trim() : '-';
    const status = row[7] != null ? String(row[7]).trim() : '';
    const remarks = row[8] != null ? String(row[8]).trim() : '';

    insertDeployed.run(item, type, brand, model, quantity, location, allocation, status, remarks);
    deployedCount++;
  }
  console.log(`Seeded ${deployedCount} deployed items`);

  // ========== CREATE ADMIN USER ==========
  const adminPassword = bcrypt.hashSync('admin123', 10);
  db.prepare(`
    INSERT OR IGNORE INTO users (username, password_hash, display_name, role)
    VALUES (?, ?, ?, ?)
  `).run('admin', adminPassword, 'Jia Jun', 'admin');
  console.log('Admin user created (username: admin, password: admin123)');

  db.close();
  console.log('\nSeed complete!');
}

main().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
