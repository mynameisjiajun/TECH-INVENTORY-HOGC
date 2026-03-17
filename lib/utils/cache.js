/**
 * Simple in-memory cache with TTL for Vercel serverless.
 * Survives across requests within the same warm instance.
 * Automatically invalidated on cold start (module re-initializes).
 */

const _store = new Map();

/**
 * Get a cached value, or compute and cache it.
 * @param {string} key - Cache key
 * @param {Function} fn - Function to compute value (can be async)
 * @param {number} ttlMs - Time to live in milliseconds (default: 60s)
 */
export async function cached(key, fn, ttlMs = 60_000) {
  const entry = _store.get(key);
  if (entry && Date.now() < entry.expiresAt) {
    return entry.value;
  }

  const value = await fn();
  _store.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/**
 * Invalidate a specific cache key or all keys matching a prefix.
 * @param {string} keyOrPrefix - Exact key or prefix to match
 */
export function invalidate(keyOrPrefix) {
  if (_store.has(keyOrPrefix)) {
    _store.delete(keyOrPrefix);
    return;
  }
  // Prefix match
  for (const key of _store.keys()) {
    if (key.startsWith(keyOrPrefix)) {
      _store.delete(key);
    }
  }
}

/**
 * Invalidate all cached data. Called after mutations.
 */
export function invalidateAll() {
  _store.clear();
}
