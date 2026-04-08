export function clampNonNegativeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function normalizeSheetRows(changes) {
  if (!Array.isArray(changes) || changes.length === 0) return [];

  return [
    ...new Set(
      changes
        .map((change) => Number.parseInt(change?.sheetRow, 10))
        .filter((sheetRow) => Number.isInteger(sheetRow) && sheetRow > 0),
    ),
  ];
}

export function buildStockCellUpdates(sheetRows, rows, currentCol = "G") {
  const currentByRow = new Map(
    (rows || []).map((row) => [
      Number.parseInt(row.sheet_row, 10),
      clampNonNegativeNumber(row.current),
    ]),
  );

  return sheetRows.map((sheetRow) => ({
    cell: `${currentCol}${sheetRow}`,
    value: currentByRow.get(sheetRow) ?? 0,
  }));
}
