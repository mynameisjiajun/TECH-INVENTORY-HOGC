import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/utils/jwt";

const SETUP_HINT =
  "Dev login bypass requires SUPABASE_ENVIRONMENT=dev and a non-production " +
  "Supabase project. See CLAUDE.md → 'Dev environment isolation'.";

function refusalIfNotDev() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }
  if (process.env.SUPABASE_ENVIRONMENT !== "dev") {
    return NextResponse.json(
      { error: "Dev login bypass disabled (not pointing at a dev DB)", hint: SETUP_HINT },
      { status: 503 },
    );
  }
  return null;
}

export async function GET() {
  const blocked = refusalIfNotDev();
  if (blocked) return blocked;

  const { supabase } = await import("@/lib/db/supabase");
  const { ensureDevUsersSeeded } = await import("@/lib/devSeedUsers");
  await ensureDevUsersSeeded();

  const { data, error } = await supabase
    .from("users")
    .select("id, username, role, display_name, ministry, profile_emoji")
    .order("role", { ascending: false })
    .order("username", { ascending: true })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ users: data ?? [] });
}

export async function POST(request) {
  const blocked = refusalIfNotDev();
  if (blocked) return blocked;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const username =
    typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
  if (!username) {
    return NextResponse.json({ error: "username is required" }, { status: 400 });
  }

  const { supabase } = await import("@/lib/db/supabase");
  const { createToken, getTokenCookieOptions } = await import("@/lib/utils/auth");
  const { invalidate } = await import("@/lib/utils/cache");
  const { ensureDevUsersSeeded } = await import("@/lib/devSeedUsers");
  await ensureDevUsersSeeded();

  const { data: user, error } = await supabase
    .from("users")
    .select("id, username, role, display_name, ministry, profile_emoji")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const token = createToken(user);
  invalidate(`auth:user:${user.id}`);

  const response = NextResponse.json({ user });
  const cookieOpts = getTokenCookieOptions();
  response.cookies.set(cookieOpts.name, token, cookieOpts);
  return response;
}

export async function DELETE() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }
  // DELETE deliberately doesn't require SUPABASE_ENVIRONMENT=dev — clearing
  // a cookie has no effect on any database.
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
  return response;
}
