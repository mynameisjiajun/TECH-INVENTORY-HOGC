import { getDb, waitForSync } from "@/lib/db/db";
import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { invalidateAll } from "@/lib/utils/cache";
import { applyDeltasToCells, appendRows } from "@/lib/services/sheets";
import {
  sendOverdueEmail,
  sendDueSoonEmail,
  sendLoanStatusEmail,
} from "@/lib/services/email";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { NextResponse } from "next/server";

const SHEETS_ENABLED = !!(
  process.env.GOOGLE_SHEETS_ID &&
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  process.env.GOOGLE_PRIVATE_KEY
);
const CURRENT_COL = "G";

/**
 * Apply stock quantity deltas to the Google Sheets "Storage Spare" tab.
 * Uses sheet_row (stable) instead of item_id (may change on cold start).
 * @param {Array<{sheetRow: number, delta: number}>} changes
 */
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

/**
 * Append newly deployed items to the DEPLOYED sheet.
 */
async function syncDeployedToSheets(deployedRows) {
  if (!SHEETS_ENABLED || deployedRows.length === 0) return;
  try {
    const sheetRows = deployedRows.map((r) => [
      "", r.item, r.type, r.brand, r.model,
      r.quantity, r.location, r.allocation, r.status, r.remarks,
    ]);
    await appendRows("DEPLOYED", sheetRows);
  } catch (err) {
    console.error("Google Sheets deployed write-back failed:", err.message);
  }
}

