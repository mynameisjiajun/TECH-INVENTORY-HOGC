import { supabase } from "../db/supabase.js";
import { writeAbsoluteCells } from "./sheets.js";
import {
  buildStockCellUpdates,
  normalizeSheetRows,
} from "./inventorySheetSyncCore.js";

const SHEETS_ENABLED = !!(
  process.env.GOOGLE_SHEETS_ID &&
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  process.env.GOOGLE_PRIVATE_KEY
);
const STORAGE_SPARE_SHEET = "Storage Spare";
const CURRENT_COL = "G";
const OUTBOX_TABLE = "sheet_write_outbox";
const OUTBOX_FLUSH_LIMIT = 100;
let hasWarnedMissingOutboxTable = false;

export const DEFAULT_OUTBOX_FLUSH_LIMIT = OUTBOX_FLUSH_LIMIT;

function isMissingOutboxTableError(error) {
  const message = error?.message || "";
  return (
    message.includes(OUTBOX_TABLE) &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("Could not find the table"))
  );
}

function warnMissingOutboxTable() {
  if (hasWarnedMissingOutboxTable) return;
  hasWarnedMissingOutboxTable = true;
  console.warn(
    "sheet_write_outbox table is missing; apply migration 20260408_sheet_write_outbox.sql to enable durable sheet retries.",
  );
}

function toOutboxRows(sheetName, updates, lastError = null) {
  return updates.map((update) => ({
    sheet_name: sheetName,
    cell: update.cell,
    value: update.value,
    last_error: lastError,
  }));
}

async function upsertSheetWriteOutbox(sheetName, updates, lastError) {
  if (!updates.length) return;

  const { error } = await supabase
    .from(OUTBOX_TABLE)
    .upsert(toOutboxRows(sheetName, updates, lastError), {
      onConflict: "sheet_name,cell",
    });

  if (error) {
    if (isMissingOutboxTableError(error)) {
      warnMissingOutboxTable();
      return;
    }
    throw new Error(error.message || "Failed to persist sheet write outbox");
  }
}

async function clearSheetWriteOutbox(sheetName, cells) {
  if (!cells.length) return;

  const { error } = await supabase
    .from(OUTBOX_TABLE)
    .delete()
    .eq("sheet_name", sheetName)
    .in("cell", cells);

  if (error) {
    if (isMissingOutboxTableError(error)) {
      warnMissingOutboxTable();
      return;
    }
    throw new Error(error.message || "Failed to clear sheet write outbox");
  }
}

export async function flushSheetWriteOutbox(limit = OUTBOX_FLUSH_LIMIT) {
  if (!SHEETS_ENABLED) {
    return { attempted: 0, flushed: 0 };
  }

  const { data, error } = await supabase
    .from(OUTBOX_TABLE)
    .select("sheet_name, cell, value")
    .order("updated_at", { ascending: true })
    .limit(limit);

  if (error) {
    if (isMissingOutboxTableError(error)) {
      warnMissingOutboxTable();
      return { attempted: 0, flushed: 0 };
    }
    throw new Error(error.message || "Failed to load sheet write outbox");
  }

  if (!data || data.length === 0) {
    return { attempted: 0, flushed: 0 };
  }

  const updatesBySheet = new Map();
  for (const row of data) {
    if (!updatesBySheet.has(row.sheet_name)) {
      updatesBySheet.set(row.sheet_name, []);
    }
    updatesBySheet.get(row.sheet_name).push({
      cell: row.cell,
      value: row.value,
    });
  }

  let flushed = 0;
  for (const [sheetName, updates] of updatesBySheet.entries()) {
    await writeAbsoluteCells(sheetName, updates);
    await clearSheetWriteOutbox(
      sheetName,
      updates.map((update) => update.cell),
    );
    flushed += updates.length;
  }

  return { attempted: data.length, flushed };
}

export async function getSheetWriteOutboxPendingCount() {
  if (!SHEETS_ENABLED) {
    return 0;
  }

  const { count, error } = await supabase
    .from(OUTBOX_TABLE)
    .select("sheet_name", { count: "exact", head: true });

  if (error) {
    if (isMissingOutboxTableError(error)) {
      warnMissingOutboxTable();
      return 0;
    }

    throw new Error(error.message || "Failed to count sheet write outbox");
  }

  return count || 0;
}

export async function drainSheetWriteOutbox({
  batchSize = OUTBOX_FLUSH_LIMIT,
  maxBatches = 10,
} = {}) {
  let attempted = 0;
  let flushed = 0;
  let batches = 0;

  while (batches < maxBatches) {
    const result = await flushSheetWriteOutbox(batchSize);
    batches += 1;
    attempted += result.attempted;
    flushed += result.flushed;

    if (result.attempted < batchSize || result.attempted === 0) {
      break;
    }
  }

  return { attempted, flushed, batches };
}

export function getAuthoritativeStockUpdates(db, changes) {
  const sheetRows = normalizeSheetRows(changes);
  if (sheetRows.length === 0) return [];

  const placeholders = sheetRows.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT sheet_row, current FROM storage_items WHERE sheet_row IN (${placeholders})`,
    )
    .all(...sheetRows);

  return buildStockCellUpdates(sheetRows, rows, CURRENT_COL);
}

export async function syncAuthoritativeStockToSheets(db, changes) {
  if (!SHEETS_ENABLED || !Array.isArray(changes) || changes.length === 0) {
    return { attempted: false, queued: false, flushedQueued: 0 };
  }

  const updates = getAuthoritativeStockUpdates(db, changes);
  if (updates.length === 0) {
    return { attempted: false, queued: false, flushedQueued: 0 };
  }

  let flushedQueued = 0;
  try {
    const flushResult = await flushSheetWriteOutbox();
    flushedQueued = flushResult.flushed;
  } catch (error) {
    console.error("Google Sheets outbox flush failed:", error.message);
  }

  try {
    await writeAbsoluteCells(STORAGE_SPARE_SHEET, updates);
    try {
      await clearSheetWriteOutbox(
        STORAGE_SPARE_SHEET,
        updates.map((update) => update.cell),
      );
    } catch (error) {
      console.error("Failed to clear queued sheet writes:", error.message);
    }

    return {
      attempted: true,
      queued: false,
      flushedQueued,
      written: updates.length,
    };
  } catch (error) {
    console.error("Google Sheets stock write-back failed:", error.message);
    try {
      await upsertSheetWriteOutbox(STORAGE_SPARE_SHEET, updates, error.message);
      return {
        attempted: true,
        queued: true,
        flushedQueued,
        written: 0,
      };
    } catch (queueError) {
      console.error(
        "Failed to persist Google Sheets write outbox:",
        queueError.message,
      );
      return {
        attempted: true,
        queued: false,
        flushedQueued,
        written: 0,
      };
    }
  }
}
