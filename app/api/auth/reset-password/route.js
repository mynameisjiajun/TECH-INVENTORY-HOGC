import { getDb, syncUsersToSheet, ensureUsersRestored } from "@/lib/db/db";
import { hashPassword, createResetToken, verifyResetToken } from "@/lib/utils/auth";
import { sendPasswordResetEmail } from "@/lib/services/email";
import { checkRateLimit } from "@/lib/utils/rateLimit";
import { NextResponse } from "next/server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function POST(request) {
  try {
    await ensureUsersRestored();
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const { limited, retryAfterSeconds } = checkRateLimit(ip);
    if (limited) {
      return NextResponse.json(
        {
          error: `Too many attempts. Please try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`,
        },
        { status: 429 },
      );
    }

    const { action, username, token, new_password } = await request.json();

    const db = getDb();

    if (action === "request_reset") {
      if (!username || username.trim().length < 2) {
        return NextResponse.json(
          { error: "Please enter your username" },
          { status: 400 },
        );
      }

      const normalizedUsername = username.trim().toLowerCase();
      const user = db
        .prepare(
          "SELECT id, username, display_name, email FROM users WHERE username = ?",
        )
        .get(normalizedUsername);

      if (!user || !user.email) {
        // Don't reveal whether the user exists — always show success
        return NextResponse.json({
          message:
            "If an account with that username exists and has an email set, a reset link has been sent.",
        });
      }

      const resetToken = createResetToken(user);
      const resetUrl = `${APP_URL}/reset-password?token=${encodeURIComponent(resetToken)}`;

      await sendPasswordResetEmail({
        to: user.email,
        displayName: user.display_name,
        resetUrl,
      });

      return NextResponse.json({
        message:
          "If an account with that username exists and has an email set, a reset link has been sent.",
      });
    }

    if (action === "reset_password") {
      if (!token) {
        return NextResponse.json(
          { error: "Reset token is required" },
          { status: 400 },
        );
      }
      if (!new_password || new_password.length < 6) {
        return NextResponse.json(
          { error: "Password must be at least 6 characters" },
          { status: 400 },
        );
      }

      const payload = verifyResetToken(token);
      if (!payload) {
        return NextResponse.json(
          { error: "Invalid or expired reset link. Please request a new one." },
          { status: 400 },
        );
      }

      const user = db
        .prepare("SELECT id FROM users WHERE id = ? AND username = ?")
        .get(payload.id, payload.username);
      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      const hash = await hashPassword(new_password);
      db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
        hash,
        user.id,
      );

      await syncUsersToSheet();

      return NextResponse.json({
        message: "Password has been reset successfully! You can now log in.",
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Password reset error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
