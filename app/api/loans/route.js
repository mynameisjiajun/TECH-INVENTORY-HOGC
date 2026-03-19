import { getDb, waitForSync } from "@/lib/db/db";
import { supabase } from "@/lib/db/supabase";
import { getCurrentUser } from "@/lib/utils/auth";
import {
  sendOverdueEmail,
  sendDueSoonEmail,
  sendNewLoanUserEmail,
  sendNewLoanAdminEmails,
} from "@/lib/services/email";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { NextResponse } from "next/server";

// GET: fetch loan requests
export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "";
  const view = searchParams.get("view") || "my";
  const search = searchParams.get("search") || "";
  const dateFrom = searchParams.get("date_from") || "";
  const dateTo = searchParams.get("date_to") || "";

  // Build query for loan_requests
  let query = supabase
    .from("loan_requests")
    .select(`
      *,
      users (display_name, username)
    `)
    .order("created_at", { ascending: false });

  if (view !== "all" || user.role !== "admin") {
    query = query.eq("user_id", user.id);
  }
  if (status) query = query.eq("status", status);
  if (dateFrom) query = query.gte("start_date", dateFrom);
  if (dateTo) query = query.lte("start_date", dateTo);

  const { data: loanRows } = await query;
  let loans = (loanRows || []).map((lr) => ({
    ...lr,
    requester_name: lr.users?.display_name || null,
    requester_username: lr.users?.username || null,
    users: undefined,
    items: [],
  }));

  // Batch-load items for all loans
  if (loans.length > 0) {
    const loanIds = loans.map((l) => l.id);
    const { data: allItems } = await supabase
      .from("loan_items")
      .select("*")
      .in("loan_request_id", loanIds);

    const itemsByLoan = new Map();
    for (const item of allItems || []) {
      if (!itemsByLoan.has(item.loan_request_id)) itemsByLoan.set(item.loan_request_id, []);
      // Expose item_name as "item" to match the original shape the frontend expects
      itemsByLoan.get(item.loan_request_id).push({ ...item, item: item.item_name });
    }
    for (const loan of loans) {
      loan.items = itemsByLoan.get(loan.id) || [];
    }
  }

  // Filter by search
  if (search) {
    const s = search.toLowerCase();
    loans = loans.filter(
      (loan) =>
        loan.purpose?.toLowerCase().includes(s) ||
        loan.items.some((item) => item.item?.toLowerCase().includes(s)),
    );
  }

  // ── Overdue / due-soon notification check ──────────────────────────
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toLocaleDateString("en-CA");
    const tomorrowObj = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tomorrow = tomorrowObj.toLocaleDateString("en-CA");

    const [{ data: overdueLoans }, { data: dueSoonLoans }, { data: userRecord }] = await Promise.all([
      supabase
        .from("loan_requests")
        .select("id, end_date")
        .eq("user_id", user.id)
        .eq("status", "approved")
        .eq("loan_type", "temporary")
        .not("end_date", "is", null)
        .lt("end_date", today),
      supabase
        .from("loan_requests")
        .select("id, end_date")
        .eq("user_id", user.id)
        .eq("status", "approved")
        .eq("loan_type", "temporary")
        .eq("end_date", tomorrow),
      supabase
        .from("users")
        .select("email, display_name, telegram_chat_id")
        .eq("id", user.id)
        .single(),
    ]);

    const backgroundTasks = [];

    await Promise.all([
      ...(overdueLoans || []).map(async (loan) => {
        const { data: existing } = await supabase
          .from("notifications")
          .select("id")
          .eq("user_id", user.id)
          .ilike("message", "%overdue%")
          .ilike("message", `%#${loan.id}%`)
          .gte("created_at", today)
          .single();

        if (!existing) {
          const { data: loanItems } = await supabase
            .from("loan_items")
            .select("item_name, quantity")
            .eq("loan_request_id", loan.id);

          const itemList = (loanItems || []).map((i) => `${i.item_name} × ${i.quantity}`).join(", ");

          await supabase.from("notifications").insert({
            user_id: user.id,
            message: `⚠️ Your loan #${loan.id} is OVERDUE! Please return items or contact an admin.\n\nItems: ${itemList}`,
            link: "/loans",
          });

          if (userRecord?.email) {
            backgroundTasks.push(
              sendOverdueEmail({
                to: userRecord.email,
                displayName: userRecord.display_name,
                loanId: loan.id,
                items: (loanItems || []).map((i) => ({ item: i.item_name, quantity: i.quantity })),
                endDate: loan.end_date,
              }).catch(() => {}),
            );
          }
          backgroundTasks.push(
            sendTelegramMessage(
              user.id,
              `⚠️ <b>OVERDUE LOAN</b>\nYour loan #${loan.id} is overdue! Please return your items.\n\nItems: ${itemList}`,
              userRecord?.telegram_chat_id,
            ),
          );
        }
      }),
      ...(dueSoonLoans || []).map(async (loan) => {
        const { data: existing } = await supabase
          .from("notifications")
          .select("id")
          .eq("user_id", user.id)
          .ilike("message", "%due tomorrow%")
          .ilike("message", `%#${loan.id}%`)
          .gte("created_at", today)
          .single();

        if (!existing) {
          const { data: loanItems } = await supabase
            .from("loan_items")
            .select("item_name, quantity")
            .eq("loan_request_id", loan.id);

          const itemList = (loanItems || []).map((i) => `${i.item_name} × ${i.quantity}`).join(", ");

          await supabase.from("notifications").insert({
            user_id: user.id,
            message: `⏰ Your loan #${loan.id} is due tomorrow! Please prepare to return items.\n\nItems: ${itemList}`,
            link: "/loans",
          });

          if (userRecord?.email) {
            backgroundTasks.push(
              sendDueSoonEmail({
                to: userRecord.email,
                displayName: userRecord.display_name,
                loanId: loan.id,
                items: (loanItems || []).map((i) => ({ item: i.item_name, quantity: i.quantity })),
                endDate: loan.end_date,
              }).catch(() => {}),
            );
          }
          backgroundTasks.push(
            sendTelegramMessage(
              user.id,
              `⏰ <b>Due Tomorrow</b>\nYour loan #${loan.id} is due tomorrow.\n\nItems: ${itemList}`,
              userRecord?.telegram_chat_id,
            ),
          );
        }
      }),
    ]);

    if (backgroundTasks.length > 0) await Promise.all(backgroundTasks);
  } catch (err) {
    console.error("Overdue notification check failed:", err.message);
  }

  return NextResponse.json({ loans }, {
    headers: { "Cache-Control": "private, s-maxage=5, stale-while-revalidate=15" },
  });
}

