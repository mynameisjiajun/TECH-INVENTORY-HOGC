import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is missing");
  }
  return secret;
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

export function createResetToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      purpose: "password_reset",
    },
    getJwtSecret(),
    { expiresIn: "1h" },
  );
}

export function verifyResetToken(token) {
  try {
    const payload = jwt.verify(token, getJwtSecret());
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

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyToken(token);
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
