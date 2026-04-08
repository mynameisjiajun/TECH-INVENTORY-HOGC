import { getDb, startSyncIfNeeded, waitForSync } from "@/lib/db/db";
import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { syncAuthoritativeStockToSheets } from "@/lib/services/inventorySheetSync";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { NextResponse } from "next/server";
import {
  insertRowsBestEffort,
  isNotFoundError,
  mutationError,
  withWarnings,
} from "@/lib/utils/mutationSafety";

function restoreApprovedLoanInventoryTx(db, oldItems, loanId, wasPermanent) {
  return db.transaction((items, currentLoanId, permanentLoan) => {
    const restoreChanges = [];

    for (const oldItem of items || []) {
      const storageItem = oldItem.sheet_row
        ? db
            .prepare(
              "SELECT id, sheet_row FROM storage_items WHERE sheet_row = ?",
            )
            .get(oldItem.sheet_row)
        : db
            .prepare("SELECT id, sheet_row FROM storage_items WHERE id = ?")
            .get(oldItem.item_id);

      if (!storageItem) {
        throw new Error(
          `Item no longer exists in inventory: ${oldItem.item_name}`,
        );
      }

      db.prepare(
        "UPDATE storage_items SET current = current + ? WHERE id = ?",
      ).run(oldItem.quantity, storageItem.id);

      restoreChanges.push({
        sheetRow: storageItem.sheet_row || oldItem.sheet_row,
        delta: oldItem.quantity,
      });
    }

    if (permanentLoan) {
      db.prepare("DELETE FROM deployed_items WHERE remarks LIKE ?").run(
        `Perm loan #${currentLoanId}%`,
      );
    }

    return restoreChanges;
  })(oldItems, loanId, wasPermanent);
}

function rollbackInventoryRestoreTx(db, oldItems, deployedRows) {
  db.transaction((items, priorDeployedRows) => {
    for (const oldItem of items || []) {
      const storageItem = oldItem.sheet_row
        ? db
            .prepare("SELECT id FROM storage_items WHERE sheet_row = ?")
            .get(oldItem.sheet_row)
        : db
            .prepare("SELECT id FROM storage_items WHERE id = ?")
            .get(oldItem.item_id);

      if (!storageItem) continue;

      db.prepare(
        "UPDATE storage_items SET current = current - ? WHERE id = ?",
      ).run(oldItem.quantity, storageItem.id);
    }

    if (priorDeployedRows.length) {
      for (const row of priorDeployedRows) {
        db.prepare(
          `INSERT INTO deployed_items (item, type, brand, model, quantity, location, allocation, status, remarks)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          row.item,
          row.type,
          row.brand,
          row.model,
          row.quantity,
          row.location,
          row.allocation,
          row.status,
          row.remarks,
        );
      }
    }
  })(oldItems, deployedRows);
}

function applyApprovedLoanInventoryUpdateTx(
  db,
  oldItems,
  newItems,
  loanId,
  oldWasPermanent,
  newLoanType,
  purpose,
  department,
  location,
) {
  return db.transaction(
    (
      priorItems,
      replacementItems,
      currentLoanId,
      priorPermanent,
      currentLoanType,
      currentPurpose,
      currentDepartment,
      currentLocation,
    ) => {
      const sheetChangeMap = new Map();

      if (priorPermanent) {
        db.prepare("DELETE FROM deployed_items WHERE remarks LIKE ?").run(
          `Perm loan #${currentLoanId}%`,
        );
      }

      for (const oldItem of priorItems || []) {
        const storageItem = oldItem.sheet_row
          ? db
              .prepare(
                "SELECT id, sheet_row FROM storage_items WHERE sheet_row = ?",
              )
              .get(oldItem.sheet_row)
          : db
              .prepare("SELECT id, sheet_row FROM storage_items WHERE id = ?")
              .get(oldItem.item_id);

        if (!storageItem) {
          throw new Error(
            `Item no longer exists in inventory: ${oldItem.item_name}`,
          );
        }

        db.prepare(
          "UPDATE storage_items SET current = current + ? WHERE id = ?",
        ).run(oldItem.quantity, storageItem.id);

        const priorDelta = sheetChangeMap.get(storageItem.sheet_row) || 0;
        sheetChangeMap.set(
          storageItem.sheet_row,
          priorDelta + oldItem.quantity,
        );
      }

      for (const item of replacementItems || []) {
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
            `Stock changed while updating \"${storageItem.item}\". Please retry.`,
          );
        }

        const priorDelta = sheetChangeMap.get(storageItem.sheet_row) || 0;
        sheetChangeMap.set(storageItem.sheet_row, priorDelta - item.quantity);

        if (currentLoanType === "permanent") {
          db.prepare(
            `INSERT INTO deployed_items (item, type, brand, model, quantity, location, allocation, status, remarks)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            storageItem.item,
            storageItem.type,
            storageItem.brand,
            storageItem.model,
            item.quantity,
            currentLocation || storageItem.location,
            currentDepartment || currentPurpose,
            "DEPLOYED",
            `Perm loan #${currentLoanId} — ${currentPurpose}`,
          );
        }
      }

      return [...sheetChangeMap.entries()].map(([sheetRow, delta]) => ({
        sheetRow,
        delta,
      }));
    },
  )(
    oldItems,
    newItems,
    loanId,
    oldWasPermanent,
    newLoanType,
    purpose,
    department,
    location,
  );
}

