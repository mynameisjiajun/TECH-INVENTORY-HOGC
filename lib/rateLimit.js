/**
 * Simple in-memory rate limiter for serverless functions.
 * Limits are per-instance (reset on cold start), which still provides
 * meaningful protection against brute-force during active sessions.
 */
const store = new Map();

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 10; // max attempts per window

// Clean up expired entries periodically
function cleanup() {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.start > WINDOW_MS) {
      store.delete(key);
    }
  }
}

setInterval(cleanup, 60 * 1000);

/**
 * Check if a key (e.g. IP or username) has exceeded the rate limit.
 * @returns {{ limited: boolean, remaining: number, retryAfterSeconds: number }}
 */
export function checkRateLimit(key) {
  const now = Date.now();
  let entry = store.get(key);

  if (!entry || now - entry.start > WINDOW_MS) {
    entry = { count: 0, start: now };
    store.set(key, entry);
  }

  entry.count++;

  if (entry.count > MAX_ATTEMPTS) {
    const retryAfterSeconds = Math.ceil((entry.start + WINDOW_MS - now) / 1000);
    return { limited: true, remaining: 0, retryAfterSeconds };
  }

  return {
    limited: false,
    remaining: MAX_ATTEMPTS - entry.count,
    retryAfterSeconds: 0,
  };
}

/**
 * Reset the rate limit for a key (e.g. after successful login).
 */
export function resetRateLimit(key) {
  store.delete(key);
}
