import { getDb, startSyncIfNeeded, waitForSync } from "@/lib/db/db";
import { supabase } from "@/lib/db/supabase";
import { syncAuthoritativeStockToSheets } from "@/lib/services/inventorySheetSync";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { invalidateAll } from "@/lib/utils/cache";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request) {
  try {
    const { loan_id, imageBase64, remarks } = await request.json();

    if (!loan_id) {
      return NextResponse.json({ error: "Missing loan_id" }, { status: 400 });
    }

    if (!imageBase64) {
      return NextResponse.json({ error: "Photo is required to return items" }, { status: 400 });
    }

    // Parse guest loan id (e.g. g_12 -> 12)
    const db_id = String(loan_id).startsWith("g_") ? loan_id.slice(2) : loan_id;

    // Verify the guest request exists and is approved
    const { data: requestRow, error: fetchError } = await supabase
      .from("guest_borrow_requests")
      .select("*")
      .eq("id", db_id)
      .single();

    if (fetchError || !requestRow) {
      return NextResponse.json(
        { error: "Guest loan request not found" },
        { status: 404 }
      );
    }

    if (requestRow.status !== "approved") {
      return NextResponse.json(
        { error: "Only approved loans can be returned" },
        { status: 400 }
      );
    }

    // Upload photo to Supabase Storage
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");
    const fileName = `guest-loan-${db_id}-${Date.now()}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from("return-photos")
      .upload(fileName, buffer, { contentType: "image/jpeg", upsert: false });

    if (uploadError) {
      throw new Error(`Photo upload failed: ${uploadError.message}`);
    }

    const photoBucket = supabase.storage.from("return-photos");
    const { data: urlData } = photoBucket.getPublicUrl(fileName);
    const photoUrl = urlData.publicUrl;

    // Update status to returned and save the photo
    const { error: updateError } = await supabase
      .from("guest_borrow_requests")
      .update({
        status: "returned",
        return_photo_url: photoUrl,
        admin_notes: remarks ? (requestRow.admin_notes ? requestRow.admin_notes + `\n\nGuest Return Remarks: ${remarks}` : `Guest Return Remarks: ${remarks}`) : requestRow.admin_notes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", db_id);

    if (updateError) {
      console.error("Guest return failed:", updateError);
      return NextResponse.json(
        { error: "Failed to mark as returned" },
        { status: 500 }
      );
    }

    // Restore stock in SQLite and sync to Google Sheets
    try {
      startSyncIfNeeded();
      await waitForSync();
      const db = getDb();
      const techItems = (requestRow.items || []).filter(
        (i) => i.source === "tech" || !i.source,
      );
      const returnChanges = [];

      for (const li of techItems) {
        if (!li.sheet_row && !li.item_id) continue;
        const si = li.sheet_row
          ? db
              .prepare(
                "SELECT id, sheet_row FROM storage_items WHERE sheet_row = ?",
              )
              .get(li.sheet_row)
          : db
              .prepare("SELECT id, sheet_row FROM storage_items WHERE id = ?")
              .get(li.item_id);

        if (si) {
          db.prepare(
            "UPDATE storage_items SET current = current + ? WHERE id = ?",
          ).run(li.quantity, si.id);
          returnChanges.push({ sheetRow: si.sheet_row, delta: li.quantity });
        }
      }

      if (returnChanges.length > 0) {
        await syncAuthoritativeStockToSheets(db, returnChanges);
      }

      invalidateAll();
    } catch (stockErr) {
      console.error("Guest return: failed to restore stock:", stockErr);
    }

    // Notify admins via Telegram
    try {
      const itemSummary = Array.isArray(requestRow.items)
        ? requestRow.items.map((i) => `${i.quantity}x ${i.item_name}`).join(", ")
        : "Unknown";
      const tgMessage =
        `🔄 <b>Guest Return Submitted</b>\n\n` +
        `<b>Name:</b> ${requestRow.guest_name}\n` +
        `<b>Contact:</b> ${requestRow.telegram_handle || "—"}\n` +
        `<b>Items:</b> ${itemSummary}\n` +
        (remarks ? `<b>Remarks:</b> ${remarks}\n\n` : "\n") +
        `📷 <a href="${photoUrl}">View Return Photo</a>`;

      const { data: admins } = await supabase
        .from("users")
        .select("id")
        .eq("role", "admin");

      for (const admin of admins || []) {
        sendTelegramMessage(admin.id, tgMessage).catch(() => {});
      }
    } catch (err) {
      console.error("Failed to send guest return telegram:", err);
    }

    return NextResponse.json({ success: true, message: "Returned successfully", photo_url: photoUrl });
  } catch (error) {
    console.error("Guest return error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
