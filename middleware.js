import { NextResponse } from "next/server";
import { COOKIE_NAME, verifyJwtHs256 } from "@/lib/utils/jwt";

// Routes that require authentication
const PROTECTED_ROUTES = ["/profile", "/admin"];
// Routes that require admin role
const ADMIN_ROUTES = ["/admin"];
// Routes only for unauthenticated users
const AUTH_ROUTES = ["/login", "/register"];

function redirectWithClearedCookie(path, request) {
  const response = NextResponse.redirect(new URL(path, request.url));
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export default async function proxy(request) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const user = token ? await verifyJwtHs256(token) : null;

  // Redirect authenticated users away from login/register
  if (AUTH_ROUTES.some((r) => pathname.startsWith(r))) {
    if (user) {
      return NextResponse.redirect(new URL("/home", request.url));
    }
    return NextResponse.next();
  }

  if (pathname === "/inventory") {
    return NextResponse.redirect(new URL("/home", request.url));
  }

  // Protect authenticated routes
  if (PROTECTED_ROUTES.some((r) => pathname.startsWith(r))) {
    if (!user) {
      return redirectWithClearedCookie("/login", request);
    }
    // Admin-only routes
    if (
      ADMIN_ROUTES.some((r) => pathname.startsWith(r)) &&
      user.role !== "admin"
    ) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/home/:path*",
    "/inventory/:path*",
    "/loans/:path*",
    "/profile/:path*",
    "/admin/:path*",
    "/login",
    "/register",
  ],
};