// POST: create a new loan request
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { loan_type, purpose, department, start_date, end_date, location, items } =
      await request.json();

    if (!items || items.length === 0) {
      return NextResponse.json({ error: "No items selected" }, { status: 400 });
    }
    for (const item of items) {
      if (!item.quantity || item.quantity < 1 || !Number.isInteger(item.quantity)) {
        return NextResponse.json(
          { error: "Each item must have a quantity of at least 1" },
          { status: 400 },
        );
      }
    }
    if (!purpose || !purpose.trim()) {
      return NextResponse.json({ error: "Purpose is required" }, { status: 400 });
    }
    if (!start_date) {
      return NextResponse.json({ error: "Start date is required" }, { status: 400 });
    }
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

    // Inventory validation + name lookup from SQLite
    await waitForSync();
    const db = getDb();

    const resolvedItems = [];
    for (const item of items) {
      const storageItem = db.prepare("SELECT * FROM storage_items WHERE id = ?").get(item.item_id);
      if (!storageItem) {
        return NextResponse.json({ error: `Item not found: ${item.item_id}` }, { status: 400 });
      }
      if (storageItem.current < item.quantity) {
        return NextResponse.json(
          {
            error: `Not enough stock for "${storageItem.item}". Available: ${storageItem.current}, Requested: ${item.quantity}`,
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

    // Create loan request in Supabase
    const { data: newLoan, error: loanError } = await supabase
      .from("loan_requests")
      .insert({
        user_id: user.id,
        loan_type,
        purpose: purpose.trim(),
        department: department || "",
        location: location || "",
        start_date,
        end_date: end_date || null,
      })
      .select("id")
      .single();

    if (loanError) throw loanError;
    const loanId = newLoan.id;

    // Insert loan items with item_name + sheet_row for stability
    await supabase.from("loan_items").insert(
      resolvedItems.map((i) => ({
        loan_request_id: loanId,
        item_id: i.item_id,
        sheet_row: i.sheet_row,
        item_name: i.item_name,
        quantity: i.quantity,
      })),
    );

    // Notify admins
    const { data: admins } = await supabase
      .from("users")
      .select("id, email, display_name")
      .eq("role", "admin");

    if (admins && admins.length > 0) {
      await supabase.from("notifications").insert(
        admins.map((admin) => ({
          user_id: admin.id,
          message: `New ${loan_type} loan request from ${user.display_name}`,
          link: "/admin",
        })),
      );
    }

    // Fire-and-forget: emails + telegram
    try {
      const { data: userRecord } = await supabase
        .from("users")
        .select("email")
        .eq("id", user.id)
        .single();

      const itemListStr = resolvedItems.map((i) => `${i.item_name} × ${i.quantity}`).join(", ");
      const itemsForEmail = resolvedItems.map((i) => ({ item: i.item_name, quantity: i.quantity }));

      if (userRecord?.email) {
        sendNewLoanUserEmail({
          to: userRecord.email,
          displayName: user.display_name || user.username,
          loanId,
          loanType: loan_type,
          purpose,
          items: itemsForEmail,
        }).catch(() => {});
      }

      sendNewLoanAdminEmails({
        admins: admins || [],
        userName: user.display_name || user.username,
        loanId,
        loanType: loan_type,
        purpose,
        items: itemsForEmail,
      }).catch(() => {});

      for (const admin of admins || []) {
        sendTelegramMessage(
          admin.id,
          `🔔 <b>New Loan Request</b>\n<b>${user.display_name || user.username}</b> requested a <b>${loan_type}</b> loan.\n\nPurpose: ${purpose}\nItems: ${itemListStr}`,
        ).catch(() => {});
      }
    } catch (notifErr) {
      console.error("Failed to send loan creation notifications:", notifErr);
    }

    return NextResponse.json({ loan_id: loanId, message: "Loan request submitted!" });
  } catch (error) {
    console.error("Loan creation error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
