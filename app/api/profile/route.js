import { getDb, ensureUserExists } from "@/lib/db";
import { getCurrentUser, hashPassword, verifyPassword } from "@/lib/auth";
import { NextResponse } from "next/server";

// GET: get profile info
export async function GET() {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  ensureUserExists(user);
  const profile = db
    .prepare(
      "SELECT id, username, display_name, role, email, created_at FROM users WHERE id = ?",
    )
    .get(user.id);
  if (!profile)
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  return NextResponse.json({ profile });
}

// POST: update profile or change password
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  ensureUserExists(user);
  const { action, display_name, email, current_password, new_password } =
    await request.json();

  if (action === "update_profile") {
    if (!display_name || display_name.trim().length < 2) {
      return NextResponse.json(
        { error: "Display name must be at least 2 characters" },
        { status: 400 },
      );
    }
    const cleanEmail = email ? email.trim() : null;
    db.prepare("UPDATE users SET display_name = ?, email = ? WHERE id = ?").run(
      display_name.trim(),
      cleanEmail,
      user.id,
    );
    return NextResponse.json({ message: "Profile updated!" });
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

    const dbUser = db
      .prepare("SELECT password_hash FROM users WHERE id = ?")
      .get(user.id);
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
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      newHash,
      user.id,
    );
    return NextResponse.json({ message: "Password changed successfully!" });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
