import { NextResponse } from "next/server";
import { getDb, syncUsersToSheet } from "@/lib/db/db";

export async function POST(request) {
  try {
    const body = await request.json();

    // Check if it's a message containing text
    if (body.message && body.message.text) {
      const chatId = body.message.chat.id;
      const text = body.message.text.trim();

      // We expect the user to click a link like t.me/BotName?start=<user_id>
      // Telegram translates this to the string "/start <user_id>"
      if (text.startsWith("/start ")) {
        const userIdRaw = text.split(" ")[1];
        const userId = parseInt(userIdRaw, 10);

        if (!isNaN(userId)) {
          const db = getDb();
          
          // Verify user exists
          const user = db.prepare("SELECT id, username FROM users WHERE id = ?").get(userId);
          
          if (user) {
            // Update their chat ID
            db.prepare("UPDATE users SET telegram_chat_id = ? WHERE id = ?").run(chatId, userId);
            
            // Sync new ID to Google Sheets so it isn't lost on restart
            await syncUsersToSheet();

            // Send success message back
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: `✅ Successfully linked! Welcome, <b>@${user.username}</b>.\n\nYou will now receive instant notifications about your Tech Inventory loans here.\n\nSend /help to see available commands.`,
                parse_mode: "HTML",
              }),
            });

            return NextResponse.json({ ok: true });
          }
        }
      }

      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const db = getDb();
      const user = db.prepare("SELECT id, username FROM users WHERE telegram_chat_id = ?").get(chatId);

      if (user) {
        if (text === "/loans") {
          const loans = db.prepare(`
            SELECT id, loan_type, status, start_date, end_date
            FROM loan_requests
            WHERE user_id = ? AND status IN ('pending', 'approved')
            ORDER BY created_at DESC
          `).all(user.id);

          if (loans.length === 0) {
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: "📦 You currently have no active or pending loans.",
              }),
            });
          } else {
            let message = "<b>Your Active Loans:</b>\n\n";
            for (const loan of loans) {
              const items = db.prepare(`
                SELECT li.quantity, si.item
                FROM loan_items li
                JOIN storage_items si ON li.item_id = si.id
                WHERE li.loan_request_id = ?
              `).all(loan.id);

              const itemsText = items.map(i => `• ${i.item} × ${i.quantity}`).join("\n");

              const statusEmoji = loan.status === "approved" ? "✅" : "⏳";
              message += `${statusEmoji} <b>Loan #${loan.id}</b> (${loan.loan_type})\n`;
              message += `Status: ${loan.status.charAt(0).toUpperCase() + loan.status.slice(1)}\n`;
              if (loan.loan_type === "temporary" && loan.end_date) {
                message += `Due: ${loan.end_date}\n`;
              }
              message += `Items:\n${itemsText}\n\n`;
            }

            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: message,
                parse_mode: "HTML",
              }),
            });
          }
          return NextResponse.json({ ok: true });
        } else if (text === "/help" || text === "/start") {
           await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chat_id: chatId,
                text: `<b>Tech Inventory Bot Commands:</b>\n\n/loans - View your active and pending loans\n/help - Show this message`,
                parse_mode: "HTML",
              }),
            });
           return NextResponse.json({ ok: true });
        }
      }

      // Default response for unlinked accounts or unknown commands
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: user
            ? "I didn't understand that command. Send /help to see what I can do."
            : "I am the Tech Inventory Notification Bot! Link your account via your Profile page on the app to get started.",
        }),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Telegram Webhook Error:", err.message);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
