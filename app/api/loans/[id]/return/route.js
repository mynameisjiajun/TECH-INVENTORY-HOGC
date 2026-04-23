import { getDb, startSyncIfNeeded, waitForSync } from "@/lib/db/db";
import { supabase } from "@/lib/db/supabase";
import { syncAuthoritativeStockToSheets } from "@/lib/services/inventorySheetSync";
import { getCurrentUser } from "@/lib/utils/auth";
import { invalidateAll } from "@/lib/utils/cache";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { sendLoanReturnEmail } from "@/lib/services/email";
import { escapeHtml, isSafeHttpsUrl } from "@/lib/utils/html";
import { NextResponse } from "next/server";
import {
  deleteStorageObjectBestEffort,
  insertRowsBestEffort,
  isNotFoundError,
  mutationError,
  withWarnings,
} from "@/lib/utils/mutationSafety";

function restoreReturnedLoanInventoryTx(db, loanItems, loanId, isPermanentLoan) {
  return db.transaction((items, currentLoanId, permanentLoan) => {
    const sheetChanges = [];
    const deployedRows = permanentLoan
      ? db
          .prepare(
            "SELECT item, type, brand, model, quantity, location, allocation, status, remarks FROM deployed_items WHERE remarks LIKE ?",
          )
          .all(`Perm loan #${currentLoanId}%`)
      : [];

    for (const loanItem of items || []) {
      const storageItem = loanItem.sheet_row
        ? db
            .prepare("SELECT id, sheet_row FROM storage_items WHERE sheet_row = ?")
            .get(loanItem.sheet_row)
        : db
            .prepare("SELECT id, sheet_row FROM storage_items WHERE id = ?")
            .get(loanItem.item_id);

      if (!storageItem) {
        throw new Error(
          `Item no longer exists in inventory: ${loanItem.item_name}`,
        );
      }

      db.prepare(
        "UPDATE storage_items SET current = current + ? WHERE id = ?",
      ).run(loanItem.quantity, storageItem.id);

      sheetChanges.push({
        sheetRow: storageItem.sheet_row || loanItem.sheet_row,
        delta: loanItem.quantity,
      });
    }

    if (permanentLoan) {
      db.prepare("DELETE FROM deployed_items WHERE remarks LIKE ?").run(
        `Perm loan #${currentLoanId}%`,
      );
    }

    return { sheetChanges, deployedRows };
  })(loanItems, loanId, isPermanentLoan);
}

