import {
  getDb,
  getSetting,
  syncUsersToSheet,
  ensureUsersRestored,
} from "@/lib/db";
import {
  hashPassword,
  verifyPassword,
  createToken,
  getTokenCookieOptions,
} from "@/lib/auth";
import { checkRateLimit, resetRateLimit } from "@/lib/rateLimit";
import { NextResponse } from "next/server";

export async function POST(request) {
  try {
    // Rate limit by IP
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

    // Ensure users are restored from Google Sheets on cold start
    await ensureUsersRestored();

    const { action, username, password, display_name, invite_code, email } =
      await request.json();

    const db = getDb();

    if (action === "register") {
      if (!username || username.trim().length < 2) {
        return NextResponse.json(
          { error: "Username must be at least 2 characters" },
          { status: 400 },
        );
      }
      if (!password || password.length < 6) {
        return NextResponse.json(
          { error: "Password must be at least 6 characters" },
          { status: 400 },
        );
      }

      const normalizedUsername = username.trim().toLowerCase();

      // Validate invite code (stored in DB, editable by admins)
      const currentInviteCode =
        getSetting("invite_code") || process.env.INVITE_CODE;
      if (!currentInviteCode || invite_code !== currentInviteCode) {
        return NextResponse.json(
          { error: "Invalid invite code" },
          { status: 403 },
        );
      }

      // Check if username exists
      const existing = db
        .prepare("SELECT id FROM users WHERE username = ?")
        .get(normalizedUsername);
      if (existing) {
        return NextResponse.json(
          { error: "Username already taken" },
          { status: 409 },
        );
      }

      // Validate email
      const cleanEmail = email ? email.trim() : null;
      if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return NextResponse.json(
          { error: "Invalid email format" },
          { status: 400 },
        );
      }

      // Create user
      const hash = await hashPassword(password);
      const result = db
        .prepare(
          "INSERT INTO users (username, password_hash, display_name, role, email) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          normalizedUsername,
          hash,
          display_name || normalizedUsername,
          "user",
          cleanEmail,
        );

      const user = {
        id: result.lastInsertRowid,
        username: normalizedUsername,
        role: "user",
        display_name: display_name || normalizedUsername,
      };
      const token = createToken(user);

      // Persist users to Google Sheets (fire-and-forget)
      await syncUsersToSheet();

      const response = NextResponse.json({ user });
      const cookieOpts = getTokenCookieOptions();
      response.cookies.set(cookieOpts.name, token, cookieOpts);
      return response;
    }

    if (action === "login") {
      if (!username || !password) {
        return NextResponse.json(
          { error: "Username and password are required" },
          { status: 400 },
        );
      }
      const normalizedUsername = username.trim().toLowerCase();
      const user = db
        .prepare("SELECT * FROM users WHERE username = ?")
        .get(normalizedUsername);
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        return NextResponse.json(
          { error: "Invalid username or password" },
          { status: 401 },
        );
      }

      // Successful login — reset rate limit so correct logins aren't penalised
      resetRateLimit(ip);

      const token = createToken(user);
      const response = NextResponse.json({
        user: {
          id: user.id,
          username: user.username,
          role: user.role,
          display_name: user.display_name,
        },
      });
      const cookieOpts = getTokenCookieOptions();
      response.cookies.set(cookieOpts.name, token, cookieOpts);
      return response;
    }

    if (action === "logout") {
      const response = NextResponse.json({ ok: true });
      response.cookies.set("tech-inventory-token", "", {
        maxAge: 0,
        path: "/",
      });
      return response;
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Auth error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
