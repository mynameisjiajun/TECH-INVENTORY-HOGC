import { getDb, waitForSync, ensureUserExists, syncLoansToSheet, logActivity } from "@/lib/db/db";
import { getCurrentUser } from "@/lib/utils/auth";
import { sendOverdueEmail, sendDueSoonEmail } from "@/lib/services/email";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { NextResponse } from "next/server";

// GET: fetch loan requests
export async function GET(request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await waitForSync();
  const db = getDb();
  ensureUserExists(user);
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "";
  const view = searchParams.get("view") || "my"; // 'my' or 'all' (admin)
  const search = searchParams.get("search") || "";
  const dateFrom = searchParams.get("date_from") || "";
  const dateTo = searchParams.get("date_to") || "";

  let query = `
    SELECT lr.*, u.display_name as requester_name, u.username as requester_username
    FROM loan_requests lr
    JOIN users u ON lr.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (view !== "all" || user.role !== "admin") {
    query += " AND lr.user_id = ?";
    params.push(user.id);
  }
  if (status) {
    query += " AND lr.status = ?";
    params.push(status);
  }
  if (dateFrom) {
    query += " AND lr.start_date >= ?";
    params.push(dateFrom);
  }
  if (dateTo) {
    query += " AND lr.start_date <= ?";
    params.push(dateTo);
  }
  query += " ORDER BY lr.created_at DESC";

  let loans = db.prepare(query).all(...params);

  // Batch-load items for all loans in a single query
  if (loans.length > 0) {
    const loanIds = loans.map((l) => l.id);
    const allItems = db
      .prepare(
        `
      SELECT li.*, si.item, si.type, si.brand, si.model
      FROM loan_items li
      JOIN storage_items si ON li.item_id = si.id
      JOIN json_each(?) j ON li.loan_request_id = j.value
    `,
      )
      .all(JSON.stringify(loanIds));
    const itemsByLoan = new Map();
    for (const item of allItems) {
      if (!itemsByLoan.has(item.loan_request_id))
        itemsByLoan.set(item.loan_request_id, []);
      itemsByLoan.get(item.loan_request_id).push(item);
    }
    for (const loan of loans) {
      loan.items = itemsByLoan.get(loan.id) || [];
    }
  } else {
    for (const loan of loans) loan.items = [];
  }

  // Filter by item name or purpose in JS
  if (search) {
    const s = search.toLowerCase();
    loans = loans.filter(
      (loan) =>
        loan.purpose.toLowerCase().includes(s) ||
        loan.items.some((item) => item.item.toLowerCase().includes(s)),
    );
  }

  // ── Overdue / due-soon notification check ──────────────────────────
  // Runs on every user page-load; deduped to one notification per loan per day.
  try {
    const now = new Date();
    // Use local timezone for exact day boundaries
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toLocaleDateString('en-CA');
    const tomorrowObj = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tomorrow = tomorrowObj.toLocaleDateString('en-CA');

    // Overdue loans for the current user
    const overdueLoans = db
      .prepare(
        `SELECT lr.id, lr.end_date FROM loan_requests lr
         WHERE lr.user_id = ? AND lr.status = 'approved'
           AND lr.loan_type = 'temporary' AND lr.end_date IS NOT NULL
           AND lr.end_date < ?`,
      )
      .all(user.id, today);

    // Loans due tomorrow for the current user
    const dueSoonLoans = db
      .prepare(
        `SELECT lr.id, lr.end_date FROM loan_requests lr
         WHERE lr.user_id = ? AND lr.status = 'approved'
           AND lr.loan_type = 'temporary' AND lr.end_date = ?`,
      )
      .all(user.id, tomorrow);

    const userEmail = db
      .prepare("SELECT email, display_name FROM users WHERE id = ?")
      .get(user.id);

    const backgroundTasks = [];

    for (const loan of overdueLoans) {
      const existing = db
        .prepare(
          "SELECT id FROM notifications WHERE user_id = ? AND message LIKE '%overdue%' AND message LIKE ? AND created_at >= ?",
        )
        .get(user.id, `%#${loan.id}%`, today);
      if (!existing) {
        const loanItems = db
          .prepare(
            `SELECT li.quantity, si.item FROM loan_items li
             JOIN storage_items si ON li.item_id = si.id
             WHERE li.loan_request_id = ?`,
          )
          .all(loan.id);
        const itemList = loanItems.map(i => `${i.item} × ${i.quantity}`).join(", ");
        db.prepare(
          "INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)",
        ).run(
          user.id,
          `⚠️ Your loan #${loan.id} is OVERDUE! Please return items or contact an admin.\n\nItems: ${itemList}`,
          "/loans",
        );
        if (userEmail?.email) {
          backgroundTasks.push(
            sendOverdueEmail({
              to: userEmail.email,
              displayName: userEmail.display_name,
              loanId: loan.id,
              items: loanItems,
              endDate: loan.end_date,
            }).catch(() => {})
          );
        }
        backgroundTasks.push(
          sendTelegramMessage(
            user.id,
            `⚠️ <b>OVERDUE LOAN</b>\nYour loan #${loan.id} is overdue! Please return your items.\n\nItems: ${itemList}`
          )
        );
      }
    }

    for (const loan of dueSoonLoans) {
      const existing = db
        .prepare(
          "SELECT id FROM notifications WHERE user_id = ? AND message LIKE '%due tomorrow%' AND message LIKE ? AND created_at >= ?",
        )
        .get(user.id, `%#${loan.id}%`, today);
      if (!existing) {
        const loanItems = db
          .prepare(
            `SELECT li.quantity, si.item FROM loan_items li
             JOIN storage_items si ON li.item_id = si.id
             WHERE li.loan_request_id = ?`,
          )
          .all(loan.id);
        const itemList = loanItems.map(i => `${i.item} × ${i.quantity}`).join(", ");
        db.prepare(
          "INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)",
        ).run(
          user.id,
          `⏰ Your loan #${loan.id} is due tomorrow! Please prepare to return items.\n\nItems: ${itemList}`,
          "/loans",
        );
        if (userEmail?.email) {
          backgroundTasks.push(
            sendDueSoonEmail({
              to: userEmail.email,
              displayName: userEmail.display_name,
              loanId: loan.id,
              items: loanItems,
              endDate: loan.end_date,
            }).catch(() => {})
          );
        }
        backgroundTasks.push(
          sendTelegramMessage(
            user.id,
            `⏰ <b>Due Tomorrow</b>\nYour loan #${loan.id} is due tomorrow.\n\nItems: ${itemList}`
          )
        );
      }
    }

    if (backgroundTasks.length > 0) {
      await Promise.all(backgroundTasks);
    }
  } catch (err) {
    // Non-blocking — don't let notification errors break the loans page
    console.error("Overdue notification check failed:", err.message);
  }

  return NextResponse.json({ loans });
}

