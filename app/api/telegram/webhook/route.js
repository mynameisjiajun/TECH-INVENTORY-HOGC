import { NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";
import { normalizeTelegramHandle } from "@/lib/utils/telegramHandle";
import { getTodaySingaporeDateString } from "@/lib/utils/date";
import { escapeHtml, isSafeHttpsUrl } from "@/lib/utils/html";

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

function hasValidWebhookSecret(request) {
  if (!WEBHOOK_SECRET) {
    return true;
  }

  return (
    request.headers.get("x-telegram-bot-api-secret-token") === WEBHOOK_SECRET
  );
}

function buildLinkInstructions() {
  const profileUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/profile`
    : null;

  return [
    "Open your <b>Profile</b> page in the app and tap <b>Open Telegram to Link</b>.",
    "When Telegram opens, press <b>Start</b> in this chat.",
    profileUrl ? `<a href=\"${profileUrl}\">Open Profile →</a>` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

const TELEGRAM_MAX_LENGTH = 4000;

async function reply(chatId, text) {
  if (!BOT_TOKEN) return;
  const safeText =
    text.length > TELEGRAM_MAX_LENGTH
      ? text.slice(0, TELEGRAM_MAX_LENGTH) + "\n\n<i>…message truncated</i>"
      : text;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: safeText, parse_mode: "HTML" }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error("Telegram reply failed:", errData?.description || errData);
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error("Telegram reply network error:", err.message);
    }
  } finally {
    clearTimeout(timeout);
  }
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
  return items
    .map((i) => `  • ${escapeHtml(i.item_name || i.item)} × ${i.quantity}`)
    .join("\n");
}

function daysUntil(dateStr) {
  const todayStr = getTodaySingaporeDateString();
  const today = new Date(todayStr + "T00:00:00Z");
  const target = new Date(dateStr + "T00:00:00Z");
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

// ── Command Handlers ────────────────────────────────────────────

async function handleStart(chatId, userId) {
  const currentChatId = String(chatId);
  const { data: user, error: userError } = await supabase
    .from("users")
    .select("id, username, telegram_chat_id")
    .eq("id", userId)
    .maybeSingle();

  if (userError || !user) {
    return {
      ok: false,
      error: `❌ Invalid or expired link.\n\n${buildLinkInstructions()}`,
    };
  }

  if (user.telegram_chat_id === currentChatId) {
    return {
      ok: true,
      status: "already-linked",
      user,
    };
  }

  let replacedPreviousChat = false;
  if (user.telegram_chat_id && user.telegram_chat_id !== currentChatId) {
    replacedPreviousChat = true;
  }

  const { data: conflictingUsers, error: conflictingUsersError } =
    await supabase
      .from("users")
      .select("id")
      .eq("telegram_chat_id", currentChatId)
      .neq("id", userId)
      .limit(25);

  if (conflictingUsersError) {
    return {
      ok: false,
      error:
        "⚠️ We couldn't verify your existing Telegram link right now. Please try again in a moment.",
    };
  }

  const reclaimedUserCount = conflictingUsers?.length || 0;
  if (reclaimedUserCount > 0) {
    const { error: reclaimError } = await supabase
      .from("users")
      .update({ telegram_chat_id: null })
      .eq("telegram_chat_id", currentChatId)
      .neq("id", userId);

    if (reclaimError) {
      return {
        ok: false,
        error:
          reclaimError.code === "23505"
            ? "⚠️ This Telegram chat could not be reassigned right now. Please try again in a moment."
            : "⚠️ We couldn't clear the previous Telegram link right now. Please try again in a moment.",
      };
    }
  }

  const { data: updatedRows, error: updateError } = await supabase
    .from("users")
    .update({ telegram_chat_id: currentChatId })
    .eq("id", userId)
    .select("id");

  if (updateError) {
    return {
      ok: false,
      error:
        updateError.code === "23505"
          ? "⚠️ This Telegram chat is already linked elsewhere. Please send /start again in a moment."
          : "⚠️ We couldn't link your Telegram account right now. Please try again later or use the app Profile page to retry.",
    };
  }

  if (!updatedRows || updatedRows.length === 0) {
    return {
      ok: false,
      error: `❌ That link code is invalid or expired.\n\n${buildLinkInstructions()}`,
    };
  }

  return {
    ok: true,
    status:
      replacedPreviousChat || reclaimedUserCount > 0 ? "relinked" : "linked",
    user,
    reclaimedUserCount,
    replacedPreviousChat,
  };
}

async function handleStartByTelegramHandle(chatId, username) {
  const normalizedHandle = normalizeTelegramHandle(username);

  if (!normalizedHandle) {
    return {
      ok: false,
      error: `👋 <b>Welcome to Tech Inventory Bot!</b>\n\nIt looks like your Telegram isn't linked yet. Here's how to get started:\n\n${buildLinkInstructions()}`,
    };
  }

  const { data: matchedUser, error } = await supabase
    .from("users")
    .select("id")
    .eq("telegram_handle", normalizedHandle)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      error:
        "⚠️ We couldn't check your saved Telegram handle right now. Please try again in a moment.",
    };
  }

  if (!matchedUser) {
    return {
      ok: false,
      error: [
        `👋 I couldn't find an app account saved with <b>${escapeHtml(normalizedHandle)}</b>.`,
        "",
        "Save this exact Telegram handle on your Profile page, then send /start again, or use the Open Telegram to Link button from the app.",
        "",
        buildLinkInstructions(),
      ].join("\n"),
    };
  }

  return handleStart(chatId, matchedUser.id);
}

