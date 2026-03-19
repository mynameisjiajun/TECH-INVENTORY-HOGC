import { supabase } from "@/lib/db/supabase";

async function sendToChat(chatId, message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error("Telegram API Error:", errData);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Failed to send Telegram message:", err.message);
    return false;
  }
}

/**
 * Send a Telegram message to a user by their app user ID.
 * Skips the Supabase lookup if telegram_chat_id is passed directly.
 *
 * @param {number|string} userId - The Supabase user ID
 * @param {string} message
 * @param {string|null} [chatId] - Pass directly to skip the Supabase lookup
 */
export async function sendTelegramMessage(userId, message, chatId = null) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return false;

  if (chatId) return sendToChat(chatId, message);

  try {
    const { data: user } = await supabase
      .from("users")
      .select("telegram_chat_id")
      .eq("id", userId)
      .single();
    return sendToChat(user?.telegram_chat_id, message);
  } catch (err) {
    console.error("Failed to lookup telegram_chat_id:", err.message);
    return false;
  }
}