function rollbackApprovedLoanInventoryUpdateTx(
  db,
  oldItems,
  newItems,
  loanId,
  oldDeployedRows,
  newLoanType,
) {
  db.transaction(
    (
      priorItems,
      replacementItems,
      currentLoanId,
      priorDeployedRows,
      currentLoanType,
    ) => {
      if (currentLoanType === "permanent") {
        db.prepare("DELETE FROM deployed_items WHERE remarks LIKE ?").run(
          `Perm loan #${currentLoanId}%`,
        );
      }

      for (const item of replacementItems || []) {
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

      if (priorDeployedRows.length > 0) {
        for (const row of priorDeployedRows) {
          db.prepare(
            `INSERT INTO deployed_items (item, type, brand, model, quantity, location, allocation, status, remarks)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            row.item,
            row.type,
            row.brand,
            row.model,
            row.quantity,
            row.location,
            row.allocation,
            row.status,
            row.remarks,
          );
        }
      }

      for (const oldItem of priorItems || []) {
        const storageItem = oldItem.sheet_row
          ? db
              .prepare("SELECT id FROM storage_items WHERE sheet_row = ?")
              .get(oldItem.sheet_row)
          : db
              .prepare("SELECT id FROM storage_items WHERE id = ?")
              .get(oldItem.item_id);

        if (!storageItem) continue;

        db.prepare(
          "UPDATE storage_items SET current = current - ? WHERE id = ?",
        ).run(oldItem.quantity, storageItem.id);
      }
    },
  )(oldItems, newItems, loanId, oldDeployedRows, newLoanType);
}

async function rollbackLoanRequestState({
  loanId,
  requestSnapshot,
  itemSnapshot,
}) {
  const warnings = [];

  const { error: requestRollbackError } = await supabase
    .from("loan_requests")
    .update(requestSnapshot)
    .eq("id", loanId);
  if (requestRollbackError) {
    warnings.push(
      mutationError(
        "Failed to restore tech loan request",
        requestRollbackError,
      ),
    );
  }

  const { error: deleteItemsError } = await supabase
    .from("loan_items")
    .delete()
    .eq("loan_request_id", loanId);
  if (deleteItemsError) {
    warnings.push(
      mutationError(
        "Failed to clear replacement tech loan items",
        deleteItemsError,
      ),
    );
    return warnings;
  }

  if (itemSnapshot.length > 0) {
    const { error: restoreItemsError } = await supabase
      .from("loan_items")
      .insert(
        itemSnapshot.map((item) => ({
          loan_request_id: loanId,
          item_id: item.item_id,
          sheet_row: item.sheet_row,
          item_name: item.item_name,
          quantity: item.quantity,
        })),
      );

    if (restoreItemsError) {
      warnings.push(
        mutationError(
          "Failed to restore original tech loan items",
          restoreItemsError,
        ),
      );
    }
  }

  return warnings;
}

// PUT: Modify an existing loan request
export async function PUT(request, { params }) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  startSyncIfNeeded();

  try {
    const warnings = [];
    const {
      loan_type,
      purpose,
      remarks,
      department,
      start_date,
      end_date,
      location,
      items,
    } = await request.json();
    const unawaitedParams = await params;
    const loanId = unawaitedParams.id;

    if (!loanId)
      return NextResponse.json({ error: "Loan ID required" }, { status: 400 });
    if (!items || items.length === 0)
      return NextResponse.json({ error: "No items selected" }, { status: 400 });

    for (const item of items) {
      if (
        !item.quantity ||
        item.quantity < 1 ||
        !Number.isInteger(item.quantity)
      ) {
        return NextResponse.json(
          { error: "Each item must have a quantity of at least 1" },
          { status: 400 },
        );
      }
    }
    if (!purpose || !purpose.trim())
      return NextResponse.json(
        { error: "Purpose is required" },
        { status: 400 },
      );
    if (!start_date)
      return NextResponse.json(
        { error: "Start date is required" },
        { status: 400 },
      );

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(start_date) || isNaN(Date.parse(start_date))) {
      return NextResponse.json(
        { error: "Invalid start date format" },
        { status: 400 },
      );
    }
    if (loan_type === "temporary" && !end_date) {
      return NextResponse.json(
        { error: "End date is required for temporary loans" },
        { status: 400 },
      );
    }
    if (
      end_date &&
      (!dateRegex.test(end_date) || isNaN(Date.parse(end_date)))
    ) {
      return NextResponse.json(
        { error: "Invalid end date format" },
        { status: 400 },
      );
    }
    if (end_date && start_date && end_date < start_date) {
      return NextResponse.json(
        { error: "End date cannot be before start date" },
        { status: 400 },
      );
    }

    // Fetch existing loan
    const { data: existingLoan, error: existingLoanError } = await supabase
      .from("loan_requests")
      .select(
        "id, user_id, loan_type, purpose, remarks, department, location, start_date, end_date, status, admin_notes, updated_at",
      )
      .eq("id", loanId)
      .single();

    if (existingLoanError && !isNotFoundError(existingLoanError)) {
      return NextResponse.json(
        { error: mutationError("Failed to load loan", existingLoanError) },
        { status: 500 },
      );
    }

    if (!existingLoan)
      return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    if (
      Number(existingLoan.user_id) !== Number(user.id) &&
      user.role !== "admin"
    ) {
      return NextResponse.json(
        { error: "Unauthorized to modify this loan" },
        { status: 403 },
      );
    }
    if (
      existingLoan.status === "returned" ||
      existingLoan.status === "rejected"
    ) {
      return NextResponse.json(
        { error: "Cannot modify a returned or rejected loan" },
        { status: 400 },
      );
    }

    const isAdminEditing = user.role === "admin";
    const nextStatus = isAdminEditing ? existingLoan.status : "pending";

    const { data: oldItems, error: oldItemsError } = await supabase
      .from("loan_items")
      .select("item_id, sheet_row, item_name, quantity")
      .eq("loan_request_id", loanId);

    if (oldItemsError) {
      return NextResponse.json(
        {
          error: mutationError(
            "Failed to load current loan items",
            oldItemsError,
          ),
        },
        { status: 500 },
      );
    }

    await waitForSync();
    const db = getDb();
    const requestSnapshot = {
      loan_type: existingLoan.loan_type,
      purpose: existingLoan.purpose,
      remarks: existingLoan.remarks,
      department: existingLoan.department,
      location: existingLoan.location,
      start_date: existingLoan.start_date,
      end_date: existingLoan.end_date,
      status: existingLoan.status,
      admin_notes: existingLoan.admin_notes,
      updated_at: existingLoan.updated_at,
    };
    const deployedSnapshot =
      existingLoan.status === "approved" &&
      existingLoan.loan_type === "permanent"
        ? db
            .prepare(
              "SELECT item, type, brand, model, quantity, location, allocation, status, remarks FROM deployed_items WHERE remarks LIKE ?",
            )
            .all(`Perm loan #${loanId}%`)
        : [];

    // If loan is approved, we calculate in-memory refunds to validate new stock
    const refundMap = new Map(); // item_id -> quantity
    if (existingLoan.status === "approved") {
      for (const oldItem of oldItems || []) {
        refundMap.set(oldItem.item_id, oldItem.quantity);
      }
    }

    // Validate new items against stock
    const resolvedItems = [];
    for (const item of items) {
      const storageItem = db
        .prepare("SELECT * FROM storage_items WHERE id = ?")
        .get(item.item_id);
      if (!storageItem) {
        return NextResponse.json(
          { error: `Item not found: ${item.item_id}` },
          { status: 400 },
        );
      }

      // Effective available stock = current stock + any stock that would be refunded from this loan
      const refundedQty = refundMap.get(item.item_id) || 0;
      const effectiveAvailable = storageItem.current + refundedQty;

      if (effectiveAvailable < item.quantity) {
        return NextResponse.json(
          {
            error: `Not enough stock for "${storageItem.item}". Available: ${effectiveAvailable}, Requested: ${item.quantity}`,
          },
          { status: 400 },
        );
      }

      resolvedItems.push({
        item_id: item.item_id,
        sheet_row: storageItem.sheet_row,
        item_name: storageItem.item,
        quantity: item.quantity,
      });
    }

    const { error: updateError } = await supabase
      .from("loan_requests")
      .update({
        loan_type,
        purpose: purpose.trim(),
        remarks: remarks?.trim() || null,
        department: department || "",
        location: location || "",
        start_date,
        end_date: end_date || null,
        status: nextStatus,
        admin_notes: isAdminEditing
          ? existingLoan.admin_notes
          : existingLoan.admin_notes
            ? `${existingLoan.admin_notes} (Modified by user)`
            : "Modified by user",
        updated_at: new Date().toISOString(),
      })
      .eq("id", loanId);
    if (updateError) {
      return NextResponse.json(
        { error: mutationError("Failed to update loan request", updateError) },
        { status: 500 },
      );
    }

    const { error: deleteItemsError } = await supabase
      .from("loan_items")
      .delete()
      .eq("loan_request_id", loanId);
    if (deleteItemsError) {
      const rollbackWarnings = await rollbackLoanRequestState({
        loanId,
        requestSnapshot,
        itemSnapshot: oldItems || [],
      });
      return NextResponse.json(
        {
          error: mutationError(
            "Failed to replace loan items",
            deleteItemsError,
          ),
          details: rollbackWarnings,
        },
        { status: 500 },
      );
    }

    const { error: insertItemsError } = await supabase
      .from("loan_items")
      .insert(
        resolvedItems.map((i) => ({
          loan_request_id: loanId,
          item_id: i.item_id,
          sheet_row: i.sheet_row,
          item_name: i.item_name,
          quantity: i.quantity,
        })),
      );
    if (insertItemsError) {
      const rollbackWarnings = await rollbackLoanRequestState({
        loanId,
        requestSnapshot,
        itemSnapshot: oldItems || [],
      });
      return NextResponse.json(
        {
          error: mutationError(
            "Failed to save replacement loan items",
            insertItemsError,
          ),
          details: rollbackWarnings,
        },
        { status: 500 },
      );
    }

    let inventorySheetChanges = [];
    if (existingLoan.status === "approved" && nextStatus === "approved") {
      try {
        inventorySheetChanges = applyApprovedLoanInventoryUpdateTx(
          db,
          oldItems || [],
          resolvedItems,
          loanId,
          existingLoan.loan_type === "permanent",
          loan_type,
          purpose.trim(),
          department || "",
          location || "",
        );
      } catch (inventoryError) {
        const rollbackWarnings = await rollbackLoanRequestState({
          loanId,
          requestSnapshot,
          itemSnapshot: oldItems || [],
        });
        return NextResponse.json(
          {
            error:
              inventoryError.message ||
              "Failed to refresh inventory for modified approved loan",
            details: rollbackWarnings,
          },
          { status: 500 },
        );
      }
    } else if (existingLoan.status === "approved") {
      let restoreChanges = [];
      try {
        restoreChanges = restoreApprovedLoanInventoryTx(
          db,
          oldItems || [],
          loanId,
          existingLoan.loan_type === "permanent",
        );
      } catch (inventoryError) {
        const rollbackWarnings = await rollbackLoanRequestState({
          loanId,
          requestSnapshot,
          itemSnapshot: oldItems || [],
        });
        return NextResponse.json(
          {
            error:
              inventoryError.message ||
              "Failed to restore inventory for modified loan",
            details: rollbackWarnings,
          },
          { status: 500 },
        );
      }

      inventorySheetChanges = restoreChanges;
    }

    if (inventorySheetChanges.length > 0) {
      try {
        await syncAuthoritativeStockToSheets(db, inventorySheetChanges);
      } catch (sheetError) {
        if (existingLoan.status === "approved" && nextStatus === "approved") {
          rollbackApprovedLoanInventoryUpdateTx(
            db,
            oldItems || [],
            resolvedItems,
            loanId,
            deployedSnapshot,
            loan_type,
          );
        } else {
          rollbackInventoryRestoreTx(db, oldItems || [], deployedSnapshot);
        }
        const rollbackWarnings = await rollbackLoanRequestState({
          loanId,
          requestSnapshot,
          itemSnapshot: oldItems || [],
        });
        return NextResponse.json(
          {
            error: sheetError.message || "Failed to sync restored inventory",
            details: rollbackWarnings,
          },
          { status: 500 },
        );
      }
    }

    if (isAdminEditing) {
      await insertRowsBestEffort({
        client: supabase,
        table: "notifications",
        entries: [
          {
            user_id: existingLoan.user_id,
            message:
              nextStatus === "approved"
                ? `An admin updated your approved loan #${loanId}.`
                : `An admin updated your loan request #${loanId}. It is still pending review.`,
            link: "/loans",
          },
        ],
        warnings,
        context: "loan requester notification",
      });

      await insertRowsBestEffort({
        client: supabase,
        table: "audit_log",
        entries: [
          {
            user_id: user.id,
            action: "modify",
            target_type: "loan",
            target_id: Number(loanId),
            details: `Admin modified ${nextStatus} tech loan request.`,
          },
        ],
        warnings,
        context: "loan audit log",
      });
    } else {
      const { data: admins } = await supabase
        .from("users")
        .select("id, mute_telegram")
        .eq("role", "admin");
      if (admins && admins.length > 0) {
        await insertRowsBestEffort({
          client: supabase,
          table: "notifications",
          entries: admins.map((admin) => ({
            user_id: admin.id,
            message: `${user.display_name} modified their ${loan_type} loan request #${loanId}.`,
            link: "/admin",
          })),
          warnings,
          context: "admin loan modification",
        });

        const itemListStr = resolvedItems
          .map((i) => `${i.item_name} × ${i.quantity}`)
          .join(", ");
        for (const admin of admins) {
          if (!admin.mute_telegram) {
            sendTelegramMessage(
              admin.id,
              `📝 <b>Loan Modified</b>\n<b>${user.display_name}</b> modified loan request #${loanId} (now pending).\n\nNew Items: ${itemListStr}`,
            ).catch(() => {});
          }
        }
      }

      await insertRowsBestEffort({
        client: supabase,
        table: "activity_feed",
        entries: [
          {
            user_id: user.id,
            action: "modify",
            description: `Modified loan #${loanId}`,
            link: "/admin",
          },
        ],
        warnings,
        context: "loan activity",
      });
    }

    return NextResponse.json(
      withWarnings(
        {
          message: isAdminEditing
            ? nextStatus === "approved"
              ? "Loan updated successfully and remains approved."
              : "Loan updated successfully and remains pending."
            : "Loan modified successfully and is now pending approval.",
        },
        warnings,
      ),
    );
  } catch (error) {
    console.error("Loan modification error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}

// DELETE: Cancel own pending loan request
export async function DELETE(_request, { params }) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const warnings = [];

  const { id } = await params;

  const { data: loan, error: loanError } = await supabase
    .from("loan_requests")
    .select(
      "id, user_id, status, loan_items(item_id, sheet_row, item_name, quantity)",
    )
    .eq("id", id)
    .single();

  if (loanError && !isNotFoundError(loanError)) {
    return NextResponse.json(
      { error: mutationError("Failed to load loan", loanError) },
      { status: 500 },
    );
  }

  if (!loan)
    return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  if (Number(loan.user_id) !== Number(user.id) && user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (loan.status !== "pending") {
    return NextResponse.json(
      { error: "Only pending loans can be cancelled" },
      { status: 400 },
    );
  }

  const { error: cancelLoanError } = await supabase
    .from("loan_requests")
    .delete()
    .eq("id", id);
  if (cancelLoanError)
    return NextResponse.json(
      { error: cancelLoanError.message || "Failed to cancel loan" },
      { status: 500 },
    );

  await insertRowsBestEffort({
    client: supabase,
    table: "notifications",
    entries: [
      {
        user_id: user.id,
        message: `Your loan request #${id} has been cancelled.`,
        link: "/loans",
      },
    ],
    warnings,
    context: "loan cancellation",
  });

  return NextResponse.json(
    withWarnings({ message: "Loan cancelled successfully." }, warnings),
  );
}
