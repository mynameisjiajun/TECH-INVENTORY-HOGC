import {
  getDb,
  getSetting,
  setSetting,
  syncUsersToSheet,
  ensureUsersRestored,
} from "@/lib/db/db";
import { getCurrentUser, hashPassword } from "@/lib/utils/auth";
import { NextResponse } from "next/server";

// GET: list all users (admin only)
export async function GET() {
  await ensureUsersRestored();
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  }

  const db = getDb();
  const users = db
    .prepare(
      "SELECT id, username, display_name, role, created_at FROM users ORDER BY created_at DESC",
    )
    .all();
  const invite_code = getSetting("invite_code") || "";
  return NextResponse.json({ users, invite_code });
}

// POST: admin user management actions
export async function POST(request) {
  await ensureUsersRestored();
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  }

  const db = getDb();
  const body = await request.json();
  const { action, user_id, new_password, new_role, display_name, invite_code } =
    body;

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
    const target = db
      .prepare("SELECT id, username FROM users WHERE id = ?")
      .get(user_id);
    if (!target)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    const hash = await hashPassword(new_password);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      hash,
      user_id,
    );

    // Log audit
    db.prepare(
      "INSERT INTO audit_log (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
    ).run(
      user.id,
      "reset_password",
      "user",
      user_id,
      `Reset password for @${target.username}`,
    );

    await syncUsersToSheet();
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
    if (!["admin", "user"].includes(new_role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    // Prevent self-demotion
    if (user_id === user.id) {
      return NextResponse.json(
        { error: "Cannot change your own role" },
        { status: 400 },
      );
    }
    const target = db
      .prepare("SELECT id, username FROM users WHERE id = ?")
      .get(user_id);
    if (!target)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    db.prepare("UPDATE users SET role = ? WHERE id = ?").run(new_role, user_id);

    db.prepare(
      "INSERT INTO audit_log (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
    ).run(
      user.id,
      "change_role",
      "user",
      user_id,
      `Changed @${target.username} role to ${new_role}`,
    );

    await syncUsersToSheet();
    return NextResponse.json({
      message: `Role updated for @${target.username}`,
    });
  }

  if (action === "delete_user") {
    if (!user_id)
      return NextResponse.json({ error: "User ID required" }, { status: 400 });
    if (user_id === user.id)
      return NextResponse.json(
        { error: "Cannot delete yourself" },
        { status: 400 },
      );

    const target = db
      .prepare("SELECT id, username FROM users WHERE id = ?")
      .get(user_id);
    if (!target)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    // Delete related records first to avoid FK constraint violations
    db.prepare("DELETE FROM notifications WHERE user_id = ?").run(user_id);
    db.prepare(
      "DELETE FROM loan_items WHERE loan_request_id IN (SELECT id FROM loan_requests WHERE user_id = ?)",
    ).run(user_id);
    db.prepare("DELETE FROM loan_requests WHERE user_id = ?").run(user_id);
    db.prepare("DELETE FROM audit_log WHERE user_id = ?").run(user_id);
    db.prepare("DELETE FROM users WHERE id = ?").run(user_id);

    db.prepare(
      "INSERT INTO audit_log (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
    ).run(
      user.id,
      "delete_user",
      "user",
      user_id,
      `Deleted user @${target.username}`,
    );

    await syncUsersToSheet();
    return NextResponse.json({ message: `User @${target.username} deleted` });
  }

  if (action === "update_user") {
    if (!user_id)
      return NextResponse.json({ error: "User ID required" }, { status: 400 });
    const target = db
      .prepare("SELECT id, username FROM users WHERE id = ?")
      .get(user_id);
    if (!target)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (display_name) {
      db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(
        display_name,
        user_id,
      );
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
    setSetting("invite_code", invite_code.trim());

    db.prepare(
      "INSERT INTO audit_log (user_id, action, target_type, target_id, details) VALUES (?, ?, ?, ?, ?)",
    ).run(
      user.id,
      "set_invite_code",
      "settings",
      0,
      "Updated the registration invite code",
    );

    return NextResponse.json({ message: "Invite code updated" });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
