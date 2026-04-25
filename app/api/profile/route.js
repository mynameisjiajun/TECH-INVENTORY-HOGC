import { supabase } from "@/lib/db/supabase";
import {
  getCurrentUser,
  hashPassword,
  verifyPassword,
  createToken,
  getTokenCookieOptions,
} from "@/lib/utils/auth";
import { normalizeTelegramHandle } from "@/lib/utils/telegramHandle";
import { sendTelegramChatMessage } from "@/lib/services/telegram";
import { NextResponse } from "next/server";

function isMissingTelegramHandleColumn(error) {
  const message = error?.message || "";
  return (
    error?.code === "42703" ||
    message.includes("telegram_handle") ||
    message.includes("column")
  );
}

async function getProfileRow(userId) {
  const fullSelect = await supabase
    .from("users")
    .select(
      "id, username, display_name, role, email, telegram_chat_id, telegram_handle, ministry, mute_emails, mute_telegram, profile_emoji, created_at",
    )
    .eq("id", userId)
    .single();

  if (!fullSelect.error) {
    return fullSelect;
  }

  if (!isMissingTelegramHandleColumn(fullSelect.error)) {
    return fullSelect;
  }

  const legacySelect = await supabase
    .from("users")
    .select(
      "id, username, display_name, role, email, telegram_chat_id, ministry, mute_emails, mute_telegram, profile_emoji, created_at",
    )
    .eq("id", userId)
    .single();

  if (legacySelect.error) {
    return legacySelect;
  }

  return {
    data: { ...legacySelect.data, telegram_handle: null },
    error: null,
  };
}

async function updateProfileRow(userId, values) {
  const fullUpdate = await supabase
    .from("users")
    .update(values)
    .eq("id", userId);

  if (!fullUpdate.error || !isMissingTelegramHandleColumn(fullUpdate.error)) {
    return fullUpdate;
  }

  const { telegram_handle, ...legacyValues } = values;
  return supabase.from("users").update(legacyValues).eq("id", userId);
}

// GET: get profile info
export async function GET() {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile, error } = await getProfileRow(user.id);

  if (error) {
    return NextResponse.json(
      { error: error.message || "Failed to load profile" },
      { status: 500 },
    );
  }

  if (!profile)
    return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json({ profile });
}

// POST: update profile or change password
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const {
    action,
    display_name,
    email,
    telegram_handle,
    ministry,
    mute_emails,
    mute_telegram,
    profile_emoji,
    current_password,
    new_password,
  } = await request.json();

  if (action === "update_profile") {
    if (!display_name || display_name.trim().length < 2) {
      return NextResponse.json(
        { error: "Display name must be at least 2 characters" },
        { status: 400 },
      );
    }
    const cleanEmail = email ? email.trim() : null;
    const cleanTelegramHandle = normalizeTelegramHandle(telegram_handle);
    const cleanMinistry = ministry ? ministry.trim() : null;
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 },
      );
    }

    const trimmedDisplayName = display_name.trim();
    const cleanEmoji = typeof profile_emoji === "string" ? profile_emoji.trim() || null : undefined;
    const updatePayload = {
      display_name: trimmedDisplayName,
      email: cleanEmail,
      telegram_handle: cleanTelegramHandle,
      ministry: cleanMinistry,
      mute_emails: mute_emails === true,
      mute_telegram: mute_telegram === true,
    };
    if (cleanEmoji !== undefined) {
      updatePayload.profile_emoji = cleanEmoji;
    }
    const { error: updateError } = await updateProfileRow(user.id, updatePayload);
    if (updateError) {
      return NextResponse.json(
        {
          error:
            updateError.code === "23505"
              ? "That Telegram handle is already linked to another account"
              : updateError.message || "Failed to update profile",
        },
        { status: 500 },
      );
    }

    const updatedToken = createToken({
      ...user,
      display_name: trimmedDisplayName,
      ministry: cleanMinistry,
      profile_emoji: cleanEmoji !== undefined ? cleanEmoji : user.profile_emoji,
    });
    const response = NextResponse.json({ message: "Profile updated!" });
    const cookieOpts = getTokenCookieOptions();
    response.cookies.set(cookieOpts.name, updatedToken, cookieOpts);
    return response;
  }

  if (action === "change_password") {
    if (!current_password || !new_password) {
      return NextResponse.json(
        { error: "Both current and new password are required" },
        { status: 400 },
      );
    }
    if (new_password.length < 6) {
      return NextResponse.json(
        { error: "New password must be at least 6 characters" },
        { status: 400 },
      );
    }

    const { data: dbUser } = await supabase
      .from("users")
      .select("password_hash")
      .eq("id", user.id)
      .maybeSingle();

    if (!dbUser)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    const valid = await verifyPassword(current_password, dbUser.password_hash);
    if (!valid) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 400 },
      );
    }

    const newHash = await hashPassword(new_password);
    const { error: passwordUpdateError } = await supabase
      .from("users")
      .update({ password_hash: newHash })
      .eq("id", user.id);
    if (passwordUpdateError) {
      return NextResponse.json(
        { error: passwordUpdateError.message || "Failed to change password" },
        { status: 500 },
      );
    }

    return NextResponse.json({ message: "Password changed successfully!" });
  }

  if (action === "unlink_telegram") {
    const { data: existing } = await supabase
      .from("users")
      .select("telegram_chat_id")
      .eq("id", user.id)
      .maybeSingle();

    if (!existing?.telegram_chat_id) {
      return NextResponse.json(
        { error: "No Telegram account is currently linked" },
        { status: 400 },
      );
    }

    const chatId = existing.telegram_chat_id;

    const { error: unlinkError } = await supabase
      .from("users")
      .update({ telegram_chat_id: null })
      .eq("id", user.id);

    if (unlinkError) {
      return NextResponse.json(
        { error: unlinkError.message || "Failed to unlink Telegram" },
        { status: 500 },
      );
    }

    sendTelegramChatMessage(
      chatId,
      "🔌 <b>Telegram Unlinked</b>\nYour Telegram has been disconnected from your Tech Inventory account. You won't receive notifications here anymore.\n\nTo reconnect, visit your Profile page in the app.",
    ).catch(() => {});

    return NextResponse.json({ message: "Telegram unlinked successfully." });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
