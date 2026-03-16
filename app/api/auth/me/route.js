import { getCurrentUser } from "@/lib/utils/auth";
import { getDb, ensureUserExists, ensureUsersRestored } from "@/lib/db/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const COOKIE_NAME = "tech-inventory-token";

export async function GET() {
  await ensureUsersRestored();
  const user = await getCurrentUser();
  if (!user) {
    // If there's a stale/invalid token cookie, clear it so the middleware
    // doesn't keep redirecting the user away from /login.
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (token) {
      const response = NextResponse.json({ user: null });
      response.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
      return response;
    }
    return NextResponse.json({ user: null });
  }

  const db = getDb();
  ensureUserExists(user);
  const today = new Date().toISOString().split("T")[0];

  const overdueLoans = db
    .prepare(
      `
    SELECT id FROM loan_requests
    WHERE user_id = ? AND status = 'approved' AND loan_type = 'temporary'
      AND end_date IS NOT NULL AND end_date < ?
  `,
    )
    .all(user.id, today);

  return NextResponse.json({ user, overdueCount: overdueLoans.length });
}
