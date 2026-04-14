import { supabase } from "@/lib/db/supabase";
import {
  hashPassword,
  createResetToken,
  verifyResetToken,
  decodeTokenUnsafe,
} from "@/lib/utils/auth";
import { sendPasswordResetEmail } from "@/lib/services/email";
import { checkRateLimit } from "@/lib/utils/rateLimit";
import { getRequestClientIdentifier } from "@/lib/utils/request";
import { NextResponse } from "next/server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

export async function POST(request) {
  try {
    const clientId = getRequestClientIdentifier(request);
    // Separate rate limit key from login so they don't interfere with each other
    const { limited, retryAfterSeconds } = await checkRateLimit(
      `reset:${clientId}`,
    );
    if (limited) {
      return NextResponse.json(
        {
          error: `Too many attempts. Please try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`,
        },
        { status: 429 },
      );
    }

    const { action, username, token, new_password } = await request.json();

    if (action === "request_reset") {
      if (!username || username.trim().length < 2) {
        return NextResponse.json(
          { error: "Please enter your username" },
          { status: 400 },
        );
      }

      const normalizedUsername = username.trim().toLowerCase();
      const { data: user } = await supabase
        .from("users")
        .select("id, username, display_name, email, password_hash")
        .eq("username", normalizedUsername)
        .single();

      // Don't reveal whether the user exists
      if (!user || !user.email) {
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
      if (!new_password || new_password.length < 8) {
        return NextResponse.json(
          { error: "Password must be at least 8 characters" },
          { status: 400 },
        );
      }

      // Decode (without verifying) to extract the user id for the DB lookup
      const claims = decodeTokenUnsafe(token);
      if (!claims?.id || claims?.purpose !== "password_reset") {
        return NextResponse.json(
          { error: "Invalid or expired reset link. Please request a new one." },
          { status: 400 },
        );
      }

      // Fetch current password_hash — required to fully verify the token
      const { data: user } = await supabase
        .from("users")
        .select("id, password_hash")
        .eq("id", claims.id)
        .eq("username", claims.username)
        .single();

      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      // Full cryptographic verify using current hash — fails if already used
      if (!verifyResetToken(token, user.password_hash)) {
        return NextResponse.json(
          {
            error:
              "This reset link has already been used or has expired. Please request a new one.",
          },
          { status: 400 },
        );
      }

      const hash = await hashPassword(new_password);
      await supabase
        .from("users")
        .update({ password_hash: hash })
        .eq("id", user.id);

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
