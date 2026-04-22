import { supabase } from "@/lib/db/supabase";
import { sendTelegramMessage } from "@/lib/services/telegram";

export async function sendAdminTelegramAlert(message) {
  try {
    const { data: admins, error } = await supabase
      .from("users")
      .select("id, mute_telegram")
      .eq("role", "admin");

    if (error) {
      console.error("Failed to load admin Telegram recipients:", error.message);
      return false;
    }

    await Promise.all(
      (admins || []).map((admin) =>
        admin.mute_telegram
          ? Promise.resolve(false)
          : sendTelegramMessage(admin.id, message).catch(() => false),
      ),
    );

    return true;
  } catch (error) {
    console.error("Failed to send admin Telegram alert:", error.message);
    return false;
  }
}
