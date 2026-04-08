import { appendRows } from "@/lib/services/sheets";
import { syncAuthoritativeStockToSheets } from "@/lib/services/inventorySheetSync";

const SHEETS_ENABLED = !!(
  process.env.GOOGLE_SHEETS_ID &&
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  process.env.GOOGLE_PRIVATE_KEY
);

async function syncDeployedToSheets(deployedRows) {
  if (!SHEETS_ENABLED || deployedRows.length === 0) return;

  try {
    const sheetRows = deployedRows.map((row) => [
      "",
      row.item,
      row.type,
      row.brand,
      row.model,
      row.quantity,
      row.location,
      row.allocation,
      row.status,
      row.remarks,
    ]);
    await appendRows("DEPLOYED", sheetRows);
  } catch (error) {
    console.error(
      "Google Sheets deployed write-back failed during auto-approval:",
      error.message,
    );
  }
}

function rollbackTechLoanAutoApprovalTx(db, resolvedItems, loanId) {
  db.transaction((items, currentLoanId) => {
    for (const item of items || []) {
      const storageItem = item.sheet_row
        ? db
            .prepare("SELECT id FROM storage_items WHERE sheet_row = ?")
            .get(item.sheet_row)
        : db
            .prepare("SELECT id FROM storage_items WHERE id = ?")
            .get(item.item_id);

      if (!storageItem) continue;

      db.prepare(
        "UPDATE storage_items SET current = current + ? WHERE id = ?",
      ).run(item.quantity, storageItem.id);
    }

    db.prepare("DELETE FROM deployed_items WHERE remarks LIKE ?").run(
      `Perm loan #${currentLoanId}%`,
    );
  })(resolvedItems, loanId);
}

export async function autoApproveTechLoan({
  db,
  loanId,
  loanType,
  purpose,
  department,
  location,
  resolvedItems,
}) {
  const applyApprovalTx = db.transaction(
    (
      items,
      currentLoanId,
      currentLoanType,
      currentPurpose,
      currentDepartment,
      currentLocation,
    ) => {
      const stockChanges = [];
      const deployedRows = [];

      for (const item of items || []) {
        const storageItem = item.sheet_row
          ? db
              .prepare("SELECT * FROM storage_items WHERE sheet_row = ?")
              .get(item.sheet_row)
          : db
              .prepare("SELECT * FROM storage_items WHERE id = ?")
              .get(item.item_id);

        if (!storageItem) {
          throw new Error(`Item not found in inventory: ${item.item_name}`);
        }

        if (storageItem.current < item.quantity) {
          throw new Error(
            `Not enough stock for \"${storageItem.item}\". Available: ${storageItem.current}`,
          );
        }

        const result = db
          .prepare(
            "UPDATE storage_items SET current = current - ? WHERE id = ? AND current >= ?",
          )
          .run(item.quantity, storageItem.id, item.quantity);

        if (result.changes === 0) {
          throw new Error(
            `Stock changed while auto-approving \"${storageItem.item}\". Please retry.`,
          );
        }

        stockChanges.push({
          sheetRow: storageItem.sheet_row,
          delta: -item.quantity,
        });

        if (currentLoanType === "permanent") {
          const deployedRow = {
            item: storageItem.item,
            type: storageItem.type,
            brand: storageItem.brand,
            model: storageItem.model,
            quantity: item.quantity,
            location: currentLocation || storageItem.location,
            allocation: currentDepartment || currentPurpose,
            status: "DEPLOYED",
            remarks: `Perm loan #${currentLoanId} — ${currentPurpose}`,
          };

          db.prepare(
            `INSERT INTO deployed_items (item, type, brand, model, quantity, location, allocation, status, remarks)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            deployedRow.item,
            deployedRow.type,
            deployedRow.brand,
            deployedRow.model,
            deployedRow.quantity,
            deployedRow.location,
            deployedRow.allocation,
            deployedRow.status,
            deployedRow.remarks,
          );

          deployedRows.push(deployedRow);
        }
      }

      return { stockChanges, deployedRows };
    },
  );

  const { stockChanges, deployedRows } = applyApprovalTx(
    resolvedItems,
    loanId,
    loanType,
    purpose,
    department,
    location,
  );

  try {
    await syncAuthoritativeStockToSheets(db, stockChanges);
  } catch (error) {
    rollbackTechLoanAutoApprovalTx(db, resolvedItems, loanId);
    throw error;
  }

  await syncDeployedToSheets(deployedRows);

  return { stockChanges, deployedRows };
}
