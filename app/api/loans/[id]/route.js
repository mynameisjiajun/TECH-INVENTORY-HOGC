import { getDb, waitForSync } from "@/lib/db/db";
import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { applyDeltasToCells } from "@/lib/services/sheets";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { NextResponse } from "next/server";

const SHEETS_ENABLED = !!(
  process.env.GOOGLE_SHEETS_ID &&
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  process.env.GOOGLE_PRIVATE_KEY
);
const CURRENT_COL = "G";

async function syncStockToSheets(changes) {
  if (!SHEETS_ENABLED || changes.length === 0) return;
  try {
    const sheetChanges = changes
      .filter((c) => c.sheetRow)
      .map((c) => ({ cell: `${CURRENT_COL}${c.sheetRow}`, delta: c.delta }));

    if (sheetChanges.length === 0) return;
    await applyDeltasToCells("Storage Spare", sheetChanges);
  } catch (err) {
    console.error("Google Sheets stock write-back failed:", err.message);
  }
}

// PUT: Modify an existing loan request
export async function PUT(request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { loan_type, purpose, department, start_date, end_date, location, items } = await request.json();
    const unawaitedParams = await params;
    const loanId = unawaitedParams.id;

    if (!loanId) return NextResponse.json({ error: "Loan ID required" }, { status: 400 });
    if (!items || items.length === 0) return NextResponse.json({ error: "No items selected" }, { status: 400 });

    for (const item of items) {
      if (!item.quantity || item.quantity < 1 || !Number.isInteger(item.quantity)) {
        return NextResponse.json({ error: "Each item must have a quantity of at least 1" }, { status: 400 });
      }
    }
    if (!purpose || !purpose.trim()) return NextResponse.json({ error: "Purpose is required" }, { status: 400 });
    if (!start_date) return NextResponse.json({ error: "Start date is required" }, { status: 400 });
    
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(start_date) || isNaN(Date.parse(start_date))) {
      return NextResponse.json({ error: "Invalid start date format" }, { status: 400 });
    }
    if (loan_type === "temporary" && !end_date) {
      return NextResponse.json({ error: "End date is required for temporary loans" }, { status: 400 });
    }
    if (end_date && (!dateRegex.test(end_date) || isNaN(Date.parse(end_date)))) {
      return NextResponse.json({ error: "Invalid end date format" }, { status: 400 });
    }
    if (end_date && start_date && end_date < start_date) {
      return NextResponse.json({ error: "End date cannot be before start date" }, { status: 400 });
    }

    // Fetch existing loan
    const { data: existingLoan } = await supabase
      .from("loan_requests")
      .select("*")
      .eq("id", loanId)
      .single();

    if (!existingLoan) return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    if (Number(existingLoan.user_id) !== Number(user.id) && user.role !== "admin") {
      return NextResponse.json({ error: "Unauthorized to modify this loan" }, { status: 403 });
    }
    if (existingLoan.status === "returned" || existingLoan.status === "rejected") {
      return NextResponse.json({ error: "Cannot modify a returned or rejected loan" }, { status: 400 });
    }

    const { data: oldItems } = await supabase
      .from("loan_items")
      .select("*")
      .eq("loan_request_id", loanId);

    await waitForSync();
    const db = getDb();

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
      const storageItem = db.prepare("SELECT * FROM storage_items WHERE id = ?").get(item.item_id);
      if (!storageItem) {
        return NextResponse.json({ error: `Item not found: ${item.item_id}` }, { status: 400 });
      }

      // Effective available stock = current stock + any stock that would be refunded from this loan
      const refundedQty = refundMap.get(item.item_id) || 0;
      const effectiveAvailable = storageItem.current + refundedQty;

      if (effectiveAvailable < item.quantity) {
        return NextResponse.json(
          { error: `Not enough stock for "${storageItem.item}". Available: ${effectiveAvailable}, Requested: ${item.quantity}` },
          { status: 400 }
        );
      }

      resolvedItems.push({
        item_id: item.item_id,
        sheet_row: storageItem.sheet_row,
        item_name: storageItem.item,
        quantity: item.quantity,
      });
    }

    const restoreChanges = [];
    // If loan was approved, we must actually process the refunds since the loan will revert to pending.
    if (existingLoan.status === "approved") {
      for (const oldItem of oldItems || []) {
        const si = oldItem.sheet_row
          ? db.prepare("SELECT id FROM storage_items WHERE sheet_row = ?").get(oldItem.sheet_row)
          : db.prepare("SELECT id FROM storage_items WHERE id = ?").get(oldItem.item_id);
        
        if (si) {
          db.prepare("UPDATE storage_items SET current = current + ? WHERE id = ?").run(oldItem.quantity, si.id);
          restoreChanges.push({ sheetRow: oldItem.sheet_row, delta: oldItem.quantity });
        }
      }
      
      // If it was a permanent loan, remove the deployed items
      if (existingLoan.loan_type === "permanent") {
        db.prepare("DELETE FROM deployed_items WHERE remarks LIKE ?").run(`Perm loan #${loanId}%`);
      }
    }

    // Update loan record to 'pending'
    const { error: updateError } = await supabase
      .from("loan_requests")
      .update({
        loan_type,
        purpose: purpose.trim(),
        department: department || "",
        location: location || "",
        start_date,
        end_date: end_date || null,
        status: "pending",
        admin_notes: existingLoan.admin_notes ? `${existingLoan.admin_notes} (Modified by user)` : "Modified by user",
        updated_at: new Date().toISOString()
      })
      .eq("id", loanId);
    if (updateError) throw updateError;

    // Replace items
    const { error: deleteItemsError } = await supabase
      .from("loan_items")
      .delete()
      .eq("loan_request_id", loanId);
    if (deleteItemsError) throw deleteItemsError;

    const { error: insertItemsError } = await supabase.from("loan_items").insert(
      resolvedItems.map((i) => ({
        loan_request_id: loanId,
        item_id: i.item_id,
        sheet_row: i.sheet_row,
        item_name: i.item_name,
        quantity: i.quantity,
      }))
    );
    if (insertItemsError) throw insertItemsError;

    if (restoreChanges.length > 0) {
      await syncStockToSheets(restoreChanges);
    }

    // Notify admins
    const { data: admins } = await supabase.from("users").select("id, mute_telegram").eq("role", "admin");
    if (admins && admins.length > 0) {
      await supabase.from("notifications").insert(
        admins.map((admin) => ({
          user_id: admin.id,
          message: `${user.display_name} modified their ${loan_type} loan request #${loanId}.`,
          link: "/admin",
        }))
      );
      
      const itemListStr = resolvedItems.map((i) => `${i.item_name} × ${i.quantity}`).join(", ");
      for (const admin of admins) {
        if (!admin.mute_telegram) {
          sendTelegramMessage(
            admin.id,
            `📝 <b>Loan Modified</b>\n<b>${user.display_name}</b> modified loan request #${loanId} (now pending).\n\nNew Items: ${itemListStr}`
          ).catch(() => {});
        }
      }
    }

    // Log activity
    await supabase.from("activity_feed").insert({
      user_id: user.id,
      action: "modify",
      description: `Modified loan #${loanId}`,
      link: "/admin",
    });

    return NextResponse.json({ message: "Loan modified successfully and is now pending approval." });
  } catch (error) {
    console.error("Loan modification error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

// DELETE: Cancel own pending loan request
export async function DELETE(_request, { params }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const { data: loan } = await supabase
    .from("loan_requests")
    .select("id, user_id, status")
    .eq("id", id)
    .single();

  if (!loan) return NextResponse.json({ error: "Loan not found" }, { status: 404 });
  if (Number(loan.user_id) !== Number(user.id) && user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (loan.status !== "pending") {
    return NextResponse.json({ error: "Only pending loans can be cancelled" }, { status: 400 });
  }

  const { error: cancelItemsError } = await supabase.from("loan_items").delete().eq("loan_request_id", id);
  if (cancelItemsError) return NextResponse.json({ error: cancelItemsError.message || "Failed to cancel loan items" }, { status: 500 });

  const { error: cancelLoanError } = await supabase.from("loan_requests").delete().eq("id", id);
  if (cancelLoanError) return NextResponse.json({ error: cancelLoanError.message || "Failed to cancel loan" }, { status: 500 });

  await supabase.from("notifications").insert({
    user_id: user.id,
    message: `Your loan request #${id} has been cancelled.`,
    link: "/loans",
  });

  return NextResponse.json({ message: "Loan cancelled successfully." });
}
