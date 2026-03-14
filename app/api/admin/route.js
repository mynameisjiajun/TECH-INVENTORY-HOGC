import { getDb, waitForSync, syncLoansToSheet, logActivity } from "@/lib/db/db";
import { getCurrentUser } from "@/lib/utils/auth";
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

function logAudit(db, userId, action, targetType, targetId, details) {
  db.prepare(
    "INSERT INTO audit_log (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
  ).run(userId, action, targetType, targetId, details);
}

/**
 * Fire-and-forget: read the current values from Google Sheets, apply the
 * quantity deltas, and write the results back.
 * @param {object} db - SQLite database
 * @param {Array<{itemId: number, delta: number}>} changes
 *   delta is negative for approve (stock goes down), positive for return (stock goes up)
 */
async function syncStockToSheets(db, changes) {
  if (!SHEETS_ENABLED || changes.length === 0) return;
  console.log(`[SYNC STOCK] Start targeting ${changes.length} items`);
  try {
    const itemIds = changes.map((c) => c.itemId);
    const placeholders = itemIds.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT id, sheet_row FROM storage_items WHERE id IN (${placeholders}) AND sheet_row IS NOT NULL`,
      )
      .all(...itemIds);

    if (rows.length === 0) {
      console.warn("[SYNC STOCK] Target items have no sheet_row mapping in DB");
      return;
    }

    const rowMap = Object.fromEntries(rows.map((r) => [r.id, r.sheet_row]));
    const sheetChanges = changes
      .filter((c) => rowMap[c.itemId])
      .map((c) => ({
        cell: `${CURRENT_COL}${rowMap[c.itemId]}`,
        delta: c.delta,
      }));

    if (sheetChanges.length === 0) {
      console.warn("[SYNC STOCK] No resolved cell mappings found for changes");
      return;
    }

    try {
      console.log(`[SYNC STOCK] Calling applyDeltasToCells with:`, JSON.stringify(sheetChanges));
      await applyDeltasToCells("Storage Spare", sheetChanges);
      console.log(`[SYNC STOCK] applyDeltasToCells completed successfully`);
    } catch (err) {
      console.error("Google Sheets write-back failed:", err.message);
    }
  } catch (err) {
    console.error("Google Sheets sync error:", err.message);
  }
}

/**
 * Append newly deployed items to the DEPLOYED sheet in Google Sheets.
 * Columns in the sheet: A=empty, B=Item, C=Type, D=Brand, E=Model,
 * F=Quantity, G=Location, H=Allocation, I=Status, J=Remarks
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
    try {
      await appendRows("DEPLOYED", sheetRows);
    } catch (err) {
      console.error("Google Sheets deployed write-back failed:", err.message);
    }
  } catch (err) {
    console.error("Google Sheets deployed sync error:", err.message);
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
    const db = getDb();

    // ===== BULK RETURN =====
    if (action === "bulk_return") {
      const { loan_ids, admin_notes } = body;
      if (!loan_ids || !Array.isArray(loan_ids) || loan_ids.length === 0) {
        return NextResponse.json(
          { error: "No loans selected" },
          { status: 400 },
        );
      }

      const bulkReturnTx = db.transaction(() => {
        let returned = 0;
        const bulkDeltaMap = new Map();
        for (const loanId of loan_ids) {
          const loan = db
            .prepare("SELECT * FROM loan_requests WHERE id = ? AND status = ?")
            .get(loanId, "approved");
          if (!loan) continue;

          const loanItems = db
            .prepare("SELECT * FROM loan_items WHERE loan_request_id = ?")
            .all(loanId);
          for (const li of loanItems) {
            db.prepare(
              "UPDATE storage_items SET current = current + ? WHERE id = ?",
            ).run(li.quantity, li.item_id);
            bulkDeltaMap.set(
              li.item_id,
              (bulkDeltaMap.get(li.item_id) || 0) + li.quantity,
            );
          }

          db.prepare(
            `
            UPDATE loan_requests SET status = 'returned', admin_notes = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
          ).run(admin_notes || "Bulk return", loanId);

          db.prepare(
            "INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)",
          ).run(
            loan.user_id,
            "Your loaned items have been marked as returned.",
            "/loans",
          );

          logAudit(
            db,
            user.id,
            "bulk_return",
            "loan",
            loanId,
            `Returned via bulk action. ${admin_notes || ""}`,
          );
          returned++;
        }
        return { returned, bulkDeltaMap };
      });

      const { returned, bulkDeltaMap } = bulkReturnTx();
      const bulkChanges = [...bulkDeltaMap.entries()].map(
        ([itemId, delta]) => ({ itemId, delta }),
      );
      await syncStockToSheets(db, bulkChanges);
      await syncLoansToSheet();
      return NextResponse.json({
        message: `${returned} loan(s) returned to stock`,
      });
    }

    // ===== SINGLE LOAN ACTIONS =====
    const { loan_id, admin_notes } = body;
    const loan = db
      .prepare("SELECT * FROM loan_requests WHERE id = ?")
      .get(loan_id);
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

      const loanItems = db
        .prepare("SELECT * FROM loan_items WHERE loan_request_id = ?")
        .all(loan_id);

      const approveTx = db.transaction(() => {
        for (const li of loanItems) {
          const item = db
            .prepare("SELECT * FROM storage_items WHERE id = ?")
            .get(li.item_id);
          if (item.current < li.quantity) {
            throw new Error(
              `Not enough stock for "${item.item}". Available: ${item.current}`,
            );
          }
        }

        const approveChanges = [];
        const deployedRows = [];
        for (const li of loanItems) {
          const item = db
            .prepare("SELECT * FROM storage_items WHERE id = ?")
            .get(li.item_id);
          const result = db
            .prepare(
              "UPDATE storage_items SET current = current - ? WHERE id = ? AND current >= ?",
            )
            .run(li.quantity, li.item_id, li.quantity);
          if (result.changes === 0) {
            throw new Error("Stock changed during approval — please try again");
          }
          approveChanges.push({ itemId: li.item_id, delta: -li.quantity });

          // For permanent loans, add to deployed_items
          if (loan.loan_type === "permanent") {
            const deployedRow = {
              item: item.item,
              type: item.type,
              brand: item.brand,
              model: item.model,
              quantity: li.quantity,
              location: loan.location || item.location,
              allocation: loan.department || loan.purpose,
              status: "DEPLOYED",
              remarks: `Perm loan #${loan_id} — ${loan.purpose}`,
            };
            db.prepare(
              `
              INSERT INTO deployed_items (item, type, brand, model, quantity, location, allocation, status, remarks, loan_request_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
              loan_id,
            );
            deployedRows.push(deployedRow);
          }
        }

        db.prepare(
          `
          UPDATE loan_requests SET status = 'approved', admin_notes = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        ).run(admin_notes || "", loan_id);

        db.prepare(
          "INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)",
        ).run(
          loan.user_id,
          `Your ${loan.loan_type} loan request has been approved!`,
          "/loans",
        );

        logAudit(
          db,
          user.id,
          "approve",
          "loan",
          loan_id,
          `Approved ${loan.loan_type} loan. ${admin_notes || ""}`,
        );
        return { approveChanges, deployedRows };
      });

      try {
        const { approveChanges, deployedRows } = approveTx();
        await syncStockToSheets(db, approveChanges);
        if (deployedRows.length > 0) {
          await syncDeployedToSheets(deployedRows);
        }
        // Send approval email
        const loanUser = db
          .prepare("SELECT email, display_name FROM users WHERE id = ?")
          .get(loan.user_id);
        const adminBackgroundTasks = [];
        if (loanUser?.email) {
          const loanItems = db
            .prepare(
              `SELECT li.quantity, si.item FROM loan_items li JOIN storage_items si ON li.item_id = si.id WHERE li.loan_request_id = ?`,
            )
            .all(loan_id);
          adminBackgroundTasks.push(
            sendLoanStatusEmail({
              to: loanUser.email,
              displayName: loanUser.display_name,
              loanId: loan_id,
              status: "approved",
              adminNotes: admin_notes,
              items: loanItems,
            }).catch(() => {})
          );
        }
        adminBackgroundTasks.push(
          sendTelegramMessage(
            loan.user_id,
            `✅ <b>Loan Approved</b>\nYour ${loan.loan_type} loan request #${loan_id} has been approved!${admin_notes ? `\n\nAdmin notes: ${admin_notes}` : ""}`
          )
        );
        if (adminBackgroundTasks.length > 0) {
          await Promise.all(adminBackgroundTasks);
        }
        await syncLoansToSheet();
        const requester = db.prepare("SELECT display_name FROM users WHERE id = ?").get(loan.user_id);
        logActivity(db, user.id, "approve", `Approved ${loan.loan_type} loan #${loan_id} for ${requester?.display_name || "user"}`);
        return NextResponse.json({ message: "Loan approved" });
      } catch (txErr) {
        return NextResponse.json({ error: txErr.message }, { status: 400 });
      }
    }

    if (action === "reject") {
      if (loan.status !== "pending") {
        return NextResponse.json(
          { error: "Loan already processed" },
          { status: 400 },
        );
      }

      db.prepare(
        `
        UPDATE loan_requests SET status = 'rejected', admin_notes = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `,
      ).run(admin_notes || "", loan_id);

      db.prepare(
        "INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)",
      ).run(
        loan.user_id,
        `Your ${loan.loan_type} loan request has been rejected. ${admin_notes || ""}`,
        "/loans",
      );

      logAudit(
        db,
        user.id,
        "reject",
        "loan",
        loan_id,
        `Rejected ${loan.loan_type} loan. ${admin_notes || ""}`,
      );
      // Send rejection email
      const rejectUser = db
        .prepare("SELECT email, display_name FROM users WHERE id = ?")
        .get(loan.user_id);
      const rejectBackgroundTasks = [];
      if (rejectUser?.email) {
        const rejectItems = db
          .prepare(
            `SELECT li.quantity, si.item FROM loan_items li JOIN storage_items si ON li.item_id = si.id WHERE li.loan_request_id = ?`,
          )
          .all(loan_id);
        rejectBackgroundTasks.push(
          sendLoanStatusEmail({
            to: rejectUser.email,
            displayName: rejectUser.display_name,
            loanId: loan_id,
            status: "rejected",
            adminNotes: admin_notes,
            items: rejectItems,
          }).catch(() => {})
        );
      }
      rejectBackgroundTasks.push(
        sendTelegramMessage(
          loan.user_id,
          `❌ <b>Loan Rejected</b>\nYour ${loan.loan_type} loan request #${loan_id} has been rejected.${admin_notes ? `\n\nAdmin notes: ${admin_notes}` : ""}`
        )
      );
      if (rejectBackgroundTasks.length > 0) {
        await Promise.all(rejectBackgroundTasks);
      }
      await syncLoansToSheet();
      const rejectRequester = db.prepare("SELECT display_name FROM users WHERE id = ?").get(loan.user_id);
      logActivity(db, user.id, "reject", `Rejected loan #${loan_id} from ${rejectRequester?.display_name || "user"}`);
      return NextResponse.json({ message: "Loan rejected" });
    }

    if (action === "return") {
      if (loan.status !== "approved") {
        return NextResponse.json(
          { error: "Only approved loans can be returned" },
          { status: 400 },
        );
      }

      const returnTx = db.transaction(() => {
        const loanItems = db
          .prepare("SELECT * FROM loan_items WHERE loan_request_id = ?")
          .all(loan_id);
        const returnChanges = [];
        for (const li of loanItems) {
          db.prepare(
            "UPDATE storage_items SET current = current + ? WHERE id = ?",
          ).run(li.quantity, li.item_id);
          returnChanges.push({ itemId: li.item_id, delta: li.quantity });
        }

        db.prepare(
          `
          UPDATE loan_requests SET status = 'returned', admin_notes = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `,
        ).run(admin_notes || "Items returned", loan_id);

        db.prepare(
          "INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)",
        ).run(
          loan.user_id,
          "Your loaned items have been marked as returned.",
          "/loans",
        );

        logAudit(
          db,
          user.id,
          "return",
          "loan",
          loan_id,
          `Items returned to stock. ${admin_notes || ""}`,
        );
        return returnChanges;
      });

      const returnChanges = returnTx();
      await syncStockToSheets(db, returnChanges);
      
      await sendTelegramMessage(
        loan.user_id,
        `🔄 <b>Loan Returned</b>\nYour loaned items for request #${loan_id} have been marked as returned and restored to inventory.`
      );

      await syncLoansToSheet();
      const returnRequester = db.prepare("SELECT display_name FROM users WHERE id = ?").get(loan.user_id);
      logActivity(db, user.id, "return", `Returned items from loan #${loan_id} (${returnRequester?.display_name || "user"})`);
      return NextResponse.json({ message: "Items returned to stock" });
    }

    if (action === "delete") {
      const deleteTx = db.transaction(() => {
        const loanItems = db
          .prepare("SELECT * FROM loan_items WHERE loan_request_id = ?")
          .all(loan_id);
        const restoreChanges = [];

        // If loan was approved, restore stock
        if (loan.status === "approved") {
          for (const li of loanItems) {
            db.prepare(
              "UPDATE storage_items SET current = current + ? WHERE id = ?",
            ).run(li.quantity, li.item_id);
            restoreChanges.push({ itemId: li.item_id, delta: li.quantity });
          }
        }

        // Remove deployed items created by this permanent loan
        if (loan.loan_type === "permanent") {
          db.prepare(
            "DELETE FROM deployed_items WHERE loan_request_id = ?",
          ).run(loan_id);
        }

        // Delete loan items, then the loan itself
        db.prepare("DELETE FROM loan_items WHERE loan_request_id = ?").run(
          loan_id,
        );
        db.prepare("DELETE FROM loan_requests WHERE id = ?").run(loan_id);

        logAudit(
          db,
          user.id,
          "delete",
          "loan",
          loan_id,
          `Deleted ${loan.loan_type} loan (was ${loan.status}). ${admin_notes || ""}`,
        );

        return restoreChanges;
      });

      const restoreChanges = deleteTx();
      if (restoreChanges.length > 0) {
        await syncStockToSheets(db, restoreChanges);
      }
      await syncLoansToSheet();
      return NextResponse.json({ message: "Loan deleted" });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Admin action error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// GET: dashboard stats + active loans + due date warnings
export async function GET(request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "admin")
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );

  await waitForSync();
  const db = getDb();
  const stats = {
    totalItems:
      db.prepare("SELECT SUM(quantity_spare) as total FROM storage_items").get()
        .total || 0,
    totalCurrent:
      db.prepare("SELECT SUM(current) as total FROM storage_items").get()
        .total || 0,
    totalLoaned: 0,
    pendingRequests: db
      .prepare(
        "SELECT COUNT(*) as count FROM loan_requests WHERE status = 'pending'",
      )
      .get().count,
    lowStock: db
      .prepare(
        "SELECT COUNT(*) as count FROM storage_items WHERE current <= 2 AND quantity_spare > 0",
      )
      .get().count,
    deployedItems:
      db.prepare("SELECT SUM(quantity) as total FROM deployed_items").get()
        .total || 0,
  };
  stats.totalLoaned = stats.totalItems - stats.totalCurrent;

  // Active loans for calendar
  const activeLoans = db
    .prepare(
      `
    SELECT lr.*, u.display_name as requester_name, u.username as requester_username
    FROM loan_requests lr
    JOIN users u ON lr.user_id = u.id
    WHERE lr.status IN ('approved', 'pending')
    ORDER BY lr.start_date
  `,
    )
    .all();

  if (activeLoans.length > 0) {
    // ⚡ Bolt: Batch fetch all loan items in a single query to prevent N+1 bottleneck
    // ⚡ Bolt: Use a JOIN on loan_requests instead of an IN clause to avoid SQLite parameter limits on Vercel
    const allItems = db
      .prepare(
        `
      SELECT li.*, si.item, si.type
      FROM loan_items li
      JOIN storage_items si ON li.item_id = si.id
      JOIN loan_requests lr ON li.loan_request_id = lr.id
      WHERE lr.status IN ('approved', 'pending')
    `,
      )
      .all();

    const itemsByLoan = new Map();
    for (const item of allItems) {
      if (!itemsByLoan.has(item.loan_request_id)) {
        itemsByLoan.set(item.loan_request_id, []);
      }
      itemsByLoan.get(item.loan_request_id).push(item);
    }

    for (const loan of activeLoans) {
      loan.items = itemsByLoan.get(loan.id) || [];
    }
  }

  // Due date warnings: loans due within 1 day or overdue
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toLocaleDateString('en-CA');
  const tomorrowObj = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const tomorrow = tomorrowObj.toLocaleDateString('en-CA');

  const overdueLoans = db
    .prepare(
      `
    SELECT lr.id, lr.end_date, lr.user_id, u.display_name
    FROM loan_requests lr
    JOIN users u ON lr.user_id = u.id
    WHERE lr.status = 'approved' AND lr.loan_type = 'temporary' AND lr.end_date IS NOT NULL AND lr.end_date < ?
  `,
    )
    .all(today);

  const dueSoonLoans = db
    .prepare(
      `
    SELECT lr.id, lr.end_date, lr.user_id, u.display_name
    FROM loan_requests lr
    JOIN users u ON lr.user_id = u.id
    WHERE lr.status = 'approved' AND lr.loan_type = 'temporary' AND lr.end_date = ?
  `,
    )
    .all(tomorrow);

  // Only admins trigger reminder notifications to avoid duplicate sends
  if (user.role === "admin") {
    const adminReminderTasks = [];

    // ⚡ Bolt: Batch fetch overdue loan items to prevent N+1 bottleneck
    const overdueLoanIds = overdueLoans.map((l) => l.id);
    const overdueItemsMap = new Map();
    if (overdueLoanIds.length > 0) {
      const allOverdueItems = db
        .prepare(
          `SELECT li.loan_request_id, li.quantity, si.item
           FROM loan_items li
           JOIN storage_items si ON li.item_id = si.id
           JOIN json_each(?) j ON li.loan_request_id = j.value`
        )
        .all(JSON.stringify(overdueLoanIds));
      for (const item of allOverdueItems) {
        if (!overdueItemsMap.has(item.loan_request_id)) {
          overdueItemsMap.set(item.loan_request_id, []);
        }
        overdueItemsMap.get(item.loan_request_id).push(item);
      }
    }

    for (const loan of overdueLoans) {
      const existing = db
        .prepare(
          "SELECT id FROM notifications WHERE user_id = ? AND message LIKE '%overdue%' AND message LIKE ? AND created_at >= date('now')",
        )
        .get(loan.user_id, `%#${loan.id}%`);
      if (!existing) {
        const loanItems = overdueItemsMap.get(loan.id) || [];
        const itemList = loanItems.map(i => `${i.item} × ${i.quantity}`).join(", ");
        db.prepare(
          "INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)",
        ).run(
          loan.user_id,
          `⚠️ Your loan #${loan.id} is OVERDUE! Please return items or contact an admin.\n\nItems: ${itemList}`,
          "/loans",
        );
        // Send email reminder
        const loanUser = db
          .prepare("SELECT email, display_name FROM users WHERE id = ?")
          .get(loan.user_id);
        if (loanUser?.email) {
          adminReminderTasks.push(
            sendOverdueEmail({
              to: loanUser.email,
              displayName: loanUser.display_name,
              loanId: loan.id,
              items: loanItems,
              endDate: loan.end_date,
            }).catch(() => {})
          );
        }
      }
    }

    // ⚡ Bolt: Batch fetch due soon loan items to prevent N+1 bottleneck
    const dueSoonLoanIds = dueSoonLoans.map((l) => l.id);
    const dueSoonItemsMap = new Map();
    if (dueSoonLoanIds.length > 0) {
      const allDueSoonItems = db
        .prepare(
          `SELECT li.loan_request_id, li.quantity, si.item
           FROM loan_items li
           JOIN storage_items si ON li.item_id = si.id
           JOIN json_each(?) j ON li.loan_request_id = j.value`
        )
        .all(JSON.stringify(dueSoonLoanIds));
      for (const item of allDueSoonItems) {
        if (!dueSoonItemsMap.has(item.loan_request_id)) {
          dueSoonItemsMap.set(item.loan_request_id, []);
        }
        dueSoonItemsMap.get(item.loan_request_id).push(item);
      }
    }

    for (const loan of dueSoonLoans) {
      const existing = db
        .prepare(
          "SELECT id FROM notifications WHERE user_id = ? AND message LIKE '%due tomorrow%' AND message LIKE ? AND created_at >= date('now')",
        )
        .get(loan.user_id, `%#${loan.id}%`);
      if (!existing) {
        const loanItems = dueSoonItemsMap.get(loan.id) || [];
        const itemList = loanItems.map(i => `${i.item} × ${i.quantity}`).join(", ");
        db.prepare(
          "INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)",
        ).run(
          loan.user_id,
          `⏰ Your loan #${loan.id} is due tomorrow! Please prepare to return items.\n\nItems: ${itemList}`,
          "/loans",
        );
        // Send email reminder
        const loanUser = db
          .prepare("SELECT email, display_name FROM users WHERE id = ?")
          .get(loan.user_id);
        if (loanUser?.email) {
          adminReminderTasks.push(
            sendDueSoonEmail({
              to: loanUser.email,
              displayName: loanUser.display_name,
              loanId: loan.id,
              items: loanItems,
              endDate: loan.end_date,
            }).catch(() => {})
          );
        }
      }
    }

    if (adminReminderTasks.length > 0) {
      await Promise.all(adminReminderTasks);
    }
  }

  // -- Chart Analytics Data --

  // 1. Loans over the past 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  // Using substr/date logic works mostly, but we can just group by substring if created_at is an ISO string
  const recentLoans = db.prepare(`
    SELECT substr(created_at, 1, 10) as day, COUNT(*) as count 
    FROM loan_requests 
    WHERE created_at >= ?
    GROUP BY day 
    ORDER BY day ASC
  `).all(thirtyDaysAgo);

  // Format into {date: 'Mar 10', loans: 5}
  const loansTrend = recentLoans.map(row => {
    const d = new Date(row.day);
    return {
      date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      loans: row.count
    };
  });

  // 2. Top 5 borrowed items
  const topItems = db.prepare(`
    SELECT si.item as name, SUM(li.quantity) as value
    FROM loan_items li
    JOIN storage_items si ON li.item_id = si.id
    GROUP BY li.item_id
    ORDER BY value DESC
    LIMIT 5
  `).all();

  // 3. Inventory distribution
  const inventoryDistribution = [
    { name: 'Available Storage', value: stats.totalCurrent },
    { name: 'Currently Loaned', value: stats.totalLoaned },
    { name: 'Perm Deployed', value: stats.deployedItems }
  ].filter(d => d.value > 0);

  // Recent activity feed
  const recentActivity = db.prepare(`
    SELECT af.*, u.display_name
    FROM activity_feed af
    JOIN users u ON af.user_id = u.id
    ORDER BY af.created_at DESC
    LIMIT 20
  `).all();

  return NextResponse.json({
    stats,
    activeLoans,
    overdueCount: overdueLoans.length,
    dueSoonCount: dueSoonLoans.length,
    charts: {
      loansTrend,
      topItems,
      inventoryDistribution
    },
    recentActivity
  });
}
