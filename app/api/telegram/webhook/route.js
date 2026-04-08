import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

async function reply(chatId, text) {
  if (!BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

// Fetch items for multiple loans in a single query, returns a Map<loanId, items[]>
async function fetchAllLoanItems(loanIds) {
  if (!loanIds.length) return new Map();
  const { data } = await supabase
    .from("loan_items")
    .select("loan_request_id, item_name, quantity")
    .in("loan_request_id", loanIds);
  const map = new Map();
  for (const row of data || []) {
    if (!map.has(row.loan_request_id)) map.set(row.loan_request_id, []);
    map.get(row.loan_request_id).push(row);
  }
  return map;
}

function formatItems(items) {
  return items.map((i) => `  • ${i.item_name || i.item} × ${i.quantity}`).join("\n");
}

function daysUntil(dateStr) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(dateStr + "T00:00:00");
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

// ── Command Handlers ────────────────────────────────────────────

async function handleStart(chatId, userId) {
  const { data: user } = await supabase
    .from("users")
    .select("id, username, telegram_chat_id")
    .eq("id", userId)
    .single();

  if (!user) {
    await reply(chatId, "❌ Invalid link. Please use the link from your Profile page.");
    return;
  }

  // Check if this Telegram account is already linked to a different user
  const { data: alreadyLinked } = await supabase
    .from("users")
    .select("id")
    .eq("telegram_chat_id", String(chatId))
    .neq("id", userId)
    .maybeSingle();

  if (alreadyLinked) {
    await reply(
      chatId,
      "⚠️ This Telegram account is already linked to another user.\n\nIf you believe this is an error, ask an admin to unlink it first.",
    );
    return;
  }

  // Already linked to this same user — just confirm
  if (user.telegram_chat_id === String(chatId)) {
    await reply(
      chatId,
      `✅ Already linked! Your Telegram is connected to <b>@${user.username}</b>.`,
    );
    return;
  }

  await supabase
    .from("users")
    .update({ telegram_chat_id: String(chatId) })
    .eq("id", userId);

  await reply(
    chatId,
    `✅ Successfully linked! Welcome, <b>@${user.username}</b>.\n\nYou will now receive instant notifications about your Tech Inventory loans here.\n\nSend /help to see available commands.`,
  );
}

async function handleHelp(chatId) {
  await reply(chatId, [
    "<b>Tech Inventory Bot Commands:</b>",
    "",
    "/loans — View your active & pending loans",
    "/returns — Items you need to return",
    "/overdue — Overdue items (need immediate attention)",
    "/status &lt;id&gt; — Check a specific loan (e.g. /status 5)",
    "/history — Your recent loan history",
    "/mute — Mute Telegram notifications",
    "/unmute — Unmute Telegram notifications",
    "/help — Show this message",
  ].join("\n"));
}

async function handleMute(chatId, userId, mute) {
  await supabase.from("users").update({ mute_telegram: mute }).eq("id", userId);
  await reply(
    chatId,
    mute
      ? "🔕 Telegram notifications muted. Send /unmute to re-enable them."
      : "🔔 Telegram notifications re-enabled.",
  );
}

async function handleLoans(chatId, userId) {
  const { data: loans } = await supabase
    .from("loan_requests")
    .select("id, loan_type, status, start_date, end_date")
    .eq("user_id", userId)
    .in("status", ["pending", "approved"])
    .order("created_at", { ascending: false });

  if (!loans || loans.length === 0) {
    await reply(chatId, "📦 You currently have no active or pending loans.");
    return;
  }

  const itemsByLoan = await fetchAllLoanItems(loans.map((l) => l.id));

  let message = "<b>Your Active Loans:</b>\n\n";
  for (const loan of loans) {
    const items = itemsByLoan.get(loan.id) || [];
    const statusEmoji = loan.status === "approved" ? "✅" : "⏳";
    message += `${statusEmoji} <b>Loan #${loan.id}</b> (${loan.loan_type})\n`;
    message += `Status: ${loan.status.charAt(0).toUpperCase() + loan.status.slice(1)}\n`;
    if (loan.loan_type === "temporary" && loan.end_date) {
      const days = daysUntil(loan.end_date);
      const dueText =
        days < 0 ? `⚠️ OVERDUE by ${Math.abs(days)} day(s)` :
        days === 0 ? "⚠️ Due TODAY" :
        days === 1 ? "⏰ Due TOMORROW" :
        `Due: ${loan.end_date} (${days} days)`;
      message += `${dueText}\n`;
    }
    message += `Items:\n${formatItems(items)}\n\n`;
  }

  await reply(chatId, message);
}

async function handleReturns(chatId, userId) {
  const { data: loans } = await supabase
    .from("loan_requests")
    .select("id, start_date, end_date")
    .eq("user_id", userId)
    .eq("status", "approved")
    .eq("loan_type", "temporary")
    .order("end_date", { ascending: true });

  if (!loans || loans.length === 0) {
    await reply(chatId, "✨ You have no items to return. All clear!");
    return;
  }

  const itemsByLoan = await fetchAllLoanItems(loans.map((l) => l.id));

  let message = "<b>📋 Items You Need To Return:</b>\n\n";
  for (const loan of loans) {
    const items = itemsByLoan.get(loan.id) || [];
    const days = loan.end_date ? daysUntil(loan.end_date) : null;

    let urgency = "";
    if (days !== null) {
      if (days < 0) urgency = ` — ⚠️ OVERDUE by ${Math.abs(days)} day(s)!`;
      else if (days === 0) urgency = " — ⚠️ Due TODAY!";
      else if (days === 1) urgency = " — ⏰ Due tomorrow";
      else urgency = ` — ${days} days left`;
    }

    message += `<b>Loan #${loan.id}</b>${urgency}\n`;
    if (loan.end_date) message += `Return by: ${loan.end_date}\n`;
    message += `Items:\n${formatItems(items)}\n\n`;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  message += `\n<a href="${appUrl}/loans">Open app to submit return →</a>`;
  await reply(chatId, message);
}

async function handleOverdue(chatId, userId) {
  const today = new Date().toLocaleDateString("en-CA");
  const { data: loans } = await supabase
    .from("loan_requests")
    .select("id, end_date")
    .eq("user_id", userId)
    .eq("status", "approved")
    .eq("loan_type", "temporary")
    .not("end_date", "is", null)
    .lt("end_date", today)
    .order("end_date", { ascending: true });

  if (!loans || loans.length === 0) {
    await reply(chatId, "✅ You have no overdue items. Great job!");
    return;
  }

  const itemsByLoan = await fetchAllLoanItems(loans.map((l) => l.id));

  let message = `<b>🚨 You have ${loans.length} overdue loan(s):</b>\n\n`;
  for (const loan of loans) {
    const items = itemsByLoan.get(loan.id) || [];
    const days = Math.abs(daysUntil(loan.end_date));
    message += `<b>Loan #${loan.id}</b> — ${days} day(s) overdue\n`;
    message += `Was due: ${loan.end_date}\n`;
    message += `Items:\n${formatItems(items)}\n\n`;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  message += `Please return these items ASAP!\n<a href="${appUrl}/loans">Open app to submit return →</a>`;
  await reply(chatId, message);
}

async function handleStatus(chatId, userId, loanIdStr) {
  const loanId = parseInt(loanIdStr, 10);
  if (isNaN(loanId)) {
    await reply(chatId, "Usage: /status &lt;loan_id&gt;\nExample: <code>/status 5</code>");
    return;
  }

  const { data: loan } = await supabase
    .from("loan_requests")
    .select(`*, users (display_name)`)
    .eq("id", loanId)
    .eq("user_id", userId)
    .single();

  if (!loan) {
    await reply(chatId, `❌ Loan #${loanId} not found or doesn't belong to you.`);
    return;
  }

  const itemsByLoanMap = await fetchAllLoanItems([loan.id]);
  const items = itemsByLoanMap.get(loan.id) || [];
  const statusMap = {
    pending: "⏳ Pending",
    approved: "✅ Approved",
    rejected: "❌ Rejected",
    returned: "📥 Returned",
  };

  let message = `<b>Loan #${loan.id} Details:</b>\n\n`;
  message += `Status: ${statusMap[loan.status] || loan.status}\n`;
  message += `Type: ${loan.loan_type === "permanent" ? "📌 Permanent" : "⏱ Temporary"}\n`;
  message += `Purpose: ${loan.purpose}\n`;
  if (loan.department) message += `Department: ${loan.department}\n`;
  if (loan.location) message += `Location: ${loan.location}\n`;
  message += `Start: ${loan.start_date}\n`;
  if (loan.end_date) {
    message += `End: ${loan.end_date}`;
    if (loan.status === "approved" && loan.loan_type === "temporary") {
      const days = daysUntil(loan.end_date);
      if (days < 0) message += ` (⚠️ ${Math.abs(days)}d overdue)`;
      else if (days === 0) message += " (⚠️ TODAY)";
      else message += ` (${days}d left)`;
    }
    message += "\n";
  }
  if (loan.admin_notes) message += `Admin notes: ${loan.admin_notes}\n`;
  message += `\nItems:\n${formatItems(items)}`;

  if (loan.status === "returned" && loan.return_photo_url) {
    message += `\n\n<a href="${loan.return_photo_url}">View return photo →</a>`;
  }

  await reply(chatId, message);
}

async function handleHistory(chatId, userId) {
  const { data: loans } = await supabase
    .from("loan_requests")
    .select("id, loan_type, status, purpose, updated_at")
    .eq("user_id", userId)
    .in("status", ["returned", "rejected"])
    .order("updated_at", { ascending: false })
    .limit(10);

  if (!loans || loans.length === 0) {
    await reply(chatId, "📭 No loan history yet.");
    return;
  }

  let message = "<b>📜 Recent Loan History:</b>\n\n";
  for (const loan of loans) {
    const statusEmoji = loan.status === "returned" ? "📥" : "❌";
    const date = loan.updated_at ? loan.updated_at.split("T")[0] : "—";
    message += `${statusEmoji} <b>#${loan.id}</b> ${loan.status} — ${date}\n`;
    message += `   ${loan.loan_type} | ${loan.purpose}\n\n`;
  }

  await reply(chatId, message);
}

// ── Webhook Entry Point ─────────────────────────────────────────

export async function POST(request) {
  try {
    if (!WEBHOOK_SECRET) {
      console.error("TELEGRAM_WEBHOOK_SECRET is not configured");
      return NextResponse.json(
        { error: "Server misconfiguration" },
        { status: 500 },
      );
    }

    if (
      request.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    if (!body.message?.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = body.message.chat.id;
    const text = body.message.text.trim();

    // Handle /start <userId> (account linking)
    if (text.startsWith("/start ")) {
      const userIdRaw = text.split(" ")[1];
      const userId = parseInt(userIdRaw, 10);
      if (!isNaN(userId)) {
        await handleStart(chatId, userId);
        return NextResponse.json({ ok: true });
      }
    }

    // All other commands require a linked account
    const { data: user } = await supabase
      .from("users")
      .select("id, username")
      .eq("telegram_chat_id", String(chatId))
      .single();

    if (!user) {
      await reply(
        chatId,
        "👋 I'm the Tech Inventory Bot!\n\nLink your account via your <b>Profile</b> page in the app to get started.",
      );
      return NextResponse.json({ ok: true });
    }

    // Route commands
    if (text === "/help" || text === "/start") {
      await handleHelp(chatId);
    } else if (text === "/loans") {
      await handleLoans(chatId, user.id);
    } else if (text === "/returns") {
      await handleReturns(chatId, user.id);
    } else if (text === "/overdue") {
      await handleOverdue(chatId, user.id);
    } else if (text.startsWith("/status")) {
      const arg = text.split(/\s+/)[1] || "";
      await handleStatus(chatId, user.id, arg);
    } else if (text === "/history") {
      await handleHistory(chatId, user.id);
    } else if (text === "/mute") {
      await handleMute(chatId, user.id, true);
    } else if (text === "/unmute") {
      await handleMute(chatId, user.id, false);
    } else {
      await reply(chatId, "I didn't understand that. Send /help to see what I can do.");
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Telegram Webhook Error:", err.message);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
