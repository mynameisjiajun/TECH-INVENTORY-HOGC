import { google } from 'googleapis';

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID;

let _sheetsClient = null;

async function getSheets() {
  if (_sheetsClient) return _sheetsClient;
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  const client = await auth.getClient();
  _sheetsClient = google.sheets({ version: 'v4', auth: client });
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
    valueRenderOption: 'UNFORMATTED_VALUE',
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
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] },
  });
}

/**
 * Batch-read multiple cells from a sheet.
 * @param {string} sheetName - Sheet tab name
 * @param {string[]} cells - A1 notation cells, e.g. ["G3", "G5", "G10"]
 * @returns {Promise<Array<*>>} Values in the same order as the input cells
 */
export async function readCells(sheetName, cells) {
  if (!cells || cells.length === 0) return [];
  const sheets = await getSheets();
  const ranges = cells.map(c => `'${sheetName}'!${c}`);
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: SPREADSHEET_ID,
    ranges,
    valueRenderOption: 'UNFORMATTED_VALUE',
  });
  return (res.data.valueRanges || []).map(vr => {
    const vals = vr.values;
    return vals && vals[0] ? vals[0][0] : 0;
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
      valueInputOption: 'RAW',
      data: updates.map(u => ({
        range: `'${sheetName}'!${u.cell}`,
        values: [[u.value]],
      })),
    },
  });
}

/**
 * Read current values from cells, apply deltas, and write back.
 * @param {string} sheetName - Sheet tab name
 * @param {Array<{cell: string, delta: number}>} changes - e.g. [{cell: "G5", delta: -2}]
 */
/**
 * Append rows to the bottom of a sheet.
 * @param {string} sheetName - Sheet tab name
 * @param {Array<Array<*>>} rows - 2D array of values, one inner array per row
 */
export async function appendRows(sheetName, rows) {
  if (!rows || rows.length === 0) return;
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${sheetName}'!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

export async function applyDeltasToCells(sheetName, changes) {
  if (!changes || changes.length === 0) return;
  const cells = changes.map(c => c.cell);
  const currentValues = await readCells(sheetName, cells);
  const updates = changes.map((c, i) => ({
    cell: c.cell,
    value: (typeof currentValues[i] === 'number' ? currentValues[i] : 0) + c.delta,
  }));
  await batchUpdateCells(sheetName, updates);
}