async function sendStartResultReply(chatId, result) {
  if (!result?.ok) {
    await reply(
      chatId,
      result?.error || "⚠️ We couldn't link your Telegram account right now.",
    );
    return;
  }

  if (result.status === "already-linked") {
    await reply(
      chatId,
      `✅ You're already linked as <b>@${escapeHtml(result.user.username)}</b>!\n\nSend /help to see available commands.`,
    );
    return;
  }

  if (result.status === "relinked") {
    await reply(
      chatId,
      `✅ <b>Re-linked successfully!</b>\nThis chat is now linked to <b>@${escapeHtml(result.user.username)}</b>. Any previous Telegram link has been replaced.\n\nSend /help to see available commands.`,
    );
    return;
  }

  await reply(
    chatId,
    `✅ <b>You're linked!</b> Welcome, <b>@${escapeHtml(result.user.username)}</b>! 🎉\n\nYou'll now receive loan notifications and reminders directly here.\n\nSend /help to see what I can do.`,
  );
}

function parseCommand(text) {
  const [rawCommand = "", ...args] = text.trim().split(/\s+/);
  return {
    command: rawCommand.split("@")[0].toLowerCase(),
    args,
  };
}

async function handleHelp(chatId) {
  await reply(
    chatId,
    [
      "🤖 <b>Tech Inventory Bot — Commands</b>",
      "",
      "/loans — View your active & pending loans",
      "/returns — Items you need to return",
      "/overdue — Overdue items (urgent!)",
      "/status &lt;id&gt; — Details for a specific loan (e.g. /status 5)",
      "/history — Your recent loan history",
      "/unlink — Disconnect this chat from your account",
      "/mute — Pause Telegram notifications",
      "/unmute — Resume Telegram notifications",
      "/help — Show this message",
    ].join("\n"),
  );
}

async function handleUnlink(chatId, userId) {
  const { data: unlinkedRows, error: unlinkError } = await supabase
    .from("users")
    .update({ telegram_chat_id: null })
    .eq("id", userId)
    .eq("telegram_chat_id", String(chatId))
    .select("id");

  if (unlinkError || !unlinkedRows || unlinkedRows.length === 0) {
    await reply(
      chatId,
      "⚠️ We couldn't unlink this Telegram chat right now. Please try again later or unlink from the app Profile page.",
    );
    return;
  }

  await reply(
    chatId,
    "🔌 <b>Telegram Unlinked</b>\nThis chat has been disconnected from your Tech Inventory account. You won't receive notifications here anymore.\n\nTo reconnect, visit your Profile page in the app.",
  );
}

