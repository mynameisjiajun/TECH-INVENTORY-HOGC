import { supabase } from "@/lib/db/supabase";

const TELEGRAM_MAX_LENGTH = 4000;

async function sendToChat(chatId, message) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !chatId) return false;
  const safeMessage =
    message.length > TELEGRAM_MAX_LENGTH
      ? message.slice(0, TELEGRAM_MAX_LENGTH) + "\n\n<i>…message truncated</i>"
      : message;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: safeMessage,
          parse_mode: "HTML",
        }),
        signal: controller.signal,
      },
    );
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      console.error("Telegram API Error:", errData?.description || errData);
      return false;
    }
    return true;
  } catch (err) {
    if (err.name !== "AbortError") {
      console.error("Failed to send Telegram message:", err.message);
    }
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function sendTelegramChatMessage(chatId, message) {
  return sendToChat(chatId, message);
}

/**
 * Send a Telegram message to a user by their app user ID.
 * Respects the user's mute_telegram preference.
 *
 * @param {number|string} userId - The Supabase user ID
 * @param {string} message
 */
export async function sendTelegramMessage(userId, message) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return false;

  try {
    const { data: user } = await supabase
      .from("users")
      .select("telegram_chat_id, mute_telegram")
      .eq("id", userId)
      .single();
    if (!user?.telegram_chat_id || user.mute_telegram) return false;
    return sendToChat(user.telegram_chat_id, message);
  } catch (err) {
    console.error("Failed to lookup telegram_chat_id:", err.message);
    return false;
  }
}
