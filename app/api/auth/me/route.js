import { getCurrentUser } from "@/lib/utils/auth";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const COOKIE_NAME = "tech-inventory-token";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    const cookieStore = await cookies();
    const token = cookieStore.get(COOKIE_NAME)?.value;
    if (token) {
      const response = NextResponse.json({ user: null });
      response.cookies.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
      return response;
    }
    return NextResponse.json({ user: null });
  }

  return NextResponse.json({ user });
}
