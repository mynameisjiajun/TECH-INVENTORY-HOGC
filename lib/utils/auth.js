import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { supabase } from "@/lib/db/supabase";

const devJwtSecret =
  process.env.NODE_ENV === "production"
    ? null
    : crypto.randomBytes(32).toString("hex");
let warnedAboutDevJwtSecret = false;

function getJwtSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;

  if (process.env.NODE_ENV === "test") {
    return "test-jwt-secret";
  }

  if (process.env.NODE_ENV !== "production" && devJwtSecret) {
    if (!warnedAboutDevJwtSecret) {
      console.warn(
        "JWT_SECRET is not set; using an ephemeral development secret.",
      );
      warnedAboutDevJwtSecret = true;
    }
    return devJwtSecret;
  }

  throw new Error("JWT_SECRET must be set in environment variables");
}

const COOKIE_NAME = "tech-inventory-token";

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      display_name: user.display_name,
    },
    getJwtSecret(),
    { expiresIn: "7d" },
  );
}

// Reset tokens are signed with JWT_SECRET + tail of the user's current password hash.
// This means the token is automatically invalidated once the password changes.
function resetSecret(passwordHash) {
  return getJwtSecret() + (passwordHash || "").slice(-10);
}

export function createResetToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, purpose: "password_reset" },
    resetSecret(user.password_hash),
    { expiresIn: "1h" },
  );
}

export function verifyResetToken(token, currentPasswordHash) {
  try {
    const payload = jwt.verify(token, resetSecret(currentPasswordHash));
    if (payload.purpose !== "password_reset") return null;
    return payload;
  } catch {
    return null;
  }
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch {
    return null;
  }
}

// Decode without signature verification — only use to extract claims before full verify
export function decodeTokenUnsafe(token) {
  try {
    return jwt.decode(token);
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;

  // Always fetch the current role from DB so role changes take effect immediately
  // without requiring the user to log out and back in.
  const { data: fresh } = await supabase
    .from("users")
    .select("id, username, display_name, role")
    .eq("id", payload.id)
    .single();

  if (!fresh) return null;
  return { ...payload, role: fresh.role, display_name: fresh.display_name };
}

export function getTokenCookieOptions() {
  return {
    name: COOKIE_NAME,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  };
}
