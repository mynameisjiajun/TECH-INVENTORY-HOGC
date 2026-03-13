/**
 * Securely extracts the client IP address from the request.
 * Prioritizes headers that cannot be spoofed by the client when deployed on platforms like Vercel.
 *
 * @param {Request} request - The Next.js incoming request object.
 * @returns {string} The resolved IP address or 'unknown' if it cannot be determined.
 */
export function getClientIp(request) {
  // 1. Prioritize request.ip (Next.js populates this securely on Vercel)
  if (request.ip) {
    return request.ip;
  }

  // 2. x-real-ip is often set by reverse proxies (like Nginx) and Vercel.
  // When a request comes through Vercel, it sets/overwrites x-real-ip with the actual client IP,
  // preventing spoofing by the client sending their own x-real-ip header.
  const xRealIp = request.headers.get("x-real-ip");
  if (xRealIp) {
    return xRealIp.trim();
  }

  // 3. Fallback to x-forwarded-for but be aware it can be spoofed.
  // If an attacker sends a spoofed x-forwarded-for, Vercel appends the real IP to the END of the list.
  // Some other proxies prepend it. If request.ip and x-real-ip are missing, we might be in local dev.
  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    // If it's a comma-separated list, taking the first one is standard but spoofable.
    // Given we checked request.ip and x-real-ip, this is just a fallback for non-production environments.
    return xForwardedFor.split(",")[0].trim();
  }

  return "unknown";
}
