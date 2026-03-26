import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { fmtDate, fmtDatetime } from "@/lib/laptops";
export async function GET(request) {
  const secret = request.headers.get("x-cron-secret");
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sgt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const today = sgt.toISOString().slice(0, 10);

  const { data: loans } = await supabase
    .from("laptop_loans")
    .select("id, laptop_id, end_date, end_datetime, user_id, reminder_sent, overdue_notified")
    .eq("status", "active")
    .lte("end_date", today);

  if (!loans?.length) {
    return NextResponse.json({ ok: true, checked: 0, reminders: 0, overdueNotified: 0 });
  }

  const byUser = new Map();
  for (const loan of loans) {
    const isDueToday = loan.end_date === today && !loan.reminder_sent;
    const isOverdue = loan.end_date < today && !loan.overdue_notified;
    if (!isDueToday && !isOverdue) continue;
    if (!byUser.has(loan.user_id)) byUser.set(loan.user_id, { dueToday: [], overdue: [] });
    const g = byUser.get(loan.user_id);
    if (isDueToday) g.dueToday.push(loan);
    else g.overdue.push(loan);
  }

  const tasks = [];
  const reminderIds = [];
  const overdueIds = [];

  for (const [userId, { dueToday, overdue }] of byUser) {
    const lines = [];

    if (dueToday.length) {
      lines.push(`⏰ <b>Due Today</b>`);
      for (const loan of dueToday) {
        const end = loan.end_datetime ? fmtDatetime(loan.end_datetime) : fmtDate(loan.end_date);
        lines.push(`• <b>${loan.laptop_id}</b> — due ${end}`);
        reminderIds.push(loan.id);
      }
    }

    if (overdue.length) {
      if (lines.length) lines.push(``);
      lines.push(`🚨 <b>Overdue</b>`);
      for (const loan of overdue) {
        const end = loan.end_datetime ? fmtDatetime(loan.end_datetime) : fmtDate(loan.end_date);
        lines.push(`• <b>${loan.laptop_id}</b> — was due ${end}`);
        overdueIds.push(loan.id);
      }
    }

    lines.push(``, `Please return the laptop(s) with cable and charger. Thank you!`);
    tasks.push(sendTelegramMessage(userId, lines.join("\n")).catch(() => {}));
  }

  await Promise.all([
    ...tasks,
    reminderIds.length
      ? supabase.from("laptop_loans").update({ reminder_sent: true }).in("id", reminderIds)
      : Promise.resolve(),
    overdueIds.length
      ? supabase.from("laptop_loans").update({ overdue_notified: true }).in("id", overdueIds)
      : Promise.resolve(),
  ]);

  return NextResponse.json({
    ok: true,
    checked: loans.length,
    reminders: reminderIds.length,
    overdueNotified: overdueIds.length,
  });
}
