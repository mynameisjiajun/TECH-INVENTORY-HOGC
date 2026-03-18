import { NextResponse } from "next/server";
import { getDb, waitForSync, ensureUsersRestored } from "@/lib/db/db";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function reply(chatId, text) {
  if (!BOT_TOKEN) return;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

function getLoanItems(db, loanId) {
  return db.prepare(`
    SELECT li.quantity, si.item
    FROM loan_items li
    JOIN storage_items si ON li.item_id = si.id
    WHERE li.loan_request_id = ?
  `).all(loanId);
}

function getMultipleLoanItems(db, loanIds) {
  if (!loanIds || loanIds.length === 0) return new Map();
  const allItems = db.prepare(`
    SELECT li.loan_request_id, li.quantity, si.item
    FROM loan_items li
    JOIN storage_items si ON li.item_id = si.id
    JOIN json_each(?) AS j ON li.loan_request_id = j.value
  `).all(JSON.stringify(loanIds));

  const itemsMap = new Map();
  for (const item of allItems) {
    if (!itemsMap.has(item.loan_request_id)) {
      itemsMap.set(item.loan_request_id, []);
    }
    itemsMap.get(item.loan_request_id).push(item);
  }
  return itemsMap;
}

function formatItems(items) {
  return items.map(i => `  • ${i.item} × ${i.quantity}`).join("\n");
}

function daysUntil(dateStr) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(dateStr + "T00:00:00");
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

// ── Command Handlers ────────────────────────────────────────────

async function handleStart(db, chatId, userId) {
  const user = db.prepare("SELECT id, username FROM users WHERE id = ?").get(userId);
  if (!user) {
    await reply(chatId, "❌ Invalid link. Please use the link from your Profile page.");
    return;
  }

  db.prepare("UPDATE users SET telegram_chat_id = ? WHERE id = ?").run(String(chatId), userId);

  // Lazy import to avoid circular dependency issues
  const { syncUsersToSheet } = await import("@/lib/db/db");
  await syncUsersToSheet();

  await reply(chatId, `✅ Successfully linked! Welcome, <b>@${user.username}</b>.\n\nYou will now receive instant notifications about your Tech Inventory loans here.\n\nSend /help to see available commands.`);
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
    "/help — Show this message",
  ].join("\n"));
}

async function handleLoans(db, chatId, userId) {
  const loans = db.prepare(`
    SELECT id, loan_type, status, start_date, end_date
    FROM loan_requests
    WHERE user_id = ? AND status IN ('pending', 'approved')
    ORDER BY created_at DESC
  `).all(userId);

  if (loans.length === 0) {
    await reply(chatId, "📦 You currently have no active or pending loans.");
    return;
  }

  let message = "<b>Your Active Loans:</b>\n\n";
  const loanIds = loans.map((l) => l.id);
  const itemsMap = getMultipleLoanItems(db, loanIds);

  for (const loan of loans) {
    const items = itemsMap.get(loan.id) || [];
    const statusEmoji = loan.status === "approved" ? "✅" : "⏳";
    message += `${statusEmoji} <b>Loan #${loan.id}</b> (${loan.loan_type})\n`;
    message += `Status: ${loan.status.charAt(0).toUpperCase() + loan.status.slice(1)}\n`;
    if (loan.loan_type === "temporary" && loan.end_date) {
      const days = daysUntil(loan.end_date);
      const dueText = days < 0 ? `⚠️ OVERDUE by ${Math.abs(days)} day(s)` : days === 0 ? "⚠️ Due TODAY" : days === 1 ? "⏰ Due TOMORROW" : `Due: ${loan.end_date} (${days} days)`;
      message += `${dueText}\n`;
    }
    message += `Items:\n${formatItems(items)}\n\n`;
  }

  await reply(chatId, message);
}

