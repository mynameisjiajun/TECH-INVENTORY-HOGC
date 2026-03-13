import { getDb } from "./db";

/**
 * Send a Telegram message to a specific user by their app user ID.
 * The user must have linked their Telegram account (telegram_chat_id is not null).
 * 
 * @param {number|string} userId - The local database user ID
 * @param {string} message - The text message to send
 * @returns {Promise<boolean>} True if sent successfully, false otherwise.
 */
export async function sendTelegramMessage(userId, message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  try {
    const db = getDb();
    const user = db
      .prepare("SELECT telegram_chat_id FROM users WHERE id = ?")
      .get(userId);

    if (!user || !user.telegram_chat_id) {
      // User hasn't linked Telegram yet
      return false;
    }

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: user.telegram_chat_id,
        text: message,
        parse_mode: "HTML",
      }),
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
