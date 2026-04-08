import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/db";
import { invalidateAll } from "@/lib/utils/cache";
import { readSheet } from "@/lib/services/sheets";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const SHEETS_ENABLED = !!(
  process.env.GOOGLE_SHEETS_ID &&
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  process.env.GOOGLE_PRIVATE_KEY
);

function clampInventoryCurrent(value, quantitySpare) {
  const normalizedValue = Number.isFinite(value) ? value : 0;
  const normalizedQuantity = Number.isFinite(quantitySpare) ? quantitySpare : 0;
  return Math.max(0, Math.min(normalizedValue, normalizedQuantity));
}

export async function POST(request) {
  // Verify secret token from Google Apps Script
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace("Bearer ", "");

  if (!WEBHOOK_SECRET || token !== WEBHOOK_SECRET) {
    console.warn("Inventory webhook: unauthorized attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!SHEETS_ENABLED) {
    return NextResponse.json(
      { error: "Google Sheets not configured" },
      { status: 400 },
    );
  }

  try {
    const [spareData, deployedData] = await Promise.all([
      readSheet("Storage Spare", "B:L"),
      readSheet("DEPLOYED", "B:J"),
    ]);

    const db = getDb();

    const syncAll = db.transaction(() => {
      const seenSheetRows = new Set();
      let storageUpdated = 0;

      for (let i = 2; i < spareData.length; i++) {
        const row = spareData[i];
        const item = row[0] != null ? String(row[0]).trim() : "";
        if (!item) continue;

        const sheetRow = i + 1;
        const type = row[1] != null ? String(row[1]).trim() : "-";
        const brand = row[2] != null ? String(row[2]).trim() : "-";
        const model = row[3] != null ? String(row[3]).trim() : "-";
        const rawSpare = row[4] != null ? Number(row[4]) : 0;
        const quantitySpare = isNaN(rawSpare) ? 0 : rawSpare;
        const rawCurrent = row[5] != null ? Number(row[5]) : quantitySpare;
        const current = clampInventoryCurrent(
          isNaN(rawCurrent) ? quantitySpare : rawCurrent,
          quantitySpare,
        );
        const location = row[7] != null ? String(row[7]).trim() : "-";
        const allocation = row[8] != null ? String(row[8]).trim() : "-";
        const status = row[9] != null ? String(row[9]).trim() : "";
        const remarks = row[10] != null ? String(row[10]).trim() : "";

        seenSheetRows.add(sheetRow);
        const existing = db
          .prepare("SELECT id FROM storage_items WHERE sheet_row = ?")
          .get(sheetRow);
        if (existing) {
          db.prepare(
            `
            UPDATE storage_items SET item=?, type=?, brand=?, model=?, quantity_spare=?, current=?,
              location=?, allocation=?, status=?, remarks=?
            WHERE sheet_row = ?
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
        } else {
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
        }
        storageUpdated++;
      }

      // Remove rows deleted from the sheet
      if (seenSheetRows.size > 0) {
        const allDbRows = db
          .prepare(
            "SELECT id, sheet_row FROM storage_items WHERE sheet_row IS NOT NULL",
          )
          .all();
        for (const dbRow of allDbRows) {
          if (!seenSheetRows.has(dbRow.sheet_row)) {
            db.prepare("DELETE FROM storage_items WHERE id = ?").run(dbRow.id);
          }
        }
      }

      db.prepare(
        "DELETE FROM deployed_items WHERE loan_request_id IS NULL",
      ).run();
      let deployedUpdated = 0;

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
        deployedUpdated++;
      }

      return { storageUpdated, deployedUpdated };
    });

    const { storageUpdated, deployedUpdated } = syncAll();
    invalidateAll();

    console.log(
      `Inventory webhook: synced ${storageUpdated} storage, ${deployedUpdated} deployed`,
    );
    return NextResponse.json({ ok: true, storageUpdated, deployedUpdated });
  } catch (err) {
    console.error("Inventory webhook error:", err);
    return NextResponse.json(
      { error: `Sync failed: ${err.message}` },
      { status: 500 },
    );
  }
}
