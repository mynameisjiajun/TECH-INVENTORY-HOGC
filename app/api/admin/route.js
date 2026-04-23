import { getDb, startSyncIfNeeded, waitForSync } from "@/lib/db/db";
import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import { invalidateAll } from "@/lib/utils/cache";
import { appendRows } from "@/lib/services/sheets";
import { syncAuthoritativeStockToSheets } from "@/lib/services/inventorySheetSync";
import { sendLoanStatusEmail, sendLoanReturnEmail } from "@/lib/services/email";
import { sendAdminTelegramAlert } from "@/lib/services/adminTelegram";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { NextResponse } from "next/server";

const SHEETS_ENABLED = !!(
  process.env.GOOGLE_SHEETS_ID &&
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
  process.env.GOOGLE_PRIVATE_KEY
);
const ACTIVE_LOANS_DASHBOARD_LIMIT = 200;
const TECH_LOAN_ADMIN_FIELDS =
  "id, user_id, loan_type, purpose, remarks, department, location, start_date, end_date, status, admin_notes, created_at, updated_at";
const TECH_LOAN_ITEM_FIELDS =
  "id, loan_request_id, item_id, sheet_row, item_name, quantity";
const TECH_LOAN_LIST_SELECT = `${TECH_LOAN_ADMIN_FIELDS}, users (display_name, username, telegram_handle)`;

/**
 * Append newly deployed items to the DEPLOYED sheet.
 */
