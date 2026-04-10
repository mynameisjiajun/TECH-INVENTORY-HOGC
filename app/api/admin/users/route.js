import { supabase } from "@/lib/db/supabase";
import { getCurrentUser, hashPassword } from "@/lib/utils/auth";
import {
  getAppSettings,
  invalidateAppSettingsCache,
  parseAppSettingBoolean,
} from "@/lib/utils/appSettings";
import { NextResponse } from "next/server";

const DEFAULT_USER_PAGE_SIZE = 200;
const MAX_USER_PAGE_SIZE = 200;

function parseBoundedInt(value, fallback, max) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }

  return Math.min(parsed, max);
}

async function deleteByUserId(table, userIdColumn, userId) {
  const { error } = await supabase
    .from(table)
    .delete()
    .eq(userIdColumn, userId);
  if (error) throw new Error(error.message || `Failed to delete ${table}`);
}

async function nullifyUserReference(table, userIdColumn, userId) {
  const { error } = await supabase
    .from(table)
    .update({ [userIdColumn]: null })
    .eq(userIdColumn, userId);
  if (error) throw new Error(error.message || `Failed to update ${table}`);
}

// GET: list all users (admin only)
export async function GET(request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const page = parseBoundedInt(searchParams.get("page"), 1, 10_000);
  const limit = parseBoundedInt(
    searchParams.get("limit"),
    DEFAULT_USER_PAGE_SIZE,
    MAX_USER_PAGE_SIZE,
  );
  const offset = (page - 1) * limit;

  const [{ data: users, count: totalUsers }, settingsMap] = await Promise.all([
    supabase
      .from("users")
      .select(
        "id, username, display_name, role, email, telegram_chat_id, profile_emoji, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1),
    getAppSettings([
      "invite_code",
      "reminder_weekday",
      "reminder_saturday",
      "reminder_sunday",
      "auto_approve_loans",
      "auto_approve_guest_requests",
    ]),
  ]);

  return NextResponse.json({
    users: users || [],
    pagination: {
      page,
      limit,
      total: totalUsers || 0,
      hasMore: offset + (users?.length || 0) < (totalUsers || 0),
    },
    invite_code: settingsMap.invite_code || "",
    reminder_times: {
      weekday: settingsMap.reminder_weekday || "09:00",
      saturday: settingsMap.reminder_saturday || "10:00",
      sunday: settingsMap.reminder_sunday || "14:00",
    },
    auto_approve_loans: parseAppSettingBoolean(settingsMap.auto_approve_loans),
    auto_approve_guest_requests: parseAppSettingBoolean(
      settingsMap.auto_approve_guest_requests,
    ),
  });
}

// POST: admin user management actions
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  }

  const body = await request.json();
  const {
    action,
    user_id,
    new_password,
    new_role,
    display_name,
    invite_code,
    reminder_times,
    enabled,
  } = body;

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
    if (!target)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    const hash = await hashPassword(new_password);
    const { error: passwordResetError } = await supabase
      .from("users")
      .update({ password_hash: hash })
      .eq("id", user_id);
    if (passwordResetError) {
      return NextResponse.json(
        { error: passwordResetError.message || "Failed to reset password" },
        { status: 500 },
      );
    }
    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "reset_password",
      target_type: "user",
      target_id: user_id,
      details: `Reset password for @${target.username}`,
    });

    return NextResponse.json({
      message: `Password reset for @${target.username}`,
    });
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
      return NextResponse.json(
        { error: "Cannot change your own role" },
        { status: 400 },
      );
    }

    const { data: target } = await supabase
      .from("users")
      .select("id, username")
      .eq("id", user_id)
      .single();
    if (!target)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    const { error: updateError } = await supabase
      .from("users")
      .update({ role: new_role })
      .eq("id", user_id);
    if (updateError) {
      return NextResponse.json(
        { error: updateError.message || "Failed to update role" },
        { status: 500 },
      );
    }
    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "change_role",
      target_type: "user",
      target_id: user_id,
      details: `Changed @${target.username} role to ${new_role}`,
    });

    return NextResponse.json({
      message: `Role updated for @${target.username}`,
    });
  }

  if (action === "delete_user") {
    if (!user_id)
      return NextResponse.json({ error: "User ID required" }, { status: 400 });
    if (Number(user_id) === Number(user.id)) {
      return NextResponse.json(
        { error: "Cannot delete yourself" },
        { status: 400 },
      );
    }

    const { data: target } = await supabase
      .from("users")
      .select("id, username")
      .eq("id", user_id)
      .single();
    if (!target)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    try {
      const [{ data: techLoans }, { data: laptopLoans }] = await Promise.all([
        supabase.from("loan_requests").select("id").eq("user_id", user_id),
        supabase
          .from("laptop_loan_requests")
          .select("id")
          .eq("user_id", user_id),
      ]);

      const techLoanIds = (techLoans || []).map((loan) => loan.id);
      const laptopLoanIds = (laptopLoans || []).map((loan) => loan.id);

      if (techLoanIds.length > 0) {
        const { error: loanItemsError } = await supabase
          .from("loan_items")
          .delete()
          .in("loan_request_id", techLoanIds);
        if (loanItemsError)
          throw new Error(
            loanItemsError.message || "Failed to delete loan items",
          );

        const { error: loansError } = await supabase
          .from("loan_requests")
          .delete()
          .eq("user_id", user_id);
        if (loansError)
          throw new Error(
            loansError.message || "Failed to delete loan requests",
          );
      }

      if (laptopLoanIds.length > 0) {
        const { error: laptopLoanItemsError } = await supabase
          .from("laptop_loan_items")
          .delete()
          .in("loan_request_id", laptopLoanIds);
        if (laptopLoanItemsError) {
          throw new Error(
            laptopLoanItemsError.message ||
              "Failed to delete laptop loan items",
          );
        }

        const { error: laptopLoansError } = await supabase
          .from("laptop_loan_requests")
          .delete()
          .eq("user_id", user_id);
        if (laptopLoansError) {
          throw new Error(
            laptopLoansError.message || "Failed to delete laptop loan requests",
          );
        }
      }

      await Promise.all([
        deleteByUserId("notifications", "user_id", user_id),
        deleteByUserId("laptop_notifications", "user_id", user_id),
        nullifyUserReference("loan_templates", "created_by", user_id),
        nullifyUserReference("activity_feed", "user_id", user_id),
        nullifyUserReference("audit_log", "user_id", user_id),
      ]);

      const { data: deletedUsers, error: deleteError } = await supabase
        .from("users")
        .delete()
        .eq("id", user_id)
        .select("id");
      if (deleteError) {
        throw new Error(deleteError.message || "Failed to delete user");
      }
      if (!deletedUsers?.length) {
        throw new Error("User no longer exists or could not be deleted");
      }
    } catch (deleteErr) {
      return NextResponse.json(
        { error: deleteErr.message || "Failed to delete user" },
        { status: 500 },
      );
    }

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "delete_user",
      target_type: "user",
      target_id: user_id,
      details: `Deleted user @${target.username}`,
    });

    return NextResponse.json({ message: `User @${target.username} deleted` });
  }

  if (action === "update_user") {
    if (!user_id)
      return NextResponse.json({ error: "User ID required" }, { status: 400 });

    const { data: target } = await supabase
      .from("users")
      .select("id, username")
      .eq("id", user_id)
      .single();
    if (!target)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (display_name) {
      const trimmedDisplayName = display_name.trim();
      if (trimmedDisplayName.length < 2) {
        return NextResponse.json(
          { error: "Display name must be at least 2 characters" },
          { status: 400 },
        );
      }
      const { error: updateUserError } = await supabase
        .from("users")
        .update({ display_name: trimmedDisplayName })
        .eq("id", user_id);
      if (updateUserError) {
        return NextResponse.json(
          { error: updateUserError.message || "Failed to update user" },
          { status: 500 },
        );
      }
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

    const { error: inviteCodeError } = await supabase
      .from("app_settings")
      .upsert({ key: "invite_code", value: invite_code.trim() });
    if (inviteCodeError) {
      return NextResponse.json(
        { error: inviteCodeError.message || "Failed to update invite code" },
        { status: 500 },
      );
    }

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "set_invite_code",
      target_type: "settings",
      target_id: 0,
      details: "Updated the registration invite code",
    });

    invalidateAppSettingsCache();

    return NextResponse.json({ message: "Invite code updated" });
  }

  if (action === "set_reminder_times") {
    if (!reminder_times || typeof reminder_times !== "object") {
      return NextResponse.json(
        { error: "Invalid reminder times" },
        { status: 400 },
      );
    }
    const timeRegex = /^\d{2}:\d{2}$/;
    const { weekday, saturday, sunday } = reminder_times;
    if (
      !timeRegex.test(weekday) ||
      !timeRegex.test(saturday) ||
      !timeRegex.test(sunday)
    ) {
      return NextResponse.json(
        { error: "Times must be in HH:MM format" },
        { status: 400 },
      );
    }

    const { error: reminderError } = await supabase
      .from("app_settings")
      .upsert([
        { key: "reminder_weekday", value: weekday },
        { key: "reminder_saturday", value: saturday },
        { key: "reminder_sunday", value: sunday },
      ]);
    if (reminderError) {
      return NextResponse.json(
        { error: reminderError.message || "Failed to update reminder times" },
        { status: 500 },
      );
    }

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "set_reminder_times",
      target_type: "settings",
      target_id: 0,
      details: `Set reminder times — Weekday: ${weekday}, Saturday: ${saturday}, Sunday: ${sunday} (SGT)`,
    });

    invalidateAppSettingsCache();

    return NextResponse.json({ message: "Reminder times updated" });
  }

  if (action === "set_auto_approve_loans") {
    if (typeof enabled !== "boolean") {
      return NextResponse.json(
        { error: "Enabled flag is required" },
        { status: 400 },
      );
    }

    const { error: autoApproveError } = await supabase
      .from("app_settings")
      .upsert({
        key: "auto_approve_loans",
        value: enabled ? "true" : "false",
      });

    if (autoApproveError) {
      return NextResponse.json(
        {
          error:
            autoApproveError.message || "Failed to update auto-approve setting",
        },
        { status: 500 },
      );
    }

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "set_auto_approve_loans",
      target_type: "settings",
      target_id: 0,
      details: `${enabled ? "Enabled" : "Disabled"} global auto-approval for new loan requests`,
    });

    invalidateAppSettingsCache();

    return NextResponse.json({
      message: `Auto-approve ${enabled ? "enabled" : "disabled"}`,
    });
  }

  if (action === "set_auto_approve_guest_requests") {
    if (typeof enabled !== "boolean") {
      return NextResponse.json(
        { error: "Enabled flag is required" },
        { status: 400 },
      );
    }

    const { error: guestAutoApproveError } = await supabase
      .from("app_settings")
      .upsert({
        key: "auto_approve_guest_requests",
        value: enabled ? "true" : "false",
      });

    if (guestAutoApproveError) {
      return NextResponse.json(
        {
          error:
            guestAutoApproveError.message ||
            "Failed to update guest auto-approve setting",
        },
        { status: 500 },
      );
    }

    await supabase.from("audit_log").insert({
      user_id: user.id,
      action: "set_auto_approve_guest_requests",
      target_type: "settings",
      target_id: 0,
      details: `${enabled ? "Enabled" : "Disabled"} guest guest-request auto-approval`,
    });

    invalidateAppSettingsCache();

    return NextResponse.json({
      message: `Guest auto-approve ${enabled ? "enabled" : "disabled"}`,
    });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
