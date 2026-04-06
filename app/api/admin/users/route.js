import { supabase } from "@/lib/db/supabase";
import { getCurrentUser, hashPassword } from "@/lib/utils/auth";
import { NextResponse } from "next/server";

// GET: list all users (admin only)
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const [{ data: users }, { data: settings }] = await Promise.all([
    supabase
      .from("users")
      .select("id, username, display_name, role, email, telegram_chat_id, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("app_settings")
      .select("key, value")
      .in("key", ["invite_code", "reminder_weekday", "reminder_saturday", "reminder_sunday"]),
  ]);

  const settingsMap = Object.fromEntries((settings || []).map((s) => [s.key, s.value]));

  return NextResponse.json({
    users: users || [],
    invite_code: settingsMap.invite_code || "",
    reminder_times: {
      weekday: settingsMap.reminder_weekday || "09:00",
      saturday: settingsMap.reminder_saturday || "10:00",
      sunday: settingsMap.reminder_sunday || "14:00",
    },
  });
}

// POST: admin user management actions
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const body = await request.json();
  const { action, user_id, new_password, new_role, display_name, invite_code, reminder_times } = body;

  if (action === "reset_password") {
    if (!user_id || !new_password) {
      return NextResponse.json(
        { error: "User ID and new password are required" },
        { status: 400 },
      );
    }
    if (new_password.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters" },
        { status: 400 },
      );
    }

    const { data: target } = await supabase
      .from("users")
      .select("id, username")
      .eq("id", user_id)
      .single();
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const hash = await hashPassword(new_password);
    await supabase.from("users").update({ password_hash: hash }).eq("id", user_id);
    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "reset_password",
      target_type: "user",
      target_id: user_id,
      details: `Reset password for @${target.username}`,
    });

    return NextResponse.json({ message: `Password reset for @${target.username}` });
  }

  if (action === "change_role") {
    if (!user_id || !new_role) {
      return NextResponse.json(
        { error: "User ID and new role are required" },
        { status: 400 },
      );
    }
    if (!["admin", "tech", "user"].includes(new_role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    if (Number(user_id) === Number(user.id)) {
      return NextResponse.json({ error: "Cannot change your own role" }, { status: 400 });
    }

    const { data: target } = await supabase
      .from("users")
      .select("id, username")
      .eq("id", user_id)
      .single();
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    await supabase.from("users").update({ role: new_role }).eq("id", user_id);
    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "change_role",
      target_type: "user",
      target_id: user_id,
      details: `Changed @${target.username} role to ${new_role}`,
    });

    return NextResponse.json({ message: `Role updated for @${target.username}` });
  }

  if (action === "delete_user") {
    if (!user_id) return NextResponse.json({ error: "User ID required" }, { status: 400 });
    if (Number(user_id) === Number(user.id)) {
      return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 });
    }

    const { data: target } = await supabase
      .from("users")
      .select("id, username")
      .eq("id", user_id)
      .single();
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Log audit before delete (so user_id reference is still valid)
    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "delete_user",
      target_type: "user",
      target_id: user_id,
      details: `Deleted user @${target.username}`,
    });

    // ON DELETE CASCADE handles: notifications, loan_items (via loan_requests), loan_requests
    await supabase.from("users").delete().eq("id", user_id);

    return NextResponse.json({ message: `User @${target.username} deleted` });
  }

  if (action === "update_user") {
    if (!user_id) return NextResponse.json({ error: "User ID required" }, { status: 400 });

    const { data: target } = await supabase
      .from("users")
      .select("id, username")
      .eq("id", user_id)
      .single();
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (display_name) {
      await supabase.from("users").update({ display_name }).eq("id", user_id);
    }

    return NextResponse.json({ message: `User @${target.username} updated` });
  }

  if (action === "set_invite_code") {
    if (!invite_code || invite_code.trim().length < 3) {
      return NextResponse.json(
        { error: "Invite code must be at least 3 characters" },
        { status: 400 },
      );
    }

    await supabase
      .from("app_settings")
      .upsert({ key: "invite_code", value: invite_code.trim() });

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "set_invite_code",
      target_type: "settings",
      target_id: 0,
      details: "Updated the registration invite code",
    });

    return NextResponse.json({ message: "Invite code updated" });
  }

  if (action === "set_reminder_times") {
    if (!reminder_times || typeof reminder_times !== "object") {
      return NextResponse.json({ error: "Invalid reminder times" }, { status: 400 });
    }
    const timeRegex = /^\d{2}:\d{2}$/;
    const { weekday, saturday, sunday } = reminder_times;
    if (!timeRegex.test(weekday) || !timeRegex.test(saturday) || !timeRegex.test(sunday)) {
      return NextResponse.json({ error: "Times must be in HH:MM format" }, { status: 400 });
    }

    await supabase.from("app_settings").upsert([
      { key: "reminder_weekday", value: weekday },
      { key: "reminder_saturday", value: saturday },
      { key: "reminder_sunday", value: sunday },
    ]);

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "set_reminder_times",
      target_type: "settings",
      target_id: 0,
      details: `Set reminder times — Weekday: ${weekday}, Saturday: ${saturday}, Sunday: ${sunday} (SGT)`,
    });

    return NextResponse.json({ message: "Reminder times updated" });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
