import crypto from "node:crypto";

function normalizeIp(candidate) {
  if (!candidate) return null;
  const first = String(candidate).split(",")[0]?.trim();
  if (!first || first.length > 120) return null;

  const unwrapped = first.replace(/^\[/, "").replace(/\]$/, "");
  if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(unwrapped)) {
    return unwrapped.replace(/:\d+$/, "");
  }

  if (/^[a-fA-F0-9:]+$/.test(unwrapped)) {
    return unwrapped;
  }

  return null;
}

export function getRequestClientIdentifier(request) {
  const headers = request.headers;
  const ip =
    normalizeIp(headers.get("cf-connecting-ip")) ||
    normalizeIp(headers.get("x-real-ip")) ||
    normalizeIp(headers.get("x-forwarded-for"));

  if (ip) return `ip:${ip}`;

  const fingerprintSource = [
    headers.get("user-agent") || "unknown-agent",
    headers.get("accept-language") || "unknown-lang",
    headers.get("sec-ch-ua-platform") || "unknown-platform",
  ].join("|");

  const hash = crypto
    .createHash("sha256")
    .update(fingerprintSource)
    .digest("hex")
    .slice(0, 16);

  return `fp:${hash}`;
}
