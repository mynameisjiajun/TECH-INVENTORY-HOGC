import { NextResponse } from "next/server";

const COOKIE_NAME = "tech-inventory-token";

// Routes that require authentication
const PROTECTED_ROUTES = [
  "/dashboard",
  "/inventory",
  "/loans",
  "/profile",
  "/admin",
];
// Routes that require admin role
const ADMIN_ROUTES = ["/admin"];
// Routes only for unauthenticated users
const AUTH_ROUTES = ["/login", "/register"];

async function verifyJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const secretStr = process.env.JWT_SECRET;
    if (!secretStr) return null; // Fail safe if secret is not set

    const encoder = new TextEncoder();
    const data = encoder.encode(`${headerB64}.${payloadB64}`);

    // Convert base64url to standard base64 and then to Uint8Array
    const signatureStr = atob(signatureB64.replace(/-/g, "+").replace(/_/g, "/"));
    const signature = new Uint8Array(signatureStr.length);
    for (let i = 0; i < signatureStr.length; i++) {
      signature[i] = signatureStr.charCodeAt(i);
    }

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secretStr),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const isValid = await crypto.subtle.verify("HMAC", key, signature, data);
    if (!isValid) return null;

    const payload = JSON.parse(
      atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")),
    );
    // Check expiry
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

export default async function middleware(request) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const user = token ? await verifyJwt(token) : null;

  // Redirect authenticated users away from login/register
  if (AUTH_ROUTES.some((r) => pathname.startsWith(r))) {
    if (user) {
      return NextResponse.redirect(new URL("/inventory", request.url));
    }
    return NextResponse.next();
  }

  // Protect authenticated routes
  if (PROTECTED_ROUTES.some((r) => pathname.startsWith(r))) {
    if (!user) {
      return NextResponse.redirect(new URL("/login", request.url));
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
    "/inventory/:path*",
    "/loans/:path*",
    "/profile/:path*",
    "/admin/:path*",
    "/login",
    "/register",
  ],
};
