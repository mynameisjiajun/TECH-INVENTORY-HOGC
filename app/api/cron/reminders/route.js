import { supabase } from "@/lib/db/supabase";
import { sendOverdueEmail, sendDueSoonEmail } from "@/lib/services/email";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { NextResponse } from "next/server";

/**
 * GET /api/cron/reminders
 * Called by cron-job.org (or any scheduler) once per day.
 * Sends overdue and due-soon reminders via email + Telegram.
 * Protected by CRON_SECRET header.
 */
export async function GET(request) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    .toLocaleDateString("en-CA");
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    .toLocaleDateString("en-CA");

  // Fetch overdue and due-soon loans in parallel
  const [{ data: overdueLoans }, { data: dueSoonLoans }] = await Promise.all([
    supabase
      .from("loan_requests")
      .select("id, end_date, user_id, loan_type")
      .eq("status", "approved")
      .eq("loan_type", "temporary")
      .not("end_date", "is", null)
      .lt("end_date", today),
    supabase
      .from("loan_requests")
      .select("id, end_date, user_id, loan_type")
      .eq("status", "approved")
      .eq("loan_type", "temporary")
      .eq("end_date", tomorrow),
  ]);

  const allLoanIds = [
    ...(overdueLoans || []).map((l) => l.id),
    ...(dueSoonLoans || []).map((l) => l.id),
  ];

  if (allLoanIds.length === 0) {
    return NextResponse.json({ overdueNotified: 0, dueSoonNotified: 0 });
  }

  // Batch fetch items and users
  const allUserIds = [...new Set([
    ...(overdueLoans || []).map((l) => l.user_id),
    ...(dueSoonLoans || []).map((l) => l.user_id),
  ])];

  const [{ data: allItems }, { data: allUsers }, { data: todayNotifs }] = await Promise.all([
    supabase
      .from("loan_items")
      .select("loan_request_id, item_name, quantity")
      .in("loan_request_id", allLoanIds),
    supabase
      .from("users")
      .select("id, email, display_name, telegram_chat_id")
      .in("id", allUserIds),
    supabase
      .from("notifications")
      .select("user_id, message")
      .in("user_id", allUserIds)
      .gte("created_at", today),
  ]);

  const itemsByLoan = new Map();
  for (const item of allItems || []) {
    if (!itemsByLoan.has(item.loan_request_id)) itemsByLoan.set(item.loan_request_id, []);
    itemsByLoan.get(item.loan_request_id).push(item);
  }

  const userMap = new Map((allUsers || []).map((u) => [u.id, u]));

  // Build a set of already-notified loan ids today (to avoid duplicates)
  const alreadyNotifiedOverdue = new Set();
  const alreadyNotifiedDueSoon = new Set();
  for (const n of todayNotifs || []) {
    const overdueMatch = n.message.match(/loan #(\d+) is OVERDUE/);
    const dueSoonMatch = n.message.match(/loan #(\d+) is due tomorrow/);
    if (overdueMatch) alreadyNotifiedOverdue.add(parseInt(overdueMatch[1]));
    if (dueSoonMatch) alreadyNotifiedDueSoon.add(parseInt(dueSoonMatch[1]));
  }

  let overdueNotified = 0;
  let dueSoonNotified = 0;

  const notifInserts = [];
  const emailTasks = [];
  const telegramTasks = [];

  for (const loan of overdueLoans || []) {
    if (alreadyNotifiedOverdue.has(loan.id)) continue;
    const loanUser = userMap.get(loan.user_id);
    const loanItems = itemsByLoan.get(loan.id) || [];
    const itemList = loanItems.map((i) => `${i.item_name} × ${i.quantity}`).join(", ");

    notifInserts.push({
      user_id: loan.user_id,
      message: `⚠️ Your loan #${loan.id} is OVERDUE! Please return items or contact an admin.\n\nItems: ${itemList}`,
      link: "/loans",
    });

    if (loanUser?.email) {
      emailTasks.push(
        sendOverdueEmail({
          to: loanUser.email,
          displayName: loanUser.display_name,
          loanId: loan.id,
          items: loanItems.map((i) => ({ item: i.item_name, quantity: i.quantity })),
          endDate: loan.end_date,
        }).catch(() => {})
      );
    }

    telegramTasks.push(
      sendTelegramMessage(
        loan.user_id,
        `🚨 <b>Loan Overdue</b>\nYour loan #${loan.id} is OVERDUE!\n\nItems: ${itemList}\n\nPlease return items or contact an admin.`,
        loanUser?.telegram_chat_id,
      ).catch(() => {})
    );

    overdueNotified++;
  }

  for (const loan of dueSoonLoans || []) {
    if (alreadyNotifiedDueSoon.has(loan.id)) continue;
    const loanUser = userMap.get(loan.user_id);
    const loanItems = itemsByLoan.get(loan.id) || [];
    const itemList = loanItems.map((i) => `${i.item_name} × ${i.quantity}`).join(", ");

    notifInserts.push({
      user_id: loan.user_id,
      message: `⏰ Your loan #${loan.id} is due tomorrow! Please prepare to return items.\n\nItems: ${itemList}`,
      link: "/loans",
    });

    if (loanUser?.email) {
      emailTasks.push(
        sendDueSoonEmail({
          to: loanUser.email,
          displayName: loanUser.display_name,
          loanId: loan.id,
          items: loanItems.map((i) => ({ item: i.item_name, quantity: i.quantity })),
          endDate: loan.end_date,
        }).catch(() => {})
      );
    }

    telegramTasks.push(
      sendTelegramMessage(
        loan.user_id,
        `⏰ <b>Due Tomorrow</b>\nYour loan #${loan.id} is due tomorrow!\n\nItems: ${itemList}\n\nPlease prepare to return items.`,
        loanUser?.telegram_chat_id,
      ).catch(() => {})
    );

    dueSoonNotified++;
  }

  // Batch insert all notifications and fire emails + telegrams in parallel
  await Promise.all([
    notifInserts.length > 0 ? supabase.from("notifications").insert(notifInserts) : Promise.resolve(),
    ...emailTasks,
    ...telegramTasks,
  ]);

  return NextResponse.json({ overdueNotified, dueSoonNotified });
}
