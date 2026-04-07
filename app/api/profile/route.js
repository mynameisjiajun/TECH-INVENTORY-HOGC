import { supabase } from "@/lib/db/supabase";
import { getCurrentUser, hashPassword, verifyPassword, createToken, getTokenCookieOptions } from "@/lib/utils/auth";
import { NextResponse } from "next/server";

// GET: get profile info
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("users")
    .select("id, username, display_name, role, email, telegram_chat_id, mute_emails, mute_telegram, created_at")
    .eq("id", user.id)
    .single();

  if (!profile) return NextResponse.json({ error: "User not found" }, { status: 404 });

  return NextResponse.json({ profile });
}

// POST: update profile or change password
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { action, display_name, email, mute_emails, mute_telegram, current_password, new_password } =
    await request.json();

  if (action === "update_profile") {
    if (!display_name || display_name.trim().length < 2) {
      return NextResponse.json(
        { error: "Display name must be at least 2 characters" },
        { status: 400 },
      );
    }
    const cleanEmail = email ? email.trim() : null;
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }

    const trimmedDisplayName = display_name.trim();
    const { error: updateError } = await supabase
      .from("users")
      .update({
        display_name: trimmedDisplayName,
        email: cleanEmail,
        mute_emails: mute_emails === true,
        mute_telegram: mute_telegram === true,
      })
      .eq("id", user.id);
    if (updateError) {
      return NextResponse.json(
        { error: updateError.message || "Failed to update profile" },
        { status: 500 },
      );
    }

    // Re-issue JWT so navbar reflects new display_name immediately
    const updatedToken = createToken({ ...user, display_name: trimmedDisplayName });
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
      .single();

    if (!dbUser) return NextResponse.json({ error: "User not found" }, { status: 404 });

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
    return NextResponse.json({ message: "Telegram unlinked" });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