async function handleMute(chatId, userId, mute) {
  await supabase.from("users").update({ mute_telegram: mute }).eq("id", userId);
  await reply(
    chatId,
    mute
      ? "🔕 <b>Notifications Muted</b>\nYou won't receive Telegram notifications until you unmute. Send /unmute to re-enable them."
      : "🔔 <b>Notifications Enabled</b>\nWelcome back! You'll start receiving Telegram notifications again.",
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
        days < 0
          ? `⚠️ OVERDUE by ${Math.abs(days)} day(s)`
          : days === 0
            ? "⚠️ Due TODAY"
            : days === 1
              ? "⏰ Due TOMORROW"
              : `Due: ${loan.end_date} (${days} days)`;
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
  const today = getTodaySingaporeDateString();
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
    await reply(
      chatId,
      "Usage: /status &lt;loan_id&gt;\nExample: <code>/status 5</code>",
    );
    return;
  }

  const { data: loan } = await supabase
    .from("loan_requests")
    .select(`*, users (display_name)`)
    .eq("id", loanId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!loan) {
    await reply(
      chatId,
      `❌ Loan #${loanId} not found or doesn't belong to you.`,
    );
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
  message += `Status: ${statusMap[loan.status] || escapeHtml(loan.status)}\n`;
  message += `Type: ${loan.loan_type === "permanent" ? "📌 Permanent" : "⏱ Temporary"}\n`;
  message += `Purpose: ${escapeHtml(loan.purpose)}\n`;
  if (loan.remarks) message += `Remarks: ${escapeHtml(loan.remarks)}\n`;
  if (loan.department) message += `Department: ${escapeHtml(loan.department)}\n`;
  if (loan.location) message += `Location: ${escapeHtml(loan.location)}\n`;
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
  if (loan.admin_notes) message += `Admin notes: ${escapeHtml(loan.admin_notes)}\n`;
  message += `\nItems:\n${formatItems(items)}`;

  if (
    loan.status === "returned" &&
    loan.return_photo_url &&
    isSafeHttpsUrl(loan.return_photo_url)
  ) {
    message += `\n\n<a href="${escapeHtml(loan.return_photo_url)}">View return photo →</a>`;
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
    if (!hasValidWebhookSecret(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    if (!body.message?.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = body.message.chat.id;
    const text = body.message.text.trim();
    const telegramUsername = body.message.from?.username || null;
    const { command, args } = parseCommand(text);

    if (command === "/start" && args[0]) {
      const userId = args[0].trim();

      if (userId) {
        const result = await handleStart(chatId, userId);
        await sendStartResultReply(chatId, result);
        return NextResponse.json({ ok: true });
      }

      await reply(
        chatId,
        `❌ That link code is invalid.\n\n${buildLinkInstructions()}`,
      );
      return NextResponse.json({ ok: true });
    }

    if (command === "/start") {
      const { data: linkedUser } = await supabase
        .from("users")
        .select("id")
        .eq("telegram_chat_id", String(chatId))
        .maybeSingle();

      if (linkedUser) {
        return NextResponse.json({ ok: true });
      }

      const result = await handleStartByTelegramHandle(
        chatId,
        telegramUsername,
      );
      await sendStartResultReply(chatId, result);
      return NextResponse.json({ ok: true });
    }

    // All other commands require a linked account
    const { data: user } = await supabase
      .from("users")
      .select("id, username")
      .eq("telegram_chat_id", String(chatId))
      .maybeSingle();

    if (!user) {
      await reply(
        chatId,
        `👋 <b>Welcome to Tech Inventory Bot!</b>\n\nIt looks like your Telegram isn't linked yet. Here's how to get started:\n\n${buildLinkInstructions()}`,
      );
      return NextResponse.json({ ok: true });
    }

    // Route commands
    if (command === "/help") {
      await handleHelp(chatId);
    } else if (command === "/loans") {
      await handleLoans(chatId, user.id);
    } else if (command === "/returns") {
      await handleReturns(chatId, user.id);
    } else if (command === "/overdue") {
      await handleOverdue(chatId, user.id);
    } else if (command === "/status") {
      const arg = args[0] || "";
      await handleStatus(chatId, user.id, arg);
    } else if (command === "/history") {
      await handleHistory(chatId, user.id);
    } else if (command === "/unlink") {
      await handleUnlink(chatId, user.id);
    } else if (command === "/mute") {
      await handleMute(chatId, user.id, true);
    } else if (command === "/unmute") {
      await handleMute(chatId, user.id, false);
    } else {
      await reply(
        chatId,
        "🤔 I didn't quite understand that command. Send /help to see what I can do!",
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Telegram Webhook Error:", err.message);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
