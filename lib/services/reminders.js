import { supabase } from "@/lib/db/supabase";
import {
  sendDueSoonEmail,
  sendLaptopAvailableEmail,
  sendOverdueEmail,
} from "@/lib/services/email";
import { sendTelegramMessage } from "@/lib/services/telegram";
import { getAppSettings } from "@/lib/utils/appSettings";
import { formatDateInTimeZone } from "@/lib/utils/date";

export async function runReminderJobs(now = new Date()) {
  const sgt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const sgtDay = sgt.getUTCDay();
  const dayKey =
    sgtDay === 0
      ? "reminder_sunday"
      : sgtDay === 6
        ? "reminder_saturday"
        : "reminder_weekday";

  const settingsMap = await getAppSettings([
    "reminder_weekday",
    "reminder_saturday",
    "reminder_sunday",
  ]);
  const configuredTime = settingsMap[dayKey] || null;

  let sendDueSoon = true;
  if (configuredTime) {
    const [cfgH, cfgM] = configuredTime.split(":").map(Number);
    const cfgMinutes = cfgH * 60 + cfgM;
    const nowMinutes = sgt.getUTCHours() * 60 + sgt.getUTCMinutes();
    if (Math.abs(nowMinutes - cfgMinutes) > 30) {
      sendDueSoon = false;
    }
  }

  const today = formatDateInTimeZone(now);
  const tomorrow = formatDateInTimeZone(
    new Date(now.getTime() + 24 * 60 * 60 * 1000),
  );

  const [
    { data: overdueLoans },
    { data: dueSoonLoans },
    { data: overdueLaptopLoans },
    { data: dueSoonLaptopLoans },
  ] = await Promise.all([
    supabase
      .from("loan_requests")
      .select("id, end_date, user_id, loan_type")
      .eq("status", "approved")
      .eq("loan_type", "temporary")
      .not("end_date", "is", null)
      .lt("end_date", today),
    sendDueSoon
      ? supabase
          .from("loan_requests")
          .select("id, end_date, user_id, loan_type")
          .eq("status", "approved")
          .eq("loan_type", "temporary")
          .eq("end_date", tomorrow)
      : Promise.resolve({ data: [] }),
    supabase
      .from("laptop_loan_requests")
      .select("id, end_date, user_id, loan_type")
      .eq("status", "approved")
      .eq("loan_type", "temporary")
      .not("end_date", "is", null)
      .lt("end_date", today),
    sendDueSoon
      ? supabase
          .from("laptop_loan_requests")
          .select("id, end_date, user_id, loan_type")
          .eq("status", "approved")
          .eq("loan_type", "temporary")
          .eq("end_date", tomorrow)
      : Promise.resolve({ data: [] }),
  ]);

  const allTechLoanIds = [
    ...(overdueLoans || []).map((loan) => loan.id),
    ...(dueSoonLoans || []).map((loan) => loan.id),
  ];
  const allLaptopLoanIds = [
    ...(overdueLaptopLoans || []).map((loan) => loan.id),
    ...(dueSoonLaptopLoans || []).map((loan) => loan.id),
  ];

  if (allTechLoanIds.length === 0 && allLaptopLoanIds.length === 0) {
    return {
      overdueNotified: 0,
      dueSoonNotified: 0,
      dueSoonSkipped: !sendDueSoon,
      laptopAvailNotified: 0,
    };
  }

  const allUserIds = [
    ...new Set([
      ...(overdueLoans || []).map((loan) => loan.user_id),
      ...(dueSoonLoans || []).map((loan) => loan.user_id),
      ...(overdueLaptopLoans || []).map((loan) => loan.user_id),
      ...(dueSoonLaptopLoans || []).map((loan) => loan.user_id),
    ]),
  ];

  const [
    { data: allItems },
    { data: laptopItems },
    { data: allUsers },
    { data: todayNotifs },
  ] = await Promise.all([
    allTechLoanIds.length > 0
      ? supabase
          .from("loan_items")
          .select("loan_request_id, item_name, quantity")
          .in("loan_request_id", allTechLoanIds)
      : Promise.resolve({ data: [] }),
    allLaptopLoanIds.length > 0
      ? supabase
          .from("laptop_loan_items")
          .select("loan_request_id, laptops(name)")
          .in("loan_request_id", allLaptopLoanIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from("users")
      .select("id, email, display_name, mute_emails, mute_telegram")
      .in("id", allUserIds),
    supabase
      .from("notifications")
      .select("user_id, message")
      .in("user_id", allUserIds)
      .gte("created_at", today),
  ]);

  const itemsByLoan = new Map();
  for (const item of allItems || []) {
    if (!itemsByLoan.has(item.loan_request_id)) {
      itemsByLoan.set(item.loan_request_id, []);
    }
    itemsByLoan.get(item.loan_request_id).push(item);
  }

  const laptopsByLoan = new Map();
  for (const item of laptopItems || []) {
    if (!laptopsByLoan.has(item.loan_request_id)) {
      laptopsByLoan.set(item.loan_request_id, []);
    }
    laptopsByLoan
      .get(item.loan_request_id)
      .push(item.laptops?.name || "Laptop");
  }

  const userMap = new Map((allUsers || []).map((user) => [user.id, user]));

  const alreadyNotifiedOverdue = new Set();
  const alreadyNotifiedDueSoon = new Set();
  for (const notification of todayNotifs || []) {
    const overdueMatch = notification.message.match(/loan #(\d+) is OVERDUE/);
    const dueSoonMatch = notification.message.match(
      /loan #(\d+) is due tomorrow/,
    );
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
    const itemList = loanItems
      .map((item) => `${item.item_name} × ${item.quantity}`)
      .join(", ");

    notifInserts.push({
      user_id: loan.user_id,
      message: `⚠️ Your loan #${loan.id} is OVERDUE! Please return items or contact an admin.\n\nItems: ${itemList}`,
      link: "/loans",
    });

    if (loanUser?.email && !loanUser?.mute_emails) {
      emailTasks.push(
        sendOverdueEmail({
          to: loanUser.email,
          displayName: loanUser.display_name,
          loanId: loan.id,
          items: loanItems.map((item) => ({
            item: item.item_name,
            quantity: item.quantity,
          })),
          endDate: loan.end_date,
        }).catch((err) => console.error("reminder notification failed:", err?.message || err)),
      );
    }
    if (!loanUser?.mute_telegram) {
      telegramTasks.push(
        sendTelegramMessage(
          loan.user_id,
          `🚨 <b>Action Required — Loan Overdue</b>\nYour loan <b>#${loan.id}</b> is past its return date.\n\nItems: ${itemList}\n\nPlease return these items or reach out to an admin as soon as possible. Thank you!`,
        ).catch((err) => console.error("reminder notification failed:", err?.message || err)),
      );
    }
    overdueNotified++;
  }

  for (const loan of overdueLaptopLoans || []) {
    if (alreadyNotifiedOverdue.has(loan.id)) continue;
    const loanUser = userMap.get(loan.user_id);
    const laptopList =
      (laptopsByLoan.get(loan.id) || []).join(", ") || "Laptops";

    notifInserts.push({
      user_id: loan.user_id,
      message: `⚠️ Your laptop loan #${loan.id} is OVERDUE! Please return laptops or contact an admin.\n\nLaptops: ${laptopList}`,
      link: "/loans",
    });

    if (loanUser?.email && !loanUser?.mute_emails) {
      emailTasks.push(
        sendOverdueEmail({
          to: loanUser.email,
          displayName: loanUser.display_name,
          loanId: loan.id,
          items: (laptopsByLoan.get(loan.id) || []).map((name) => ({
            item: name,
            quantity: 1,
          })),
          endDate: loan.end_date,
        }).catch((err) => console.error("reminder notification failed:", err?.message || err)),
      );
    }
    if (!loanUser?.mute_telegram) {
      telegramTasks.push(
        sendTelegramMessage(
          loan.user_id,
          `🚨 <b>Action Required — Laptop Loan Overdue</b>\nYour laptop loan <b>#${loan.id}</b> is past its return date.\n\nLaptops: ${laptopList}\n\nPlease return these laptops or reach out to an admin as soon as possible. Thank you!`,
        ).catch((err) => console.error("reminder notification failed:", err?.message || err)),
      );
    }
    overdueNotified++;
  }

  for (const loan of dueSoonLoans || []) {
    if (alreadyNotifiedDueSoon.has(loan.id)) continue;
    const loanUser = userMap.get(loan.user_id);
    const loanItems = itemsByLoan.get(loan.id) || [];
    const itemList = loanItems
      .map((item) => `${item.item_name} × ${item.quantity}`)
      .join(", ");

    notifInserts.push({
      user_id: loan.user_id,
      message: `⏰ Your loan #${loan.id} is due tomorrow! Please prepare to return items.\n\nItems: ${itemList}`,
      link: "/loans",
    });

    if (loanUser?.email && !loanUser?.mute_emails) {
      emailTasks.push(
        sendDueSoonEmail({
          to: loanUser.email,
          displayName: loanUser.display_name,
          loanId: loan.id,
          items: loanItems.map((item) => ({
            item: item.item_name,
            quantity: item.quantity,
          })),
          endDate: loan.end_date,
        }).catch((err) => console.error("reminder notification failed:", err?.message || err)),
      );
    }
    if (!loanUser?.mute_telegram) {
      telegramTasks.push(
        sendTelegramMessage(
          loan.user_id,
          `⏰ <b>Heads Up — Return Due Tomorrow</b>\nYour loan <b>#${loan.id}</b> is due back tomorrow.\n\nItems: ${itemList}\n\nPlease have these items ready to return. Thanks for keeping things on track!`,
        ).catch((err) => console.error("reminder notification failed:", err?.message || err)),
      );
    }
    dueSoonNotified++;
  }

  for (const loan of dueSoonLaptopLoans || []) {
    if (alreadyNotifiedDueSoon.has(loan.id)) continue;
    const loanUser = userMap.get(loan.user_id);
    const laptopList =
      (laptopsByLoan.get(loan.id) || []).join(", ") || "Laptops";

    notifInserts.push({
      user_id: loan.user_id,
      message: `⏰ Your laptop loan #${loan.id} is due tomorrow! Please prepare to return laptops.\n\nLaptops: ${laptopList}`,
      link: "/loans",
    });

    if (loanUser?.email && !loanUser?.mute_emails) {
      emailTasks.push(
        sendDueSoonEmail({
          to: loanUser.email,
          displayName: loanUser.display_name,
          loanId: loan.id,
          items: (laptopsByLoan.get(loan.id) || []).map((name) => ({
            item: name,
            quantity: 1,
          })),
          endDate: loan.end_date,
        }).catch((err) => console.error("reminder notification failed:", err?.message || err)),
      );
    }
    if (!loanUser?.mute_telegram) {
      telegramTasks.push(
        sendTelegramMessage(
          loan.user_id,
          `⏰ <b>Heads Up — Laptop Return Due Tomorrow</b>\nYour laptop loan <b>#${loan.id}</b> is due back tomorrow.\n\nLaptops: ${laptopList}\n\nPlease have these laptops ready to return. Thanks!`,
        ).catch((err) => console.error("reminder notification failed:", err?.message || err)),
      );
    }
    dueSoonNotified++;
  }

  await Promise.all([
    notifInserts.length > 0
      ? supabase.from("notifications").insert(notifInserts)
      : Promise.resolve(),
    ...emailTasks,
    ...telegramTasks,
  ]);

  let laptopAvailNotified = 0;

  const { data: pendingSubs } = await supabase
    .from("laptop_notifications")
    .select("id, user_id, laptop_id, laptops(name, is_perm_loaned)");

  if (pendingSubs?.length) {
    const { data: activeLaptopLoans } = await supabase
      .from("laptop_loan_requests")
      .select("laptop_loan_items(laptop_id)")
      .in("status", ["approved", "pending"]);

    const busyLaptopIds = new Set();
    for (const loan of activeLaptopLoans || []) {
      for (const item of loan.laptop_loan_items || []) {
        busyLaptopIds.add(item.laptop_id);
      }
    }

    const availableSubs = pendingSubs.filter(
      (sub) =>
        !busyLaptopIds.has(sub.laptop_id) && !sub.laptops?.is_perm_loaned,
    );

    if (availableSubs.length) {
      const subUserIds = [...new Set(availableSubs.map((sub) => sub.user_id))];
      const { data: subUsers } = await supabase
        .from("users")
        .select("id, email, display_name, mute_emails, mute_telegram")
        .in("id", subUserIds);
      const subUserMap = new Map(
        (subUsers || []).map((user) => [user.id, user]),
      );

      const availNotifInserts = [];
      const availEmailTasks = [];
      const availTelegramTasks = [];

      for (const sub of availableSubs) {
        const subUser = subUserMap.get(sub.user_id);
        if (!subUser) continue;
        const laptopName = sub.laptops?.name || "Laptop";

        availNotifInserts.push({
          user_id: sub.user_id,
          message: `💻 Laptop "${laptopName}" is now available to borrow!`,
          link: "/inventory/laptop-loans",
        });

        if (!subUser.mute_telegram) {
          availTelegramTasks.push(
            sendTelegramMessage(
              sub.user_id,
              `💻 <b>Good News — Laptop Available!</b>\n<b>${laptopName}</b> is now free and available to borrow.\n\nHead over to the app to reserve it before someone else does!`,
            ).catch((err) => console.error("reminder notification failed:", err?.message || err)),
          );
        }
        if (subUser.email && !subUser.mute_emails) {
          availEmailTasks.push(
            sendLaptopAvailableEmail({
              to: subUser.email,
              displayName: subUser.display_name,
              laptopName,
            }).catch((err) => console.error("reminder notification failed:", err?.message || err)),
          );
        }
        laptopAvailNotified++;
      }

      await Promise.all([
        availNotifInserts.length > 0
          ? supabase.from("notifications").insert(availNotifInserts)
          : Promise.resolve(),
        ...availEmailTasks,
        ...availTelegramTasks,
      ]);

      const fulfilledIds = availableSubs.map((sub) => sub.id);
      await supabase
        .from("laptop_notifications")
        .delete()
        .in("id", fulfilledIds);
    }
  }

  return {
    overdueNotified,
    dueSoonNotified,
    dueSoonSkipped: !sendDueSoon,
    laptopAvailNotified,
  };
}
