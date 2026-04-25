import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { supabase } from "@/lib/db/supabase";
import { COOKIE_NAME, getJwtSecret } from "@/lib/utils/jwt";
import { cached } from "@/lib/utils/cache";

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
      ministry: user.ministry ?? null,
      profile_emoji: user.profile_emoji ?? null,
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

  // Cache the DB lookup for 30s per warm instance so repeated requests within
  // the same page load don't each hit Supabase. invalidateAll() clears this on mutations.
  const fresh = await cached(
    `auth:user:${payload.id}`,
    async () => {
      const { data } = await supabase
        .from("users")
        .select("id, username, display_name, role, ministry, profile_emoji")
        .eq("id", payload.id)
        .maybeSingle();
      return data;
    },
    30_000,
  );

  if (!fresh) return null;
  return { ...payload, role: fresh.role, display_name: fresh.display_name, ministry: fresh.ministry ?? null, profile_emoji: fresh.profile_emoji ?? null };
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
