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

  // Determine if due-soon reminders should fire based on configured SGT time window
  // Overdue alerts are always sent regardless of time.
  const sgt = new Date(now.getTime() + 8 * 60 * 60 * 1000); // UTC+8
  const sgtDay = sgt.getUTCDay(); // 0=Sun, 1-5=Mon-Fri, 6=Sat
  const dayKey = sgtDay === 0 ? "reminder_sunday" : sgtDay === 6 ? "reminder_saturday" : "reminder_weekday";

  const { data: reminderSettings } = await supabase
    .from("app_settings")
    .select("key, value")
    .in("key", ["reminder_weekday", "reminder_saturday", "reminder_sunday"]);

  const settingsMap = Object.fromEntries((reminderSettings || []).map((s) => [s.key, s.value]));
  const configuredTime = settingsMap[dayKey] || null;

  let sendDueSoon = true;
  if (configuredTime) {
    const [cfgH, cfgM] = configuredTime.split(":").map(Number);
    const cfgMinutes = cfgH * 60 + cfgM;
    const nowMinutes = sgt.getUTCHours() * 60 + sgt.getUTCMinutes();
    // Only send if within ±30 minutes of the configured time
    if (Math.abs(nowMinutes - cfgMinutes) > 30) {
      sendDueSoon = false;
    }
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    .toLocaleDateString("en-CA");
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
    .toLocaleDateString("en-CA");

  // Always fetch overdue; only fetch due-soon if within the time window
  const [
    { data: overdueLoans },
    { data: dueSoonLoans },
    { data: overdueLaptopLoans },
    { data: dueSoonLaptopLoans },
  ] = await Promise.all([
    supabase.from("loan_requests").select("id, end_date, user_id, loan_type")
      .eq("status", "approved").eq("loan_type", "temporary").not("end_date", "is", null).lt("end_date", today),
    sendDueSoon
      ? supabase.from("loan_requests").select("id, end_date, user_id, loan_type")
          .eq("status", "approved").eq("loan_type", "temporary").eq("end_date", tomorrow)
      : Promise.resolve({ data: [] }),
    supabase.from("laptop_loan_requests").select("id, end_date, user_id, loan_type")
      .eq("status", "approved").eq("loan_type", "temporary").not("end_date", "is", null).lt("end_date", today),
    sendDueSoon
      ? supabase.from("laptop_loan_requests").select("id, end_date, user_id, loan_type")
          .eq("status", "approved").eq("loan_type", "temporary").eq("end_date", tomorrow)
      : Promise.resolve({ data: [] }),
  ]);

  const allTechLoanIds = [
    ...(overdueLoans || []).map((l) => l.id),
    ...(dueSoonLoans || []).map((l) => l.id),
  ];
  const allLaptopLoanIds = [
    ...(overdueLaptopLoans || []).map((l) => l.id),
    ...(dueSoonLaptopLoans || []).map((l) => l.id),
  ];

  if (allTechLoanIds.length === 0 && allLaptopLoanIds.length === 0) {
    return NextResponse.json({ overdueNotified: 0, dueSoonNotified: 0, dueSoonSkipped: !sendDueSoon });
  }

  // Batch fetch items and users
  const allUserIds = [...new Set([
    ...(overdueLoans || []).map((l) => l.user_id),
    ...(dueSoonLoans || []).map((l) => l.user_id),
    ...(overdueLaptopLoans || []).map((l) => l.user_id),
    ...(dueSoonLaptopLoans || []).map((l) => l.user_id),
  ])];

  const [{ data: allItems }, { data: laptopItems }, { data: allUsers }, { data: todayNotifs }] = await Promise.all([
    allTechLoanIds.length > 0
      ? supabase.from("loan_items").select("loan_request_id, item_name, quantity").in("loan_request_id", allTechLoanIds)
      : Promise.resolve({ data: [] }),
    allLaptopLoanIds.length > 0
      ? supabase.from("laptop_loan_items").select("loan_request_id, laptops(name)").in("loan_request_id", allLaptopLoanIds)
      : Promise.resolve({ data: [] }),
    supabase.from("users").select("id, email, display_name, mute_emails, mute_telegram").in("id", allUserIds),
    supabase.from("notifications").select("user_id, message").in("user_id", allUserIds).gte("created_at", today),
  ]);

  const itemsByLoan = new Map();
  for (const item of allItems || []) {
    if (!itemsByLoan.has(item.loan_request_id)) itemsByLoan.set(item.loan_request_id, []);
    itemsByLoan.get(item.loan_request_id).push(item);
  }
  const laptopsByLoan = new Map();
  for (const item of laptopItems || []) {
    if (!laptopsByLoan.has(item.loan_request_id)) laptopsByLoan.set(item.loan_request_id, []);
    laptopsByLoan.get(item.loan_request_id).push(item.laptops?.name || "Laptop");
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

  // Tech loan overdue
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

    if (loanUser?.email && !loanUser?.mute_emails) {
      emailTasks.push(sendOverdueEmail({ to: loanUser.email, displayName: loanUser.display_name, loanId: loan.id, items: loanItems.map((i) => ({ item: i.item_name, quantity: i.quantity })), endDate: loan.end_date }).catch(() => {}));
    }
    if (!loanUser?.mute_telegram) {
      telegramTasks.push(sendTelegramMessage(loan.user_id, `🚨 <b>Loan Overdue</b>\nYour loan #${loan.id} is OVERDUE!\n\nItems: ${itemList}\n\nPlease return items or contact an admin.`).catch(() => {}));
    }
    overdueNotified++;
  }

  // Laptop loan overdue
  for (const loan of overdueLaptopLoans || []) {
    if (alreadyNotifiedOverdue.has(loan.id)) continue;
    const loanUser = userMap.get(loan.user_id);
    const laptopList = (laptopsByLoan.get(loan.id) || []).join(", ") || "Laptops";

    notifInserts.push({
      user_id: loan.user_id,
      message: `⚠️ Your laptop loan #${loan.id} is OVERDUE! Please return laptops or contact an admin.\n\nLaptops: ${laptopList}`,
      link: "/loans",
    });

    if (loanUser?.email && !loanUser?.mute_emails) {
      emailTasks.push(sendOverdueEmail({ to: loanUser.email, displayName: loanUser.display_name, loanId: loan.id, items: (laptopsByLoan.get(loan.id) || []).map((n) => ({ item: n, quantity: 1 })), endDate: loan.end_date }).catch(() => {}));
    }
    if (!loanUser?.mute_telegram) {
      telegramTasks.push(sendTelegramMessage(loan.user_id, `🚨 <b>Laptop Loan Overdue</b>\nYour laptop loan #${loan.id} is OVERDUE!\n\nLaptops: ${laptopList}\n\nPlease return them or contact an admin.`).catch(() => {}));
    }
    overdueNotified++;
  }

  // Tech loan due soon
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

    if (loanUser?.email && !loanUser?.mute_emails) {
      emailTasks.push(sendDueSoonEmail({ to: loanUser.email, displayName: loanUser.display_name, loanId: loan.id, items: loanItems.map((i) => ({ item: i.item_name, quantity: i.quantity })), endDate: loan.end_date }).catch(() => {}));
    }
    if (!loanUser?.mute_telegram) {
      telegramTasks.push(sendTelegramMessage(loan.user_id, `⏰ <b>Due Tomorrow</b>\nYour loan #${loan.id} is due tomorrow!\n\nItems: ${itemList}\n\nPlease prepare to return items.`).catch(() => {}));
    }
    dueSoonNotified++;
  }

  // Laptop loan due soon
  for (const loan of dueSoonLaptopLoans || []) {
    if (alreadyNotifiedDueSoon.has(loan.id)) continue;
    const loanUser = userMap.get(loan.user_id);
    const laptopList = (laptopsByLoan.get(loan.id) || []).join(", ") || "Laptops";

    notifInserts.push({
      user_id: loan.user_id,
      message: `⏰ Your laptop loan #${loan.id} is due tomorrow! Please prepare to return laptops.\n\nLaptops: ${laptopList}`,
      link: "/loans",
    });

    if (loanUser?.email && !loanUser?.mute_emails) {
      emailTasks.push(sendDueSoonEmail({ to: loanUser.email, displayName: loanUser.display_name, loanId: loan.id, items: (laptopsByLoan.get(loan.id) || []).map((n) => ({ item: n, quantity: 1 })), endDate: loan.end_date }).catch(() => {}));
    }
    if (!loanUser?.mute_telegram) {
      telegramTasks.push(sendTelegramMessage(loan.user_id, `⏰ <b>Laptop Due Tomorrow</b>\nYour laptop loan #${loan.id} is due tomorrow!\n\nLaptops: ${laptopList}\n\nPlease prepare to return them.`).catch(() => {}));
    }
    dueSoonNotified++;
  }

  // Batch insert all notifications and fire emails + telegrams in parallel
  await Promise.all([
    notifInserts.length > 0 ? supabase.from("notifications").insert(notifInserts) : Promise.resolve(),
    ...emailTasks,
    ...telegramTasks,
  ]);

  return NextResponse.json({ overdueNotified, dueSoonNotified, dueSoonSkipped: !sendDueSoon });
}