async function handleReturns(db, chatId, userId) {
  const loans = db.prepare(`
    SELECT id, start_date, end_date
    FROM loan_requests
    WHERE user_id = ? AND status = 'approved' AND loan_type = 'temporary'
    ORDER BY end_date ASC
  `).all(userId);

  if (loans.length === 0) {
    await reply(chatId, "✨ You have no items to return. All clear!");
    return;
  }

  let message = "<b>📋 Items You Need To Return:</b>\n\n";
  const loanIds = loans.map((l) => l.id);
  const itemsMap = getMultipleLoanItems(db, loanIds);

  for (const loan of loans) {
    const items = itemsMap.get(loan.id) || [];
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

async function handleOverdue(db, chatId, userId) {
  const today = new Date().toLocaleDateString("en-CA");

  const loans = db.prepare(`
    SELECT id, end_date
    FROM loan_requests
    WHERE user_id = ? AND status = 'approved' AND loan_type = 'temporary'
      AND end_date IS NOT NULL AND end_date < ?
    ORDER BY end_date ASC
  `).all(userId, today);

  if (loans.length === 0) {
    await reply(chatId, "✅ You have no overdue items. Great job!");
    return;
  }

  let message = `<b>🚨 You have ${loans.length} overdue loan(s):</b>\n\n`;
  const loanIds = loans.map((l) => l.id);
  const itemsMap = getMultipleLoanItems(db, loanIds);

  for (const loan of loans) {
    const items = itemsMap.get(loan.id) || [];
    const days = Math.abs(daysUntil(loan.end_date));

    message += `<b>Loan #${loan.id}</b> — ${days} day(s) overdue\n`;
    message += `Was due: ${loan.end_date}\n`;
    message += `Items:\n${formatItems(items)}\n\n`;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  message += `Please return these items ASAP!\n<a href="${appUrl}/loans">Open app to submit return →</a>`;

  await reply(chatId, message);
}

async function handleStatus(db, chatId, userId, loanIdStr) {
  const loanId = parseInt(loanIdStr, 10);
  if (isNaN(loanId)) {
    await reply(chatId, "Usage: /status &lt;loan_id&gt;\nExample: <code>/status 5</code>");
    return;
  }

  const loan = db.prepare(`
    SELECT lr.*, u.display_name as requester_name
    FROM loan_requests lr
    JOIN users u ON lr.user_id = u.id
    WHERE lr.id = ? AND lr.user_id = ?
  `).get(loanId, userId);

  if (!loan) {
    await reply(chatId, `❌ Loan #${loanId} not found or doesn't belong to you.`);
    return;
  }

  const items = getLoanItems(db, loan.id);
  const statusMap = { pending: "⏳ Pending", approved: "✅ Approved", rejected: "❌ Rejected", returned: "📥 Returned" };

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

async function handleHistory(db, chatId, userId) {
  const loans = db.prepare(`
    SELECT id, loan_type, status, purpose, updated_at
    FROM loan_requests
    WHERE user_id = ? AND status IN ('returned', 'rejected')
    ORDER BY updated_at DESC
    LIMIT 10
  `).all(userId);

  if (loans.length === 0) {
    await reply(chatId, "📭 No loan history yet.");
    return;
  }

  let message = "<b>📜 Recent Loan History:</b>\n\n";
  for (const loan of loans) {
    const statusEmoji = loan.status === "returned" ? "📥" : "❌";
    const date = loan.updated_at ? loan.updated_at.split("T")[0] || loan.updated_at.split(" ")[0] : "—";
    message += `${statusEmoji} <b>#${loan.id}</b> ${loan.status} — ${date}\n`;
    message += `   ${loan.loan_type} | ${loan.purpose}\n\n`;
  }

  await reply(chatId, message);
}

// ── Webhook Entry Point ─────────────────────────────────────────

export async function POST(request) {
  try {
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
        await ensureUsersRestored();
        const db = getDb();
        await handleStart(db, chatId, userId);
        return NextResponse.json({ ok: true });
      }
    }

    // All other commands require a linked account
    await ensureUsersRestored();
    const db = getDb();
    const user = db.prepare("SELECT id, username FROM users WHERE telegram_chat_id = ?").get(String(chatId));

    if (!user) {
      await reply(chatId, "👋 I'm the Tech Inventory Bot!\n\nLink your account via your <b>Profile</b> page in the app to get started.");
      return NextResponse.json({ ok: true });
    }

    // Ensure inventory data is available for commands that need it
    await waitForSync();

    // Route commands
    if (text === "/help" || text === "/start") {
      await handleHelp(chatId);
    } else if (text === "/loans") {
      await handleLoans(db, chatId, user.id);
    } else if (text === "/returns") {
      await handleReturns(db, chatId, user.id);
    } else if (text === "/overdue") {
      await handleOverdue(db, chatId, user.id);
    } else if (text.startsWith("/status")) {
      const arg = text.split(/\s+/)[1] || "";
      await handleStatus(db, chatId, user.id, arg);
    } else if (text === "/history") {
      await handleHistory(db, chatId, user.id);
    } else {
      await reply(chatId, "I didn't understand that. Send /help to see what I can do.");
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Telegram Webhook Error:", err.message);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