async function syncDeployedToSheets(deployedRows) {
  if (!SHEETS_ENABLED || deployedRows.length === 0) return;
  try {
    const sheetRows = deployedRows.map((r) => [
      "",
      r.item,
      r.type,
      r.brand,
      r.model,
      r.quantity,
      r.location,
      r.allocation,
      r.status,
      r.remarks,
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
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const { action } = body;

    const inventoryBackedActions = new Set([
      "approve",
      "bulk_approve",
      "bulk_return",
      "return",
      "delete",
    ]);

    let db = null;
    if (inventoryBackedActions.has(action)) {
      startSyncIfNeeded();
      // Warm the inventory snapshot before approval/return flows touch SQLite.
      // Without this, a cold start can make admin actions fail until someone
      // opens the inventory page and triggers the initial sheet sync.
      await waitForSync();
      db = getDb();
    }

    // ===== BULK RETURN =====
    if (action === "bulk_return") {
      const { loan_ids, admin_notes } = body;
      if (!loan_ids || !Array.isArray(loan_ids) || loan_ids.length === 0) {
        return NextResponse.json(
          { error: "No loans selected" },
          { status: 400 },
        );
      }

      // Intercept guest IDs
      const guestIds = loan_ids.filter((id) => typeof id === "string" && id.startsWith("g_"));
      const regularIds = loan_ids.filter((id) => !(typeof id === "string" && id.startsWith("g_")));

      for (const gid of guestIds) {
        await handleGuestAction({ db, action: "return", loan_id: Number.parseInt(gid.replace("g_", ""), 10), admin_notes, user });
      }

      if (regularIds.length === 0) {
        return NextResponse.json({ message: "Guest loans returned" });
      }

      // Batch fetch all approved loans in one query
      const { data: approvedLoans } = await supabase
        .from("loan_requests")
        .select("id, user_id")
        .in("id", regularIds)
        .eq("status", "approved");

      if (!approvedLoans || approvedLoans.length === 0) {
        return NextResponse.json(
          { error: "No approved loans found in selection" },
          { status: 400 },
        );
      }

      const validLoanIds = approvedLoans.map((l) => l.id);

      // Batch fetch all loan items
      const { data: allBulkItems } = await supabase
        .from("loan_items")
        .select("loan_request_id, sheet_row, quantity")
        .in("loan_request_id", validLoanIds);

      const itemsByLoan = new Map();
      for (const item of allBulkItems || []) {
        if (!itemsByLoan.has(item.loan_request_id))
          itemsByLoan.set(item.loan_request_id, []);
        itemsByLoan.get(item.loan_request_id).push(item);
      }

      // Apply SQLite stock changes (synchronous, single-threaded)
      const sheetChangesMap = new Map();
      for (const loan of approvedLoans) {
        for (const li of itemsByLoan.get(loan.id) || []) {
          if (li.sheet_row) {
            const si = db
              .prepare("SELECT id FROM storage_items WHERE sheet_row = ?")
              .get(li.sheet_row);
            if (si) {
              db.prepare(
                "UPDATE storage_items SET current = current + ? WHERE id = ?",
              ).run(li.quantity, si.id);
            }
            sheetChangesMap.set(
              li.sheet_row,
              (sheetChangesMap.get(li.sheet_row) || 0) + li.quantity,
            );
          }
        }
      }

      // Batch update loan statuses
      await supabase
        .from("loan_requests")
        .update({
          status: "returned",
          admin_notes: admin_notes || "Bulk return",
          updated_at: new Date().toISOString(),
        })
        .in("id", validLoanIds);

      // Batch insert in-app notifications
      await supabase.from("notifications").insert(
        approvedLoans.map((loan) => ({
          user_id: loan.user_id,
          message: "Your loaned items have been marked as returned.",
          link: "/loans",
        })),
      );

      // Batch insert audit logs
      await supabase.from("audit_log").insert(
        approvedLoans.map((loan) => ({
          user_id: user.id,
          action: "bulk_return",
          target_type: "loan",
          target_id: loan.id,
          details: `Returned via bulk action. ${admin_notes || ""}`,
        })),
      );

      const sheetChanges = [...sheetChangesMap.entries()].map(
        ([sheetRow, delta]) => ({ sheetRow, delta }),
      );
      await syncAuthoritativeStockToSheets(db, sheetChanges);

      // Fire-and-forget Telegram notifications
      for (const loan of approvedLoans) {
        sendTelegramMessage(
          loan.user_id,
          `🔄 <b>Loan Returned</b>\nYour loaned items for request #${loan.id} have been marked as returned.`,
        ).catch((err) => console.error("Telegram notification failed:", err.message));
      }

      sendAdminTelegramAlert(
        `🔄 <b>Inventory Returned</b>\n<b>${user.display_name || user.username || "Admin"}</b> marked ${approvedLoans.length} loan(s) as returned.\nLoan IDs: ${approvedLoans.map((loan) => `#${loan.id}`).join(", ")}`,
      ).catch(() => {});

      const bulkReturnUserIds = [...new Set(approvedLoans.map((l) => l.user_id))];
      const { data: bulkReturnUsers } = await supabase
        .from("users")
        .select("id, email, display_name, mute_emails")
        .in("id", bulkReturnUserIds);
      const bulkReturnUserMap = new Map(
        (bulkReturnUsers || []).map((u) => [u.id, u]),
      );
      for (const loan of approvedLoans) {
        const u = bulkReturnUserMap.get(loan.user_id);
        if (u?.email && !u?.mute_emails) {
          sendLoanReturnEmail({
            to: u.email,
            displayName: u.display_name,
            loanId: loan.id,
            items: (itemsByLoan.get(loan.id) || []).map((i) => ({
              item: i.item_name,
              quantity: i.quantity,
            })),
            photoUrl: null,
            adminReturn: true,
          }).catch(() => {});
        }
      }

      invalidateAll();
      return NextResponse.json({
        message: `${approvedLoans.length} loan(s) returned to stock`,
      });
    }

    // ===== BULK APPROVE =====
    if (action === "bulk_approve") {
      const { loan_ids } = body;
      if (!loan_ids || !Array.isArray(loan_ids) || loan_ids.length === 0) {
        return NextResponse.json(
          { error: "No loans selected" },
          { status: 400 },
        );
      }

      // Intercept guest IDs
      const guestIds = loan_ids.filter((id) => typeof id === "string" && id.startsWith("g_"));
      const regularIds = loan_ids.filter((id) => !(typeof id === "string" && id.startsWith("g_")));

      for (const gid of guestIds) {
        await handleGuestAction({ db, action: "approve", loan_id: Number.parseInt(gid.replace("g_", ""), 10), admin_notes: "", user });
      }

      if (regularIds.length === 0) {
        return NextResponse.json({ message: "Guest loans approved" });
      }

      // Batch fetch all pending loans
      const { data: pendingLoans } = await supabase
        .from("loan_requests")
        .select(TECH_LOAN_ADMIN_FIELDS)
        .in("id", regularIds)
        .eq("status", "pending");

      if (!pendingLoans || pendingLoans.length === 0) {
        return NextResponse.json(
          { error: "No pending loans found in selection" },
          { status: 400 },
        );
      }

      const validLoanIds = pendingLoans.map((l) => l.id);

      // Batch fetch all loan items
      const { data: allApproveItems } = await supabase
        .from("loan_items")
        .select(TECH_LOAN_ITEM_FIELDS)
        .in("loan_request_id", validLoanIds);

      const itemsByLoan = new Map();
      for (const item of allApproveItems || []) {
        if (!itemsByLoan.has(item.loan_request_id))
          itemsByLoan.set(item.loan_request_id, []);
        itemsByLoan.get(item.loan_request_id).push(item);
      }

      // Validate stock and apply deductions
      const sheetChangesMap = new Map();
      const deployedRows = [];
      for (const loan of pendingLoans) {
        for (const li of itemsByLoan.get(loan.id) || []) {
          const si = li.sheet_row
            ? db
                .prepare("SELECT * FROM storage_items WHERE sheet_row = ?")
                .get(li.sheet_row)
            : db
                .prepare("SELECT * FROM storage_items WHERE id = ?")
                .get(li.item_id);

          if (!si) throw new Error(`Item not found: ${li.item_name}`);
          if (si.current < li.quantity) {
            throw new Error(
              `Not enough stock for "${si.item}" (loan #${loan.id}). Available: ${si.current}`,
            );
          }

          const result = db
            .prepare(
              "UPDATE storage_items SET current = current - ? WHERE id = ? AND current >= ?",
            )
            .run(li.quantity, si.id, li.quantity);
          if (result.changes === 0)
            throw new Error(`Stock conflict for "${si.item}" — please retry`);

          sheetChangesMap.set(
            li.sheet_row,
            (sheetChangesMap.get(li.sheet_row) || 0) - li.quantity,
          );

          if (loan.loan_type === "permanent") {
            const deployedRow = {
              item: si.item,
              type: si.type,
              brand: si.brand,
              model: si.model,
              quantity: li.quantity,
              location: loan.location || si.location,
              allocation: loan.department || loan.purpose,
              status: "DEPLOYED",
              remarks: `Perm loan #${loan.id} — ${loan.purpose}`,
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
      }

      // Batch update loan statuses
      await supabase
        .from("loan_requests")
        .update({
          status: "approved",
          admin_notes: "Bulk approved",
          updated_at: new Date().toISOString(),
        })
        .in("id", validLoanIds);

      // Batch insert notifications
      await supabase.from("notifications").insert(
        pendingLoans.map((loan) => ({
          user_id: loan.user_id,
          message: `Your ${loan.loan_type} loan request #${loan.id} has been approved!`,
          link: "/loans",
        })),
      );

      // Batch insert audit logs
      await supabase.from("audit_log").insert(
        pendingLoans.map((loan) => ({
          user_id: user.id,
          action: "bulk_approve",
          target_type: "loan",
          target_id: loan.id,
          details: `Approved via bulk action.`,
        })),
      );

      const sheetChanges = [...sheetChangesMap.entries()].map(
        ([sheetRow, delta]) => ({ sheetRow, delta }),
      );
      await syncAuthoritativeStockToSheets(db, sheetChanges);
      if (deployedRows.length > 0) await syncDeployedToSheets(deployedRows);

      // Fire-and-forget Telegram notifications
      for (const loan of pendingLoans) {
        const itemList =
          (itemsByLoan.get(loan.id) || [])
            .map((item) => `${item.item_name} × ${item.quantity}`)
            .join(", ") || "Items pending sync";
        const periodLine = loan.end_date
          ? `${loan.start_date} to ${loan.end_date}`
          : `From ${loan.start_date}`;
        sendTelegramMessage(
          loan.user_id,
          `✅ <b>We've Received Your Loan</b>\nHere are your loan details:\n\nLoan ID: #${loan.id}\nStatus: Approved\nType: ${loan.loan_type}\nPurpose: ${loan.purpose}\nItems: ${itemList}\nPeriod: ${periodLine}`,
        ).catch((err) => console.error("Telegram notification failed:", err.message));
      }

      sendAdminTelegramAlert(
        `📦 <b>Inventory Checked Out</b>\n<b>${user.display_name || user.username || "Admin"}</b> approved ${pendingLoans.length} loan(s).\nLoan IDs: ${pendingLoans.map((loan) => `#${loan.id}`).join(", ")}`,
      ).catch(() => {});

      const bulkApproveUserIds = [...new Set(pendingLoans.map((l) => l.user_id))];
      const { data: bulkApproveUsers } = await supabase
        .from("users")
        .select("id, email, display_name, mute_emails")
        .in("id", bulkApproveUserIds);
      const bulkApproveUserMap = new Map(
        (bulkApproveUsers || []).map((u) => [u.id, u]),
      );
      for (const loan of pendingLoans) {
        const u = bulkApproveUserMap.get(loan.user_id);
        if (u?.email && !u?.mute_emails) {
          sendLoanStatusEmail({
            to: u.email,
            displayName: u.display_name,
            loanId: loan.id,
            status: "approved",
            adminNotes: "Bulk approved",
            items: (itemsByLoan.get(loan.id) || []).map((i) => ({
              item: i.item_name,
              quantity: i.quantity,
            })),
          }).catch(() => {});
        }
      }

      invalidateAll();
      return NextResponse.json({
        message: `${pendingLoans.length} loan(s) approved`,
      });
    }

    if (action === "clear_activity") {
      await supabase.from("activity_feed").delete().neq("id", 0);
      return NextResponse.json({ message: "Activity log cleared" });
    }

    // ===== SINGLE LOAN ACTIONS =====
    let { loan_id, admin_notes } = body;
    let isGuest = false;

    if (typeof loan_id === "string" && loan_id.startsWith("g_")) {
      isGuest = true;
      loan_id = Number.parseInt(loan_id.replace("g_", ""), 10);
    }

    if (isGuest) {
      return await handleGuestAction({ db, action, loan_id, admin_notes, user });
    }

    const { data: loan } = await supabase
      .from("loan_requests")
      .select(TECH_LOAN_ADMIN_FIELDS)
      .eq("id", loan_id)
      .single();

    if (!loan) {
      return NextResponse.json({ error: "Loan not found" }, { status: 404 });
    }

    if (action === "approve") {
      if (loan.status !== "pending") {
        return NextResponse.json(
          { error: "Loan already processed" },
          { status: 400 },
        );
      }

      const { data: loanItems } = await supabase
        .from("loan_items")
        .select(TECH_LOAN_ITEM_FIELDS)
        .eq("loan_request_id", loan_id);

      const approveChanges = []; // { sheetRow, delta }
      const deployedRows = [];

      // Validate + deduct stock in SQLite using sheet_row
      for (const li of loanItems || []) {
        const si = li.sheet_row
          ? db
              .prepare("SELECT * FROM storage_items WHERE sheet_row = ?")
              .get(li.sheet_row)
          : db
              .prepare("SELECT * FROM storage_items WHERE id = ?")
              .get(li.item_id);

        if (!si)
          throw new Error(`Item not found in inventory: ${li.item_name}`);
        if (si.current < li.quantity) {
          throw new Error(
            `Not enough stock for "${si.item}". Available: ${si.current}`,
          );
        }

        const result = db
          .prepare(
            "UPDATE storage_items SET current = current - ? WHERE id = ? AND current >= ?",
          )
          .run(li.quantity, si.id, li.quantity);
        if (result.changes === 0)
          throw new Error("Stock changed during approval — please try again");

        approveChanges.push({ sheetRow: si.sheet_row, delta: -li.quantity });

        // For permanent loans, add to deployed_items in SQLite
        if (loan.loan_type === "permanent") {
          const deployedRow = {
            item: si.item,
            type: si.type,
            brand: si.brand,
            model: si.model,
            quantity: li.quantity,
            location: loan.location || si.location,
            allocation: loan.department || loan.purpose,
            status: "DEPLOYED",
            remarks: `Perm loan #${loan_id} — ${loan.purpose}`,
          };
          db.prepare(
            `
            INSERT INTO deployed_items (item, type, brand, model, quantity, location, allocation, status, remarks)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
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

      // Update loan in Supabase
      await supabase
        .from("loan_requests")
        .update({
          status: "approved",
          admin_notes: admin_notes || "",
          updated_at: new Date().toISOString(),
        })
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
      await syncAuthoritativeStockToSheets(db, approveChanges);
      if (deployedRows.length > 0) await syncDeployedToSheets(deployedRows);

      // Notifications
      const { data: loanUser } = await supabase
        .from("users")
        .select(
          "email, display_name, telegram_chat_id, mute_emails, mute_telegram",
        )
        .eq("id", loan.user_id)
        .single();
      const backgroundTasks = [];
      if (loanUser?.email && !loanUser?.mute_emails) {
        backgroundTasks.push(
          sendLoanStatusEmail({
            to: loanUser.email,
            displayName: loanUser.display_name,
            loanId: loan_id,
            status: "approved",
            adminNotes: admin_notes,
            items: (loanItems || []).map((i) => ({
              item: i.item_name,
              quantity: i.quantity,
            })),
          }).catch((err) => console.error("Telegram notification failed:", err.message)),
        );
      }
      if (!loanUser?.mute_telegram) {
        const itemList =
          (loanItems || [])
            .map((i) => `${i.item_name} × ${i.quantity}`)
            .join(", ") || "Items pending sync";
        const periodLine = loan.end_date
          ? `${loan.start_date} to ${loan.end_date}`
          : `From ${loan.start_date}`;
        backgroundTasks.push(
          sendTelegramMessage(
            loan.user_id,
            `✅ <b>We've Received Your Loan</b>\nHere are your loan details:\n\nLoan ID: #${loan_id}\nStatus: Approved\nType: ${loan.loan_type}\nPurpose: ${loan.purpose}\nItems: ${itemList}\nPeriod: ${periodLine}${admin_notes ? `\nAdmin Notes: ${admin_notes}` : ""}`,
          ),
        );
      }
      await Promise.all(backgroundTasks);

      const approvedItemList =
        (loanItems || [])
          .map((i) => `${i.item_name} × ${i.quantity}`)
          .join(", ") || "No items listed";
      sendAdminTelegramAlert(
        `📦 <b>Inventory Checked Out</b>\n<b>${user.display_name || user.username || "Admin"}</b> approved loan #${loan_id}.\nBorrower: ${loanUser?.display_name || "Unknown"}\nPurpose: ${loan.purpose}\nItems: ${approvedItemList}`,
      ).catch(() => {});

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
        return NextResponse.json(
          { error: "Loan already processed" },
          { status: 400 },
        );
      }

      await supabase
        .from("loan_requests")
        .update({
          status: "rejected",
          admin_notes: admin_notes || "",
          updated_at: new Date().toISOString(),
        })
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

      const { data: rejectUser } = await supabase
        .from("users")
        .select(
          "email, display_name, telegram_chat_id, mute_emails, mute_telegram",
        )
        .eq("id", loan.user_id)
        .single();
      const { data: rejectItems } = await supabase
        .from("loan_items")
        .select("item_name, quantity")
        .eq("loan_request_id", loan_id);
      const rejectTasks = [];
      if (rejectUser?.email && !rejectUser?.mute_emails) {
        rejectTasks.push(
          sendLoanStatusEmail({
            to: rejectUser.email,
            displayName: rejectUser.display_name,
            loanId: loan_id,
            status: "rejected",
            adminNotes: admin_notes,
            items: (rejectItems || []).map((i) => ({
              item: i.item_name,
              quantity: i.quantity,
            })),
          }).catch((err) => console.error("Telegram notification failed:", err.message)),
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
        return NextResponse.json(
          { error: "Only approved loans can be returned" },
          { status: 400 },
        );
      }

      const [{ data: loanItems }, { data: returnUser }] = await Promise.all([
        supabase
          .from("loan_items")
          .select(TECH_LOAN_ITEM_FIELDS)
          .eq("loan_request_id", loan_id),
        supabase
          .from("users")
          .select("display_name, email, mute_emails")
          .eq("id", loan.user_id)
          .single(),
      ]);

      const returnChanges = [];
      for (const li of loanItems || []) {
        const si = li.sheet_row
          ? db
              .prepare("SELECT id FROM storage_items WHERE sheet_row = ?")
              .get(li.sheet_row)
          : db
              .prepare("SELECT id FROM storage_items WHERE id = ?")
              .get(li.item_id);
        if (si) {
          db.prepare(
            "UPDATE storage_items SET current = current + ? WHERE id = ?",
          ).run(li.quantity, si.id);
          returnChanges.push({ sheetRow: li.sheet_row, delta: li.quantity });
        }
      }

      await supabase
        .from("loan_requests")
        .update({
          status: "returned",
          admin_notes: admin_notes || "Items returned",
          updated_at: new Date().toISOString(),
        })
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

      await syncAuthoritativeStockToSheets(db, returnChanges);
      sendTelegramMessage(
        loan.user_id,
        `🔄 <b>Loan Returned</b>\nYour loaned items for request #${loan_id} have been marked as returned and restored to inventory.`,
      ).catch((err) => console.error("Telegram notification failed:", err.message));

      if (returnUser?.email && !returnUser?.mute_emails) {
        sendLoanReturnEmail({
          to: returnUser.email,
          displayName: returnUser.display_name,
          loanId: loan_id,
          items: (loanItems || []).map((i) => ({
            item: i.item_name,
            quantity: i.quantity,
          })),
          photoUrl: null,
          adminReturn: true,
        }).catch(() => {});
      }

      const returnedItemList =
        (loanItems || [])
          .map((i) => `${i.item_name} × ${i.quantity}`)
          .join(", ") || "No items listed";
      sendAdminTelegramAlert(
        `🔄 <b>Inventory Returned</b>\n<b>${user.display_name || user.username || "Admin"}</b> returned loan #${loan_id} to stock.\nBorrower: ${returnUser?.display_name || "Unknown"}\nItems: ${returnedItemList}`,
      ).catch((err) => console.error("Telegram notification failed:", err.message));

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
        .select(TECH_LOAN_ITEM_FIELDS)
        .eq("loan_request_id", loan_id);

      const restoreChanges = [];

      // If approved, restore stock in SQLite
      if (loan.status === "approved") {
        for (const li of loanItems || []) {
          const si = li.sheet_row
            ? db
                .prepare("SELECT id FROM storage_items WHERE sheet_row = ?")
                .get(li.sheet_row)
            : db
                .prepare("SELECT id FROM storage_items WHERE id = ?")
                .get(li.item_id);
          if (si) {
            db.prepare(
              "UPDATE storage_items SET current = current + ? WHERE id = ?",
            ).run(li.quantity, si.id);
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

        sendTelegramMessage(
          loan.user_id,
          `❌ <b>Loan Removed</b>\nYour ${loan.loan_type} loan #${loan_id} was removed by an admin.${admin_notes ? `\n\nAdmin notes: ${admin_notes}` : ""}`,
        ).catch((err) =>
          console.error("Telegram notification failed:", err.message),
        );
      }

      if (loan.status === "approved") {
        const deletedItemList =
          (loanItems || [])
            .map((i) => `${i.item_name} × ${i.quantity}`)
            .join(", ") || "No items listed";
        sendAdminTelegramAlert(
          `↩️ <b>Inventory Restored</b>\n<b>${user.display_name || user.username || "Admin"}</b> deleted approved loan #${loan_id} and restored stock.\nItems: ${deletedItemList}${admin_notes ? `\nAdmin Notes: ${admin_notes}` : ""}`,
        ).catch((err) =>
          console.error("Telegram notification failed:", err.message),
        );
      }

      // ON DELETE CASCADE removes loan_items automatically
      await supabase.from("loan_requests").delete().eq("id", loan_id);

      if (restoreChanges.length > 0)
        await syncAuthoritativeStockToSheets(db, restoreChanges);
      invalidateAll();

      return NextResponse.json({ message: "Loan deleted" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Admin action error:", error);
    return NextResponse.json(
      { error: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}

async function handleGuestAction({ db, action, loan_id, admin_notes, user }) {
  const { data: request, error: reqErr } = await supabase
    .from("guest_borrow_requests")
    .select("*")
    .eq("id", loan_id)
    .single();

  if (reqErr) {
    console.error("Guest request fetch error:", reqErr);
  }

  if (!request) return NextResponse.json({ error: "Guest request not found: " + (reqErr?.message || "") }, { status: 404 });

  if (action === "approve") {
    if (request.status !== "pending") return NextResponse.json({ error: "Already processed" }, { status: 400 });
    
    // Process tech items
    const approveChanges = [];
    const techItems = (request.items || []).filter(i => i.source === "tech" || !i.source);

    for (const li of techItems) {
      if (!li.sheet_row && !li.item_id) continue;
      const si = li.sheet_row
        ? db.prepare("SELECT * FROM storage_items WHERE sheet_row = ?").get(li.sheet_row)
        : db.prepare("SELECT * FROM storage_items WHERE id = ?").get(li.item_id);

      if (!si) throw new Error(`Item not found: ${li.item_name || 'unknown'}`);
      if (si.current < li.quantity) throw new Error(`Not enough stock for "${si.item}". Available: ${si.current}`);

      const result = db.prepare("UPDATE storage_items SET current = current - ? WHERE id = ? AND current >= ?")
        .run(li.quantity, si.id, li.quantity);
      if (result.changes === 0) throw new Error("Stock changed during approval — try again");
      
      approveChanges.push({ sheetRow: si.sheet_row, delta: -li.quantity });
    }

    // Since laptops are handled via temporary overlaps naturally without changing laptops tables
    // updating their status to approved handles the availability for them. No stock update needed.
    
    // We update the request itself
    await supabase.from("guest_borrow_requests").update({ status: "approved", admin_notes: admin_notes || "", updated_at: new Date().toISOString() }).eq("id", loan_id);
    
    // Post to google sheets
    if (approveChanges.length > 0) await syncAuthoritativeStockToSheets(db, approveChanges);
    
    // Log
    await supabase.from("audit_log").insert({ user_id: user.id, action: "approve", target_type: "guest_request", target_id: loan_id, details: `Approved guest loan. ${admin_notes || ""}` });

    const guestTechSummary =
      techItems.map((item) => `${item.item_name} × ${item.quantity}`).join(", ") ||
      "No tech items";
    sendAdminTelegramAlert(
      `📦 <b>Guest Inventory Checked Out</b>\n<b>${user.display_name || user.username || "Admin"}</b> approved guest request #${loan_id}.\nGuest: ${request.guest_name}\nItems: ${guestTechSummary}${admin_notes ? `\nAdmin Notes: ${admin_notes}` : ""}`,
    ).catch(() => {});

    invalidateAll();
    return NextResponse.json({ message: "Guest loan approved" });
  }

  if (action === "return") {
    if (request.status !== "approved") return NextResponse.json({ error: "Not approved" }, { status: 400 });
    
    const returnChanges = [];
    const techItems = (request.items || []).filter(i => i.source === "tech" || !i.source);

    for (const li of techItems) {
      if (!li.sheet_row && !li.item_id) continue;
      const si = li.sheet_row
        ? db.prepare("SELECT id, sheet_row FROM storage_items WHERE sheet_row = ?").get(li.sheet_row)
        : db.prepare("SELECT id, sheet_row FROM storage_items WHERE id = ?").get(li.item_id);

      if (si) {
        db.prepare("UPDATE storage_items SET current = current + ? WHERE id = ?").run(li.quantity, si.id);
        returnChanges.push({ sheetRow: si.sheet_row, delta: li.quantity });
      }
    }

    await supabase.from("guest_borrow_requests").update({ status: "returned", admin_notes: admin_notes || "Items returned", updated_at: new Date().toISOString() }).eq("id", loan_id);
    if (returnChanges.length > 0) await syncAuthoritativeStockToSheets(db, returnChanges);
    await supabase.from("audit_log").insert({ user_id: user.id, action: "return", target_type: "guest_request", target_id: loan_id, details: `Items returned to stock. ${admin_notes || ""}` });

    const guestReturnSummary =
      techItems.map((item) => `${item.item_name} × ${item.quantity}`).join(", ") ||
      "No tech items";
    sendAdminTelegramAlert(
      `🔄 <b>Guest Inventory Returned</b>\n<b>${user.display_name || user.username || "Admin"}</b> returned guest request #${loan_id} to stock.\nGuest: ${request.guest_name}\nItems: ${guestReturnSummary}${admin_notes ? `\nAdmin Notes: ${admin_notes}` : ""}`,
    ).catch(() => {});

    invalidateAll();
    return NextResponse.json({ message: "Guest items returned to stock" });
  }

  if (action === "reject") {
    if (request.status !== "pending") return NextResponse.json({ error: "Already processed" }, { status: 400 });
    await supabase.from("guest_borrow_requests").update({ status: "rejected", admin_notes: admin_notes || "", updated_at: new Date().toISOString() }).eq("id", loan_id);
    await supabase.from("audit_log").insert({ user_id: user.id, action: "reject", target_type: "guest_request", target_id: loan_id, details: `Rejected guest loan. ${admin_notes || ""}` });
    invalidateAll();
    return NextResponse.json({ message: "Guest request rejected" });
  }

  if (action === "delete") {
    await supabase.from("guest_borrow_requests").delete().eq("id", loan_id);
    await supabase.from("audit_log").insert({ user_id: user.id, action: "delete", target_type: "guest_request", target_id: loan_id, details: "Deleted guest request" });
    invalidateAll();
    return NextResponse.json({ message: "Guest request deleted" });
  }

  return NextResponse.json({ error: "Unsupported guest action" }, { status: 400 });
}

// GET: dashboard stats + active loans + due date warnings
export async function GET(request) {
  const requestStartedAt = Date.now();
  const timings = [];
  const mark = (name, startedAt) => {
    timings.push({ name, duration: Date.now() - startedAt });
  };

  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  }

  const profileRequested =
    new URL(request.url).searchParams.get("profile") === "true";

  const syncStartedAt = Date.now();
  startSyncIfNeeded();
  await waitForSync();
  const db = getDb();
  mark("sync", syncStartedAt);

  // Inventory stats from SQLite
  const inventoryStatsStartedAt = Date.now();
  const totalItems =
    db.prepare("SELECT SUM(quantity_spare) as total FROM storage_items").get()
      .total || 0;
  const totalCurrent =
    db.prepare("SELECT SUM(current) as total FROM storage_items").get().total ||
    0;
  const deployedItems =
    db.prepare("SELECT SUM(quantity) as total FROM deployed_items").get()
      .total || 0;
  const lowStock = db
    .prepare(
      "SELECT COUNT(*) as count FROM storage_items WHERE current <= 2 AND quantity_spare > 0",
    )
    .get().count;
  mark("inventory_stats", inventoryStatsStartedAt);

  // Loan stats from Supabase (authoritative — not derived from ephemeral SQLite)
  const countQueriesStartedAt = Date.now();
  const [
    { count: pendingRequests },
    { count: laptopPending },
    { count: laptopActive },
  ] = await Promise.all([
    supabase
      .from("loan_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("laptop_loan_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("laptop_loan_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "approved"),
  ]);
  mark("loan_counts", countQueriesStartedAt);

  // totalLoaned calculated later from approved loan_items (accurate across cold starts)
  const stats = {
    totalItems,
    totalCurrent,
    totalLoaned: 0, // placeholder — filled in below after loan items are fetched
    pendingRequests: (pendingRequests || 0) + (laptopPending || 0),
    laptopPending: laptopPending || 0,
    laptopActive: laptopActive || 0,
    lowStock,
    deployedItems,
  };

  // Active loans from Supabase — tech + laptop in parallel
  const activeLoansStartedAt = Date.now();
  const [{ data: activeLoans }, { data: activeLaptopLoans }] =
    await Promise.all([
      supabase
        .from("loan_requests")
        .select(TECH_LOAN_LIST_SELECT)
        .in("status", ["approved", "pending"])
        .order("start_date", { ascending: true })
        .limit(ACTIVE_LOANS_DASHBOARD_LIMIT),
      supabase
        .from("laptop_loan_requests")
        .select(
          "id, user_id, loan_type, purpose, remarks, department, start_date, end_date, status, admin_notes, created_at, updated_at, users (display_name, username, telegram_handle), laptop_loan_items(id, loan_request_id, laptop_id, laptops(id, name))",
        )
        .in("status", ["approved", "pending"])
        .order("start_date", { ascending: true })
        .limit(ACTIVE_LOANS_DASHBOARD_LIMIT),
    ]);
  mark("active_loans", activeLoansStartedAt);

  const formattedLoans = (activeLoans || []).map((lr) => ({
    ...lr,
    _loanKind: "tech",
    requester_name: lr.users?.display_name || null,
    requester_username: lr.users?.username || null,
    requester_telegram: lr.users?.telegram_handle || null,
    users: undefined,
    items: [],
  }));

  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const dueCountsStartedAt = Date.now();
  const analyticsStartedAt = Date.now();

  const [
    { data: techLoanItems },
    dueCountResults,
    { data: recentLoansRaw },
    { data: allLoanItems },
    { data: recentActivityRaw },
  ] = await Promise.all([
    formattedLoans.length > 0
      ? supabase
          .from("loan_items")
          .select("loan_request_id, item_name, quantity")
          .in(
            "loan_request_id",
            formattedLoans.map((loan) => loan.id),
          )
      : Promise.resolve({ data: [] }),
    Promise.all([
      supabase
        .from("loan_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "approved")
        .eq("loan_type", "temporary")
        .not("end_date", "is", null)
        .lt("end_date", new Date(Date.now()).toLocaleDateString("en-CA")),
      supabase
        .from("loan_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "approved")
        .eq("loan_type", "temporary")
        .eq(
          "end_date",
          new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString(
            "en-CA",
          ),
        ),
      supabase
        .from("laptop_loan_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "approved")
        .eq("loan_type", "temporary")
        .not("end_date", "is", null)
        .lt("end_date", new Date(Date.now()).toLocaleDateString("en-CA")),
      supabase
        .from("laptop_loan_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "approved")
        .eq("loan_type", "temporary")
        .eq(
          "end_date",
          new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString(
            "en-CA",
          ),
        ),
    ]),
    supabase
      .from("loan_requests")
      .select("created_at")
      .gte("created_at", thirtyDaysAgo),
    supabase.from("loan_items").select("item_name, quantity"),
    supabase
      .from("activity_feed")
      .select(
        "id, user_id, action, description, link, created_at, users (display_name)",
      )
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  mark("due_counts", dueCountsStartedAt);
  mark("analytics", analyticsStartedAt);

  if (formattedLoans.length > 0) {
    const itemsByLoan = new Map();
    for (const item of techLoanItems || []) {
      if (!itemsByLoan.has(item.loan_request_id)) {
        itemsByLoan.set(item.loan_request_id, []);
      }
      itemsByLoan
        .get(item.loan_request_id)
        .push({ ...item, item: item.item_name });
    }
    for (const loan of formattedLoans) {
      loan.items = itemsByLoan.get(loan.id) || [];
    }

    stats.totalLoaned = formattedLoans.reduce((sum, loan) => {
      if (loan.status !== "approved") return sum;
      const loanQty = loan.items.reduce(
        (itemSum, item) => itemSum + item.quantity,
        0,
      );
      return sum + loanQty;
    }, 0);
  }

  const formattedLaptopLoans = (activeLaptopLoans || []).map((lr) => ({
    ...lr,
    _loanKind: "laptop",
    requester_name: lr.users?.display_name || null,
    requester_username: lr.users?.username || null,
    requester_telegram: lr.users?.telegram_handle || null,
    users: undefined,
    laptops: lr.laptop_loan_items || [],
    items: (lr.laptop_loan_items || []).map((item) => ({
      id: item.id,
      item: item.laptops?.name || "Unknown laptop",
      quantity: 1,
    })),
    laptop_loan_items: undefined,
  }));

  // Fetch active guest borrow requests for the calendar
  const { data: activeGuestRequests } = await supabase
    .from("guest_borrow_requests")
    .select("*")
    .in("status", ["approved", "pending"])
    .order("start_date", { ascending: true })
    .limit(ACTIVE_LOANS_DASHBOARD_LIMIT);

  const formattedGuestLoans = (activeGuestRequests || []).flatMap((r) => {
    const techItems = (r.items || [])
      .filter((i) => i.source === "tech" || !i.source)
      .map((i) => ({
        id: null,
        item: i.item_name || "Unknown Item",
        quantity: i.quantity || 1,
      }));
    const laptopItems = (r.items || [])
      .filter((i) => i.source === "laptop")
      .map((i) => ({
        id: null,
        item: i.item_name || "Unknown Laptop",
        quantity: 1,
      }));

    const result = [];

    if (techItems.length > 0) {
      result.push({
        id: `g_${r.id}`,
        user_id: null,
        loan_type: r.loan_type,
        purpose: r.purpose,
        remarks: r.remarks,
        department: r.department,
        location: "Guest Request",
        start_date: r.start_date,
        end_date: r.end_date,
        status: r.status,
        admin_notes: r.admin_notes,
        created_at: r.created_at,
        updated_at: r.updated_at,
        requester_name: r.guest_name,
        requester_username: null,
        requester_telegram: r.telegram_handle,
        _loanKind: "tech",
        items: techItems,
      });
    }

    if (laptopItems.length > 0) {
      result.push({
        id: `g_${r.id}`,
        user_id: null,
        loan_type: r.loan_type,
        purpose: r.purpose,
        remarks: r.remarks,
        department: r.department,
        location: "Guest Request",
        start_date: r.start_date,
        end_date: r.end_date,
        status: r.status,
        admin_notes: r.admin_notes,
        created_at: r.created_at,
        updated_at: r.updated_at,
        requester_name: r.guest_name,
        requester_username: null,
        requester_telegram: r.telegram_handle,
        _loanKind: "laptop",
        items: laptopItems,
      });
    }

    return result;
  });

  const mergedActiveLoans = [...formattedLoans, ...formattedLaptopLoans, ...formattedGuestLoans].sort(
    (a, b) => new Date(a.start_date) - new Date(b.start_date),
  );

  const [
    { count: overdueLoans },
    { count: dueSoonLoans },
    { count: overdueLaptopLoans },
    { count: dueSoonLaptopLoans },
  ] = dueCountResults;

  // Group by day
  const dayMap = new Map();
  for (const lr of recentLoansRaw || []) {
    const day = lr.created_at.split("T")[0];
    dayMap.set(day, (dayMap.get(day) || 0) + 1);
  }
  const loansTrend = [...dayMap.entries()].sort().map(([day, count]) => ({
    date: new Date(day).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    loans: count,
  }));

  const itemTotals = new Map();
  for (const li of allLoanItems || []) {
    itemTotals.set(
      li.item_name,
      (itemTotals.get(li.item_name) || 0) + li.quantity,
    );
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

  const recentActivity = (recentActivityRaw || []).map((af) => ({
    ...af,
    display_name: af.users?.display_name || null,
    users: undefined,
  }));

  mark("response_build", requestStartedAt);

  const serverTiming = timings
    .map((entry) => `${entry.name};dur=${entry.duration}`)
    .join(", ");

  const responseBody = {
    stats,
    activeLoans: mergedActiveLoans,
    overdueCount: (overdueLoans || 0) + (overdueLaptopLoans || 0),
    dueSoonCount: (dueSoonLoans || 0) + (dueSoonLaptopLoans || 0),
    charts: { loansTrend, topItems, inventoryDistribution },
    recentActivity,
  };

  if (profileRequested) {
    responseBody.profile = {
      totalMs: Date.now() - requestStartedAt,
      segments: timings,
    };
  }

  return NextResponse.json(responseBody, {
    headers: {
      "Cache-Control": "private, s-maxage=30, stale-while-revalidate=60",
      "Server-Timing": serverTiming,
    },
  });
}
