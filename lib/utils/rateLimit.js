import { supabase } from "@/lib/db/supabase";

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 10;
const fallbackStore = new Map();

function fallbackCheckRateLimit(key) {
  const now = Date.now();
  const windowMs = WINDOW_SECONDS * 1000;

  for (const [k, v] of fallbackStore.entries()) {
    if (now - v.start > windowMs) fallbackStore.delete(k);
  }

  let entry = fallbackStore.get(key);

  if (!entry || now - entry.start > windowMs) {
    entry = { count: 0, start: now };
    fallbackStore.set(key, entry);
  }

  entry.count += 1;

  if (entry.count > MAX_ATTEMPTS) {
    return {
      limited: true,
      remaining: 0,
      retryAfterSeconds: Math.ceil((entry.start + windowMs - now) / 1000),
    };
  }

  return {
    limited: false,
    remaining: MAX_ATTEMPTS - entry.count,
    retryAfterSeconds: 0,
  };
}

export async function checkRateLimit(key) {
  try {
    const { data, error } = await supabase.rpc("check_rate_limit", {
      rate_key: key,
      max_attempts: MAX_ATTEMPTS,
      window_seconds: WINDOW_SECONDS,
    });

    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;
    if (!result) throw new Error("Missing rate limit result");

    return {
      limited: Boolean(result.limited),
      remaining: Number(result.remaining || 0),
      retryAfterSeconds: Number(result.retry_after_seconds || 0),
    };
  } catch (error) {
    console.error(
      "Supabase rate limiter unavailable, using in-memory fallback:",
      error.message || error,
    );
    return fallbackCheckRateLimit(key);
  }
}

export async function resetRateLimit(key) {
  fallbackStore.delete(key);

  try {
    const { error } = await supabase.rpc("reset_rate_limit", {
      rate_key: key,
    });
    if (error) throw error;
  } catch (error) {
    console.error(
      "Failed to reset Supabase rate limit key:",
      error.message || error,
    );
  }
}