// POST: create a new loan request
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const {
      loan_type,
      purpose,
      department,
      start_date,
      end_date,
      location,
      items,
    } = await request.json();

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "No items selected" }, { status: 400 });
    }
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
    if (!purpose || !purpose.trim()) {
      return NextResponse.json(
        { error: "Purpose is required" },
        { status: 400 },
      );
    }
    if (!start_date) {
      return NextResponse.json(
        { error: "Start date is required" },
        { status: 400 },
      );
    }
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

    await waitForSync();
    const db = getDb();
    ensureUserExists(user);

    const createLoanTx = db.transaction(() => {
      // ⚡ Optimized: Gather item IDs and fetch them in a single query to avoid N+1 queries.
      // Using JOIN with json_each instead of an IN clause to avoid SQLite parameter limits on serverless environments.
      const itemIds = items.map(item => item.item_id);
      const storageItems = db
        .prepare(`
          SELECT si.*
          FROM storage_items si
          JOIN json_each(?) j ON si.id = j.value
        `)
        .all(JSON.stringify(itemIds));

      const storageItemMap = new Map();
      for (const si of storageItems) {
        storageItemMap.set(si.id, si);
      }

      for (const item of items) {
        const storageItem = storageItemMap.get(item.item_id);
        if (!storageItem) {
          throw new Error(`Item not found: ${item.item_id}`);
        }
        if (storageItem.current < item.quantity) {
          throw new Error(
            `Not enough stock for "${storageItem.item}". Available: ${storageItem.current}, Requested: ${item.quantity}`,
          );
        }
      }

      const result = db
        .prepare(
          `
        INSERT INTO loan_requests (user_id, loan_type, purpose, department, location, start_date, end_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
        )
        .run(
          user.id,
          loan_type,
          purpose.trim(),
          department || "",
          location || "",
          start_date,
          end_date || null,
        );

      const loanId = result.lastInsertRowid;

      const insertItem = db.prepare(
        "INSERT INTO loan_items (loan_request_id, item_id, quantity) VALUES (?, ?, ?)",
      );
      for (const item of items) {
        insertItem.run(loanId, item.item_id, item.quantity);
      }

      const admins = db
        .prepare("SELECT id FROM users WHERE role = ?")
        .all("admin");
      const insertNotif = db.prepare(
        "INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)",
      );
      for (const admin of admins) {
        insertNotif.run(
          admin.id,
          `New ${loan_type} loan request from ${user.display_name}`,
          "/admin",
        );
      }

      return loanId;
    });

    try {
      const loanId = createLoanTx();
      await syncLoansToSheet();
      logActivity(db, user.id, "request", `${user.display_name || user.username} submitted a new ${loan_type || "temporary"} loan request #${loanId}`);
      return NextResponse.json({
        loan_id: loanId,
        message: "Loan request submitted!",
      });
    } catch (txErr) {
      return NextResponse.json({ error: txErr.message }, { status: 400 });
    }
  } catch (error) {
    console.error("Loan creation error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
