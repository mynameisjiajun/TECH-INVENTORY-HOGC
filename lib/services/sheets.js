import { google } from "googleapis";

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;

let _sheetsClient = null;

async function getSheets() {
  if (_sheetsClient) return _sheetsClient;
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  const client = await auth.getClient();
  _sheetsClient = google.sheets({ version: "v4", auth: client });
  return _sheetsClient;
}

/**
 * Read all rows from a sheet (or a specific range).
 * Returns a 2D array of cell values.
 */
export async function readSheet(sheetName, range) {
  const sheets = await getSheets();
  const fullRange = range ? `'${sheetName}'!${range}` : `'${sheetName}'`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: fullRange,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return res.data.values || [];
}

/**
 * Update a single cell in a sheet.
 * @param {string} sheetName - Sheet tab name
 * @param {string} cell - A1 notation, e.g. "G5"
 * @param {*} value - The value to write
 */
export async function updateCell(sheetName, cell, value) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!${cell}`,
    valueInputOption: "RAW",
    requestBody: { values: [[value]] },
  });
}

/**
 * Batch-update multiple cells in a sheet.
 * @param {string} sheetName - Sheet tab name
 * @param {Array<{cell: string, value: *}>} updates - e.g. [{cell: "G5", value: 10}]
 */
export async function batchUpdateCells(sheetName, updates) {
  if (!updates || updates.length === 0) return;
  const sheets = await getSheets();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: "RAW",
      data: updates.map((u) => ({
        range: `'${sheetName}'!${u.cell}`,
        values: [[u.value]],
      })),
    },
  });
}

function toSheetNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Write authoritative values to cells, clamping them to non-negative numbers.
 * If the same cell appears multiple times, the last authoritative value wins.
 * @param {string} sheetName - Sheet tab name
 * @param {Array<{cell: string, value: number}>} updates
 */
export async function writeAbsoluteCells(sheetName, updates) {
  if (!updates || updates.length === 0) return;

  const mergedUpdates = new Map();
  for (const update of updates) {
    if (!update?.cell) continue;
    mergedUpdates.set(update.cell, Math.max(0, toSheetNumber(update.value)));
  }

  if (mergedUpdates.size === 0) return;

  await batchUpdateCells(
    sheetName,
    [...mergedUpdates.entries()].map(([cell, value]) => ({ cell, value })),
  );
}

/**
 * Append rows to the bottom of a sheet.
 * Manually finds the last row with data (checking column B since column A
 * may be empty) and writes below it, so rows always land at the end.
 * @param {string} sheetName - Sheet tab name
 * @param {Array<Array<*>>} rows - 2D array of values, one inner array per row
 */
export async function appendRows(sheetName, rows) {
  if (!rows || rows.length === 0) return;
  const sheets = await getSheets();
  // Read column B to find the last row with data (column A is often empty)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!B:B`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const existing = res.data.values || [];
  const startRow = existing.length + 1;
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A${startRow}`,
    valueInputOption: "RAW",
    requestBody: { values: rows },
  });
}

/**
 * Ensure a sheet tab exists in the spreadsheet; create it if missing.
 */
async function ensureSheetExists(sheetName) {
  const sheets = await getSheets();
  try {
    const meta = await sheets.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: "sheets.properties.title",
    });
    const exists = (meta.data.sheets || []).some(
      (s) => s.properties.title === sheetName,
    );
    if (!exists) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{ addSheet: { properties: { title: sheetName } } }],
        },
      });
    }
  } catch (err) {
    console.error(`Failed to ensure sheet "${sheetName}" exists:`, err.message);
  }
}

/**
 * Clear all data in a sheet and write new rows.
 * Creates the sheet tab if it doesn't exist.
 * @param {string} sheetName
 * @param {Array<Array<*>>} rows - 2D array including header row
 */
export async function clearAndWriteSheet(sheetName, rows) {
  await ensureSheetExists(sheetName);
  const sheets = await getSheets();
  try {
    await sheets.spreadsheets.values.clear({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'`,
    });
  } catch {
    /* sheet may be empty already */
  }
  if (rows && rows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });
  }
}