// POST: approve, reject, return, or bulk_return a loan
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { action } = body;

    // SQLite still needed for inventory (storage_items, deployed_items)
    const db = getDb();

    // ===== BULK RETURN =====
    if (action === "bulk_return") {
      const { loan_ids, admin_notes } = body;
      if (!loan_ids || !Array.isArray(loan_ids) || loan_ids.length === 0) {
        return NextResponse.json({ error: "No loans selected" }, { status: 400 });
      }

      // Batch fetch all approved loans in one query
      const { data: approvedLoans } = await supabase
        .from("loan_requests")
        .select("*")
        .in("id", loan_ids)
        .eq("status", "approved");

      if (!approvedLoans || approvedLoans.length === 0) {
        return NextResponse.json({ error: "No approved loans found in selection" }, { status: 400 });
      }

      const validLoanIds = approvedLoans.map((l) => l.id);

      // Batch fetch all loan items
      const { data: allBulkItems } = await supabase
        .from("loan_items")
        .select("*")
        .in("loan_request_id", validLoanIds);

      const itemsByLoan = new Map();
      for (const item of allBulkItems || []) {
        if (!itemsByLoan.has(item.loan_request_id)) itemsByLoan.set(item.loan_request_id, []);
        itemsByLoan.get(item.loan_request_id).push(item);
      }

      // Apply SQLite stock changes (synchronous, single-threaded)
      const sheetChangesMap = new Map();
      for (const loan of approvedLoans) {
        for (const li of itemsByLoan.get(loan.id) || []) {
          if (li.sheet_row) {
            const si = db.prepare("SELECT id FROM storage_items WHERE sheet_row = ?").get(li.sheet_row);
            if (si) {
              db.prepare("UPDATE storage_items SET current = current + ? WHERE id = ?").run(li.quantity, si.id);
            }
            sheetChangesMap.set(li.sheet_row, (sheetChangesMap.get(li.sheet_row) || 0) + li.quantity);
          }
        }
      }

      // Batch update loan statuses
      await supabase
        .from("loan_requests")
        .update({ status: "returned", admin_notes: admin_notes || "Bulk return", updated_at: new Date().toISOString() })
        .in("id", validLoanIds);

      // Batch insert in-app notifications
      await supabase.from("notifications").insert(
        approvedLoans.map((loan) => ({
          user_id: loan.user_id,
          message: "Your loaned items have been marked as returned.",
          link: "/loans",
        }))
      );

      // Batch insert audit logs
      await supabase.from("audit_log").insert(
        approvedLoans.map((loan) => ({
          user_id: user.id,
          action: "bulk_return",
          target_type: "loan",
          target_id: loan.id,
          details: `Returned via bulk action. ${admin_notes || ""}`,
        }))
      );

      const sheetChanges = [...sheetChangesMap.entries()].map(([sheetRow, delta]) => ({ sheetRow, delta }));
      await syncStockToSheets(sheetChanges);

      // Fire-and-forget Telegram notifications
      for (const loan of approvedLoans) {
        sendTelegramMessage(
          loan.user_id,
          `🔄 <b>Loan Returned</b>\nYour loaned items for request #${loan.id} have been marked as returned.`,
        ).catch(() => {});
      }

      invalidateAll();
      return NextResponse.json({ message: `${approvedLoans.length} loan(s) returned to stock` });
    }

    // ===== BULK APPROVE =====
    if (action === "bulk_approve") {
      const { loan_ids } = body;
      if (!loan_ids || !Array.isArray(loan_ids) || loan_ids.length === 0) {
        return NextResponse.json({ error: "No loans selected" }, { status: 400 });
      }

      // Batch fetch all pending loans
      const { data: pendingLoans } = await supabase
        .from("loan_requests")
        .select("*")
        .in("id", loan_ids)
        .eq("status", "pending");

      if (!pendingLoans || pendingLoans.length === 0) {
        return NextResponse.json({ error: "No pending loans found in selection" }, { status: 400 });
      }

      const validLoanIds = pendingLoans.map((l) => l.id);

      // Batch fetch all loan items
      const { data: allApproveItems } = await supabase
        .from("loan_items")
        .select("*")
        .in("loan_request_id", validLoanIds);

      const itemsByLoan = new Map();
      for (const item of allApproveItems || []) {
        if (!itemsByLoan.has(item.loan_request_id)) itemsByLoan.set(item.loan_request_id, []);
        itemsByLoan.get(item.loan_request_id).push(item);
      }

      // Validate stock and apply deductions
      const sheetChangesMap = new Map();
      const deployedRows = [];
      for (const loan of pendingLoans) {
        for (const li of itemsByLoan.get(loan.id) || []) {
          const si = li.sheet_row
            ? db.prepare("SELECT * FROM storage_items WHERE sheet_row = ?").get(li.sheet_row)
            : db.prepare("SELECT * FROM storage_items WHERE id = ?").get(li.item_id);

          if (!si) throw new Error(`Item not found: ${li.item_name}`);
          if (si.current < li.quantity) {
            throw new Error(`Not enough stock for "${si.item}" (loan #${loan.id}). Available: ${si.current}`);
          }

          const result = db
            .prepare("UPDATE storage_items SET current = current - ? WHERE id = ? AND current >= ?")
            .run(li.quantity, si.id, li.quantity);
          if (result.changes === 0) throw new Error(`Stock conflict for "${si.item}" — please retry`);

          sheetChangesMap.set(li.sheet_row, (sheetChangesMap.get(li.sheet_row) || 0) - li.quantity);

          if (loan.loan_type === "permanent") {
            const deployedRow = {
              item: si.item, type: si.type, brand: si.brand, model: si.model,
              quantity: li.quantity,
              location: loan.location || si.location,
              allocation: loan.department || loan.purpose,
              status: "DEPLOYED",
              remarks: `Perm loan #${loan.id} — ${loan.purpose}`,
            };
            db.prepare(
              `INSERT INTO deployed_items (item, type, brand, model, quantity, location, allocation, status, remarks)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).run(
              deployedRow.item, deployedRow.type, deployedRow.brand, deployedRow.model,
              deployedRow.quantity, deployedRow.location, deployedRow.allocation,
              deployedRow.status, deployedRow.remarks,
            );
            deployedRows.push(deployedRow);
          }
        }
      }

      // Batch update loan statuses
      await supabase
        .from("loan_requests")
        .update({ status: "approved", admin_notes: "Bulk approved", updated_at: new Date().toISOString() })
        .in("id", validLoanIds);

      // Batch insert notifications
      await supabase.from("notifications").insert(
        pendingLoans.map((loan) => ({
          user_id: loan.user_id,
          message: `Your ${loan.loan_type} loan request #${loan.id} has been approved!`,
          link: "/loans",
        }))
      );

      // Batch insert audit logs
      await supabase.from("audit_log").insert(
        pendingLoans.map((loan) => ({
          user_id: user.id,
          action: "bulk_approve",
          target_type: "loan",
          target_id: loan.id,
          details: `Approved via bulk action.`,
        }))
      );

      const sheetChanges = [...sheetChangesMap.entries()].map(([sheetRow, delta]) => ({ sheetRow, delta }));
      await syncStockToSheets(sheetChanges);
      if (deployedRows.length > 0) await syncDeployedToSheets(deployedRows);

      // Fire-and-forget Telegram notifications
      for (const loan of pendingLoans) {
        sendTelegramMessage(
          loan.user_id,
          `✅ <b>Loan Approved</b>\nYour ${loan.loan_type} loan request #${loan.id} has been approved!`,
        ).catch(() => {});
      }

      invalidateAll();
      return NextResponse.json({ message: `${pendingLoans.length} loan(s) approved` });
    }

    if (action === "clear_activity") {
      await supabase.from("activity_feed").delete().neq("id", 0);
      return NextResponse.json({ message: "Activity log cleared" });
    }

    // ===== SINGLE LOAN ACTIONS =====
    const { loan_id, admin_notes } = body;
    const { data: loan } = await supabase
      .from("loan_requests")
      .select("*")
      .eq("id", loan_id)
      .single();

    if (!loan) {
      return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    }

    if (action === "approve") {
      if (loan.status !== "pending") {
        return NextResponse.json({ error: "Loan already processed" }, { status: 400 });
      }

      const { data: loanItems } = await supabase
        .from("loan_items")
        .select("*")
        .eq("loan_request_id", loan_id);

      const approveChanges = []; // { sheetRow, delta }
      const deployedRows = [];

      // Validate + deduct stock in SQLite using sheet_row
      for (const li of loanItems || []) {
        const si = li.sheet_row
          ? db.prepare("SELECT * FROM storage_items WHERE sheet_row = ?").get(li.sheet_row)
          : db.prepare("SELECT * FROM storage_items WHERE id = ?").get(li.item_id);

        if (!si) throw new Error(`Item not found in inventory: ${li.item_name}`);
        if (si.current < li.quantity) {
          throw new Error(`Not enough stock for "${si.item}". Available: ${si.current}`);
        }

        const result = db
          .prepare("UPDATE storage_items SET current = current - ? WHERE id = ? AND current >= ?")
          .run(li.quantity, si.id, li.quantity);
        if (result.changes === 0) throw new Error("Stock changed during approval — please try again");

        approveChanges.push({ sheetRow: si.sheet_row, delta: -li.quantity });

        // For permanent loans, add to deployed_items in SQLite
        if (loan.loan_type === "permanent") {
          const deployedRow = {
            item: si.item, type: si.type, brand: si.brand, model: si.model,
            quantity: li.quantity,
            location: loan.location || si.location,
            allocation: loan.department || loan.purpose,
            status: "DEPLOYED",
            remarks: `Perm loan #${loan_id} — ${loan.purpose}`,
          };
          db.prepare(`
            INSERT INTO deployed_items (item, type, brand, model, quantity, location, allocation, status, remarks)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            deployedRow.item, deployedRow.type, deployedRow.brand, deployedRow.model,
            deployedRow.quantity, deployedRow.location, deployedRow.allocation,
            deployedRow.status, deployedRow.remarks,
          );
          deployedRows.push(deployedRow);
        }
      }

      // Update loan in Supabase
      await supabase
        .from("loan_requests")
        .update({ status: "approved", admin_notes: admin_notes || "", updated_at: new Date().toISOString() })
        .eq("id", loan_id);

      await supabase.from("notifications").insert({
        user_id: loan.user_id,
        message: `Your ${loan.loan_type} loan request has been approved!`,
        link: "/loans",
      });

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "approve",
        target_type: "loan",
        target_id: loan_id,
        details: `Approved ${loan.loan_type} loan. ${admin_notes || ""}`,
      });

      // Sync to Google Sheets
      await syncStockToSheets(approveChanges);
      if (deployedRows.length > 0) await syncDeployedToSheets(deployedRows);

      // Notifications
      const { data: loanUser } = await supabase.from("users").select("email, display_name, telegram_chat_id, mute_emails, mute_telegram").eq("id", loan.user_id).single();
      const backgroundTasks = [];
      if (loanUser?.email && !loanUser?.mute_emails) {
        backgroundTasks.push(
          sendLoanStatusEmail({
            to: loanUser.email,
            displayName: loanUser.display_name,
            loanId: loan_id,
            status: "approved",
            adminNotes: admin_notes,
            items: (loanItems || []).map((i) => ({ item: i.item_name, quantity: i.quantity })),
          }).catch(() => {}),
        );
      }
      if (!loanUser?.mute_telegram) {
        backgroundTasks.push(
          sendTelegramMessage(
            loan.user_id,
            `✅ <b>Loan Approved</b>\nYour ${loan.loan_type} loan request #${loan_id} has been approved!${admin_notes ? `\n\nAdmin notes: ${admin_notes}` : ""}`,
          ),
        );
      }
      await Promise.all(backgroundTasks);

      invalidateAll();
      await supabase.from("activity_feed").insert({
        user_id: user.id,
        action: "approve",
        description: `Approved ${loan.loan_type} loan #${loan_id} for ${loanUser?.display_name || "user"}`,
        link: "/admin",
      });

      return NextResponse.json({ message: "Loan approved" });
    }

    if (action === "reject") {
      if (loan.status !== "pending") {
        return NextResponse.json({ error: "Loan already processed" }, { status: 400 });
      }

      await supabase
        .from("loan_requests")
        .update({ status: "rejected", admin_notes: admin_notes || "", updated_at: new Date().toISOString() })
        .eq("id", loan_id);

      await supabase.from("notifications").insert({
        user_id: loan.user_id,
        message: `Your ${loan.loan_type} loan request has been rejected. ${admin_notes || ""}`,
        link: "/loans",
      });

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "reject",
        target_type: "loan",
        target_id: loan_id,
        details: `Rejected ${loan.loan_type} loan. ${admin_notes || ""}`,
      });

      const { data: rejectUser } = await supabase.from("users").select("email, display_name, telegram_chat_id, mute_emails, mute_telegram").eq("id", loan.user_id).single();
      const { data: rejectItems } = await supabase.from("loan_items").select("item_name, quantity").eq("loan_request_id", loan_id);
      const rejectTasks = [];
      if (rejectUser?.email && !rejectUser?.mute_emails) {
        rejectTasks.push(
          sendLoanStatusEmail({
            to: rejectUser.email,
            displayName: rejectUser.display_name,
            loanId: loan_id,
            status: "rejected",
            adminNotes: admin_notes,
            items: (rejectItems || []).map((i) => ({ item: i.item_name, quantity: i.quantity })),
          }).catch(() => {}),
        );
      }
      if (!rejectUser?.mute_telegram) {
        rejectTasks.push(
          sendTelegramMessage(
            loan.user_id,
            `❌ <b>Loan Rejected</b>\nYour ${loan.loan_type} loan request #${loan_id} has been rejected.${admin_notes ? `\n\nAdmin notes: ${admin_notes}` : ""}`,
          ),
        );
      }
      await Promise.all(rejectTasks);

      invalidateAll();
      await supabase.from("activity_feed").insert({
        user_id: user.id,
        action: "reject",
        description: `Rejected loan #${loan_id} from ${rejectUser?.display_name || "user"}`,
        link: "/admin",
      });

      return NextResponse.json({ message: "Loan rejected" });
    }

    if (action === "return") {
      if (loan.status !== "approved") {
        return NextResponse.json({ error: "Only approved loans can be returned" }, { status: 400 });
      }

      const [{ data: loanItems }, { data: returnUser }] = await Promise.all([
        supabase.from("loan_items").select("*").eq("loan_request_id", loan_id),
        supabase.from("users").select("display_name").eq("id", loan.user_id).single(),
      ]);

      const returnChanges = [];
      for (const li of loanItems || []) {
        const si = li.sheet_row
          ? db.prepare("SELECT id FROM storage_items WHERE sheet_row = ?").get(li.sheet_row)
          : db.prepare("SELECT id FROM storage_items WHERE id = ?").get(li.item_id);
        if (si) {
          db.prepare("UPDATE storage_items SET current = current + ? WHERE id = ?").run(li.quantity, si.id);
          returnChanges.push({ sheetRow: li.sheet_row, delta: li.quantity });
        }
      }

      await supabase
        .from("loan_requests")
        .update({ status: "returned", admin_notes: admin_notes || "Items returned", updated_at: new Date().toISOString() })
        .eq("id", loan_id);

      await supabase.from("notifications").insert({
        user_id: loan.user_id,
        message: "Your loaned items have been marked as returned.",
        link: "/loans",
      });

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "return",
        target_type: "loan",
        target_id: loan_id,
        details: `Items returned to stock. ${admin_notes || ""}`,
      });

      await syncStockToSheets(returnChanges);
      sendTelegramMessage(
        loan.user_id,
        `🔄 <b>Loan Returned</b>\nYour loaned items for request #${loan_id} have been marked as returned and restored to inventory.`,
      ).catch(() => {});

      invalidateAll();
      await supabase.from("activity_feed").insert({
        user_id: user.id,
        action: "return",
        description: `Returned items from loan #${loan_id} (${returnUser?.display_name || "user"})`,
        link: "/admin",
      });

      return NextResponse.json({ message: "Items returned to stock" });
    }

    if (action === "delete") {
      const { data: loanItems } = await supabase
        .from("loan_items")
        .select("*")
        .eq("loan_request_id", loan_id);

      const restoreChanges = [];

      // If approved, restore stock in SQLite
      if (loan.status === "approved") {
        for (const li of loanItems || []) {
          const si = li.sheet_row
            ? db.prepare("SELECT id FROM storage_items WHERE sheet_row = ?").get(li.sheet_row)
            : db.prepare("SELECT id FROM storage_items WHERE id = ?").get(li.item_id);
          if (si) {
            db.prepare("UPDATE storage_items SET current = current + ? WHERE id = ?").run(li.quantity, si.id);
            restoreChanges.push({ sheetRow: li.sheet_row, delta: li.quantity });
          }
        }
      }

      await supabase.from("audit_log").insert({
        user_id: user.id,
        action: "delete",
        target_type: "loan",
        target_id: loan_id,
        details: `Deleted ${loan.loan_type} loan (was ${loan.status}). ${admin_notes || ""}`,
      });

      // Notify the user their loan was deleted (only for non-rejected/non-returned)
      if (loan.status === "pending" || loan.status === "approved") {
        await supabase.from("notifications").insert({
          user_id: loan.user_id,
          message: `Your ${loan.loan_type} loan request #${loan_id} has been removed by an admin.${admin_notes ? ` Note: ${admin_notes}` : ""}`,
          link: "/loans",
        });
      }

      // ON DELETE CASCADE removes loan_items automatically
      await supabase.from("loan_requests").delete().eq("id", loan_id);

      if (restoreChanges.length > 0) await syncStockToSheets(restoreChanges);
      invalidateAll();

      return NextResponse.json({ message: "Loan deleted" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Admin action error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}

// GET: dashboard stats + active loans + due date warnings
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  await waitForSync();
  const db = getDb();

  // Inventory stats from SQLite
  const totalItems = db.prepare("SELECT SUM(quantity_spare) as total FROM storage_items").get().total || 0;
  const totalCurrent = db.prepare("SELECT SUM(current) as total FROM storage_items").get().total || 0;
  const deployedItems = db.prepare("SELECT SUM(quantity) as total FROM deployed_items").get().total || 0;
  const lowStock = db.prepare("SELECT COUNT(*) as count FROM storage_items WHERE current <= 2 AND quantity_spare > 0").get().count;

  // Loan stats from Supabase (authoritative — not derived from ephemeral SQLite)
  const { count: pendingRequests } = await supabase
    .from("loan_requests")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending");

  // totalLoaned calculated later from approved loan_items (accurate across cold starts)
  const stats = {
    totalItems,
    totalCurrent,
    totalLoaned: 0, // placeholder — filled in below after loan items are fetched
    pendingRequests: pendingRequests || 0,
    lowStock,
    deployedItems,
  };

  // Active loans from Supabase
  const { data: activeLoans } = await supabase
    .from("loan_requests")
    .select(`*, users (display_name, username)`)
    .in("status", ["approved", "pending"])
    .order("start_date", { ascending: true });

  const formattedLoans = (activeLoans || []).map((lr) => ({
    ...lr,
    requester_name: lr.users?.display_name || null,
    requester_username: lr.users?.username || null,
    users: undefined,
    items: [],
  }));

  if (formattedLoans.length > 0) {
    const loanIds = formattedLoans.map((l) => l.id);
    const { data: allItems } = await supabase
      .from("loan_items")
      .select("loan_request_id, item_name, quantity")
      .in("loan_request_id", loanIds);

    const itemsByLoan = new Map();
    for (const item of allItems || []) {
      if (!itemsByLoan.has(item.loan_request_id)) itemsByLoan.set(item.loan_request_id, []);
      itemsByLoan.get(item.loan_request_id).push({ ...item, item: item.item_name });
    }
    for (const loan of formattedLoans) loan.items = itemsByLoan.get(loan.id) || [];

    // Compute totalLoaned in O(N + M): sum pre-mapped items from approved loans only.
    stats.totalLoaned = formattedLoans.reduce((sum, loan) => {
      if (loan.status !== "approved") return sum;
      const loanQty = loan.items.reduce((itemSum, item) => itemSum + item.quantity, 0);
      return sum + loanQty;
    }, 0);
  }

  // Due date warnings
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toLocaleDateString("en-CA");
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toLocaleDateString("en-CA");

  const [{ data: overdueLoans }, { data: dueSoonLoans }] = await Promise.all([
    supabase.from("loan_requests").select(`id, end_date, user_id, users (display_name)`)
      .eq("status", "approved").eq("loan_type", "temporary").not("end_date", "is", null).lt("end_date", today),
    supabase.from("loan_requests").select(`id, end_date, user_id, users (display_name)`)
      .eq("status", "approved").eq("loan_type", "temporary").eq("end_date", tomorrow),
  ]);

  // Overdue/due-soon reminders (admin-triggered, deduped, parallelized)
  const adminReminderTasks = [];
  await Promise.all([
    ...(overdueLoans || []).map(async (loan) => {
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", loan.user_id)
        .ilike("message", "%overdue%")
        .ilike("message", `%#${loan.id}%`)
        .gte("created_at", today)
        .single();

      if (!existing) {
        const [{ data: loanItems }, { data: loanUser }] = await Promise.all([
          supabase.from("loan_items").select("item_name, quantity").eq("loan_request_id", loan.id),
          supabase.from("users").select("email, display_name").eq("id", loan.user_id).single(),
        ]);
        const itemList = (loanItems || []).map((i) => `${i.item_name} × ${i.quantity}`).join(", ");

        await supabase.from("notifications").insert({
          user_id: loan.user_id,
          message: `⚠️ Your loan #${loan.id} is OVERDUE! Please return items or contact an admin.\n\nItems: ${itemList}`,
          link: "/loans",
        });

        if (loanUser?.email) {
          adminReminderTasks.push(
            sendOverdueEmail({
              to: loanUser.email,
              displayName: loanUser.display_name,
              loanId: loan.id,
              items: (loanItems || []).map((i) => ({ item: i.item_name, quantity: i.quantity })),
              endDate: loan.end_date,
            }).catch(() => {}),
          );
        }
      }
    }),
    ...(dueSoonLoans || []).map(async (loan) => {
      const { data: existing } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", loan.user_id)
        .ilike("message", "%due tomorrow%")
        .ilike("message", `%#${loan.id}%`)
        .gte("created_at", today)
        .single();

      if (!existing) {
        const [{ data: loanItems }, { data: loanUser }] = await Promise.all([
          supabase.from("loan_items").select("item_name, quantity").eq("loan_request_id", loan.id),
          supabase.from("users").select("email, display_name").eq("id", loan.user_id).single(),
        ]);
        const itemList = (loanItems || []).map((i) => `${i.item_name} × ${i.quantity}`).join(", ");

        await supabase.from("notifications").insert({
          user_id: loan.user_id,
          message: `⏰ Your loan #${loan.id} is due tomorrow! Please prepare to return items.\n\nItems: ${itemList}`,
          link: "/loans",
        });

        if (loanUser?.email) {
          adminReminderTasks.push(
            sendDueSoonEmail({
              to: loanUser.email,
              displayName: loanUser.display_name,
              loanId: loan.id,
              items: (loanItems || []).map((i) => ({ item: i.item_name, quantity: i.quantity })),
              endDate: loan.end_date,
            }).catch(() => {}),
          );
        }
      }
    }),
  ]);
  if (adminReminderTasks.length > 0) await Promise.all(adminReminderTasks);

  // Chart data
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recentLoansRaw } = await supabase
    .from("loan_requests")
    .select("created_at")
    .gte("created_at", thirtyDaysAgo);

  // Group by day
  const dayMap = new Map();
  for (const lr of recentLoansRaw || []) {
    const day = lr.created_at.split("T")[0];
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
  }
  const loansTrend = [...dayMap.entries()].sort().map(([day, count]) => ({
    date: new Date(day).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    loans: count,
  }));

  // Top 5 borrowed items from Supabase loan_items (using item_name)
  const { data: allLoanItems } = await supabase.from("loan_items").select("item_name, quantity");
  const itemTotals = new Map();
  for (const li of allLoanItems || []) {
    itemTotals.set(li.item_name, (itemTotals.get(li.item_name) || 0) + li.quantity);
  }
  const topItems = [...itemTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, value]) => ({ name, value }));

  const inventoryDistribution = [
    { name: "Available Storage", value: stats.totalCurrent },
    { name: "Currently Loaned", value: stats.totalLoaned },
    { name: "Perm Deployed", value: stats.deployedItems },
  ].filter((d) => d.value > 0);

  // Recent activity from Supabase
  const { data: recentActivityRaw } = await supabase
    .from("activity_feed")
    .select(`*, users (display_name)`)
    .order("created_at", { ascending: false })
    .limit(20);

  const recentActivity = (recentActivityRaw || []).map((af) => ({
    ...af,
    display_name: af.users?.display_name || null,
    users: undefined,
  }));

  return NextResponse.json({
    stats,
    activeLoans: formattedLoans,
    overdueCount: (overdueLoans || []).length,
    dueSoonCount: (dueSoonLoans || []).length,
    charts: { loansTrend, topItems, inventoryDistribution },
    recentActivity,
  }, {
    headers: { "Cache-Control": "private, s-maxage=30, stale-while-revalidate=60" },
  });
}
