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
                text: `✅ Successfully linked! Welcome, @${user.username}.\n\nYou will now receive instant notifications about your Tech Inventory loans here.`,
              }),
            });

            return NextResponse.json({ ok: true });
          }
        }
      }

      // Default response for any other messages
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: "I am the Tech Inventory Notification Bot! Link your account via your Profile page on the app to get started.",
        }),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Telegram Webhook Error:", err.message);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