function rollbackReturnedLoanInventoryTx(
  db,
  loanItems,
  deployedRows,
  isPermanentLoan,
) {
  db.transaction((items, priorDeployedRows, permanentLoan) => {
    for (const loanItem of items || []) {
      const storageItem = loanItem.sheet_row
        ? db
            .prepare("SELECT id FROM storage_items WHERE sheet_row = ?")
            .get(loanItem.sheet_row)
        : db
            .prepare("SELECT id FROM storage_items WHERE id = ?")
            .get(loanItem.item_id);

      if (!storageItem) continue;

      db.prepare(
        "UPDATE storage_items SET current = current - ? WHERE id = ?",
      ).run(loanItem.quantity, storageItem.id);
    }

    if (permanentLoan && priorDeployedRows.length > 0) {
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
  })(loanItems, deployedRows, isPermanentLoan);
}

function invertSheetChanges(sheetChanges) {
  return sheetChanges.map((change) => ({
    sheetRow: change.sheetRow,
    delta: -change.delta,
  }));
}

export async function POST(request, { params }) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const warnings = [];
    const { imageBase64, remarks } = await request.json();
    if (!imageBase64) {
      return NextResponse.json(
        { error: "Photo is required to return items" },
        { status: 400 },
      );
    }

    const unawaitedParams = await params;
    const loanId = unawaitedParams.id;
    if (!loanId) {
      return NextResponse.json(
        { error: "Loan ID is required" },
        { status: 400 },
      );
    }

    // Get loan from Supabase
    const { data: loan, error: loanError } = await supabase
      .from("loan_requests")
      .select("*")
      .eq("id", loanId)
      .single();

    if (loanError && !isNotFoundError(loanError)) {
      return NextResponse.json(
        { error: mutationError("Failed to load loan", loanError) },
        { status: 500 },
      );
    }

    if (!loan) {
      return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    }
    if (Number(loan.user_id) !== Number(user.id) && user.role !== "admin") {
      return NextResponse.json(
        { error: "Unauthorized to return this loan" },
        { status: 403 },
      );
    }
    if (loan.status !== "approved") {
      return NextResponse.json(
        { error: "Loan is not eligible for return" },
        { status: 400 },
      );
    }

    const { data: loanItems, error: loanItemsError } = await supabase
      .from("loan_items")
      .select("item_id, sheet_row, item_name, quantity")
      .eq("loan_request_id", loanId);

    if (loanItemsError) {
      return NextResponse.json(
        { error: mutationError("Failed to load loan items", loanItemsError) },
        { status: 500 },
      );
    }

    // Upload photo to Supabase Storage
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const fileName = `loan-${loanId}-${Date.now()}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from("return-photos")
      .upload(fileName, buffer, { contentType: "image/jpeg", upsert: false });

    if (uploadError)
      throw new Error(`Photo upload failed: ${uploadError.message}`);

    const photoBucket = supabase.storage.from("return-photos");
    const { data: urlData } = photoBucket.getPublicUrl(fileName);
    const photoUrl = urlData.publicUrl;

    startSyncIfNeeded();
    await waitForSync();
    const db = getDb();
    const isPermanentLoan = loan.loan_type === "permanent";
    let restoredInventory;

    try {
      restoredInventory = restoreReturnedLoanInventoryTx(
        db,
        loanItems || [],
        loanId,
        isPermanentLoan,
      );
    } catch (inventoryError) {
      await deleteStorageObjectBestEffort({
        bucket: photoBucket,
        path: fileName,
        warnings,
        context: "uploaded return photo",
      });
      return NextResponse.json(
        {
          error:
            inventoryError.message || "Failed to restore returned inventory",
          details: warnings,
        },
        { status: 500 },
      );
    }

    if (restoredInventory.sheetChanges.length > 0) {
      try {
        await syncAuthoritativeStockToSheets(db, restoredInventory.sheetChanges);
      } catch (sheetError) {
        rollbackReturnedLoanInventoryTx(
          db,
          loanItems || [],
          restoredInventory.deployedRows,
          isPermanentLoan,
        );
        await deleteStorageObjectBestEffort({
          bucket: photoBucket,
          path: fileName,
          warnings,
          context: "uploaded return photo",
        });
        return NextResponse.json(
          {
            error: sheetError.message || "Failed to sync returned inventory",
            details: warnings,
          },
          { status: 500 },
        );
      }
    }

    const { error: updateLoanError } = await supabase
      .from("loan_requests")
      .update({
        status: "returned",
        return_photo_url: photoUrl,
        return_remarks: remarks || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", loanId);

    if (updateLoanError) {
      rollbackReturnedLoanInventoryTx(
        db,
        loanItems || [],
        restoredInventory?.deployedRows || [],
        isPermanentLoan,
      );
      if (restoredInventory?.sheetChanges?.length) {
        try {
          await syncAuthoritativeStockToSheets(
            db,
            invertSheetChanges(restoredInventory.sheetChanges),
          );
        } catch (rollbackSheetError) {
          warnings.push(
            rollbackSheetError.message ||
              "Failed to revert sheet sync after return failure",
          );
        }
      }
      await deleteStorageObjectBestEffort({
        bucket: photoBucket,
        path: fileName,
        warnings,
        context: "uploaded return photo",
      });
      return NextResponse.json(
        {
          error: mutationError(
            "Failed to mark loan as returned",
            updateLoanError,
          ),
          details: warnings,
        },
        { status: 500 },
      );
    }

    // Log activity and fetch admins in parallel
    const [
      { data: loanUser, error: loanUserError },
      { data: admins, error: adminsError },
    ] = await Promise.all([
      supabase
        .from("users")
        .select("display_name, username")
        .eq("id", loan.user_id)
        .single(),
      supabase.from("users").select("id").eq("role", "admin"),
    ]);

    if (loanUserError && !isNotFoundError(loanUserError)) {
      warnings.push(
        mutationError("Failed to load requester profile", loanUserError),
      );
    }
    if (adminsError) {
      warnings.push(
        mutationError("Failed to load admin recipients", adminsError),
      );
    }

    const remarksLine = remarks ? `\nRemarks: ${remarks}` : "";

    await insertRowsBestEffort({
      client: supabase,
      table: "activity_feed",
      entries: [
        {
          user_id: user.id,
          action: "return",
          description: `${loanUser?.display_name || "A user"} returned loan #${loanId}.${remarksLine}`,
        },
      ],
      warnings,
      context: "return activity",
    });

    if (admins && admins.length > 0) {
      await insertRowsBestEffort({
        client: supabase,
        table: "notifications",
        entries: admins.map((admin) => ({
          user_id: admin.id,
          message: `${loanUser?.display_name || "A user"} returned loan #${loanId}.${remarksLine} Tap to view proof photo.`,
          link: photoUrl,
        })),
        warnings,
        context: "admin return",
      });

      const safeDisplayName = escapeHtml(loanUser?.display_name || "A user");
      const safeRemarks = remarks ? escapeHtml(remarks) : "";
      const safePhotoLink = isSafeHttpsUrl(photoUrl)
        ? `<a href="${escapeHtml(photoUrl)}">View Proof Photo</a>`
        : "Proof photo uploaded";
      for (const admin of admins) {
        sendTelegramMessage(
          admin.id,
          `📥 <b>Item Returned</b>\n${safeDisplayName} returned loan #${loanId}.${safeRemarks ? `\n⚠️ <b>Remarks:</b> ${safeRemarks}` : ""}\n${safePhotoLink}`,
        ).catch((err) =>
          console.error("return admin telegram failed:", err?.message || err),
        );
      }
    }

    // In-app + Telegram + email return receipt to borrower
    await insertRowsBestEffort({
      client: supabase,
      table: "notifications",
      entries: [
        {
          user_id: loan.user_id,
          message: `Your return for loan #${loanId} has been received and recorded.`,
          link: "/loans",
        },
      ],
      warnings,
      context: "user return receipt",
    });

    const userSafeRemarks = remarks ? escapeHtml(remarks) : "";
    const userSafePhotoLink = isSafeHttpsUrl(photoUrl)
      ? `<a href="${escapeHtml(photoUrl)}">View Your Return Photo</a>`
      : "Your return photo has been uploaded";
    sendTelegramMessage(
      loan.user_id,
      `✅ <b>Return Received!</b>\nYour return for loan #${loanId} has been recorded.${userSafeRemarks ? `\n⚠️ <b>Remarks:</b> ${userSafeRemarks}` : ""}\n📸 ${userSafePhotoLink}`,
    ).catch((err) =>
      console.error("return user telegram failed:", err?.message || err),
    );

    if (loanUser) {
      const { data: loanUserFull } = await supabase
        .from("users")
        .select("email, mute_emails")
        .eq("id", loan.user_id)
        .single();
      if (loanUserFull?.email && !loanUserFull?.mute_emails) {
        sendLoanReturnEmail({
          to: loanUserFull.email,
          displayName: loanUser.display_name,
          loanId,
          items: (loanItems || []).map((item) => ({
            item: item.item_name,
            quantity: item.quantity,
          })),
          photoUrl,
          adminReturn: false,
        }).catch((err) => console.error("loan return notification send failed:", err?.message || err));
      }
    }

    invalidateAll();

    return NextResponse.json(
      withWarnings(
        { message: "Items returned successfully!", photo_url: photoUrl },
        warnings,
      ),
    );
  } catch (error) {
    console.error("Return loan error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}
