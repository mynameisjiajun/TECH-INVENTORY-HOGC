import { supabase } from "@/lib/db/supabase";
import {
  hashPassword,
  verifyPassword,
  createToken,
  getTokenCookieOptions,
} from "@/lib/utils/auth";
import { getAppSetting } from "@/lib/utils/appSettings";
import { sendWelcomeEmail } from "@/lib/services/email";
import { checkRateLimit, resetRateLimit } from "@/lib/utils/rateLimit";
import { getRequestClientIdentifier } from "@/lib/utils/request";
import { NextResponse } from "next/server";

function rateLimitError(retryAfterSeconds) {
  return NextResponse.json(
    {
      error: `Too many attempts. Please try again in ${Math.ceil(retryAfterSeconds / 60)} minutes.`,
    },
    { status: 429 },
  );
}

export async function POST(request) {
  try {
    const clientId = getRequestClientIdentifier(request);
    const { action, username, password, display_name, invite_code, email } =
      await request.json();

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
      const registerLimit = checkRateLimit(`auth:register:${clientId}`);
      if (registerLimit.limited) {
        return rateLimitError(registerLimit.retryAfterSeconds);
      }

      // Get invite code from Supabase app_settings
      const currentInviteCode =
        (await getAppSetting("invite_code")) || process.env.INVITE_CODE;
      if (!currentInviteCode || invite_code !== currentInviteCode) {
        return NextResponse.json(
          { error: "Invalid invite code" },
          { status: 403 },
        );
      }

      // Check if username exists
      const { data: existing } = await supabase
        .from("users")
        .select("id")
        .eq("username", normalizedUsername)
        .single();
      if (existing) {
        return NextResponse.json(
          { error: "Username already taken" },
          { status: 409 },
        );
      }

      const cleanEmail = email ? email.trim() : null;
      if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return NextResponse.json(
          { error: "Invalid email format" },
          { status: 400 },
        );
      }

      const hash = await hashPassword(password);
      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert({
          username: normalizedUsername,
          password_hash: hash,
          display_name: display_name || normalizedUsername,
          role: "user",
          email: cleanEmail,
        })
        .select("id, username, role, display_name")
        .single();

      if (insertError) throw insertError;

      const token = createToken(newUser);

      if (cleanEmail) {
        sendWelcomeEmail({
          to: cleanEmail,
          displayName: newUser.display_name,
          username: newUser.username,
        }).catch(() => {});
      }

      const response = NextResponse.json({ user: newUser });
      const cookieOpts = getTokenCookieOptions();
      response.cookies.set(cookieOpts.name, token, cookieOpts);
      resetRateLimit(`auth:register:${clientId}`);
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
      const ipLimit = checkRateLimit(`auth:login:client:${clientId}`);
      if (ipLimit.limited) {
        return rateLimitError(ipLimit.retryAfterSeconds);
      }
      const usernameLimit = checkRateLimit(
        `auth:login:user:${normalizedUsername}`,
      );
      if (usernameLimit.limited) {
        return rateLimitError(usernameLimit.retryAfterSeconds);
      }

      const { data: user } = await supabase
        .from("users")
        .select("id, username, role, display_name, password_hash")
        .eq("username", normalizedUsername)
        .single();

      if (!user || !(await verifyPassword(password, user.password_hash))) {
        return NextResponse.json(
          { error: "Invalid username or password" },
          { status: 401 },
        );
      }

      resetRateLimit(`auth:login:client:${clientId}`);
      resetRateLimit(`auth:login:user:${normalizedUsername}`);
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
