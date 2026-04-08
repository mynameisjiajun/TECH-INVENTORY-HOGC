import test from "node:test";
import assert from "node:assert/strict";
import {
  buildStockCellUpdates,
  clampNonNegativeNumber,
  normalizeSheetRows,
} from "./inventorySheetSyncCore.js";

test("normalizeSheetRows keeps unique positive integer rows", () => {
  assert.deepEqual(
    normalizeSheetRows([
      { sheetRow: 4 },
      { sheetRow: "4" },
      { sheetRow: 7 },
      { sheetRow: 0 },
      { sheetRow: -1 },
      { sheetRow: "abc" },
      {},
      null,
    ]),
    [4, 7],
  );
});

test("buildStockCellUpdates clamps negatives and defaults missing rows to zero", () => {
  assert.deepEqual(
    buildStockCellUpdates(
      [5, 9, 12],
      [
        { sheet_row: 5, current: 8 },
        { sheet_row: 9, current: -3 },
      ],
      "G",
    ),
    [
      { cell: "G5", value: 8 },
      { cell: "G9", value: 0 },
      { cell: "G12", value: 0 },
    ],
  );
});

test("clampNonNegativeNumber normalizes invalid values", () => {
  assert.equal(clampNonNegativeNumber("11"), 11);
  assert.equal(clampNonNegativeNumber(-4), 0);
  assert.equal(clampNonNegativeNumber("oops"), 0);
});
