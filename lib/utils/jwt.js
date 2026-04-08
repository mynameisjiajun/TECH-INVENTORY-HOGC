const textEncoder = new TextEncoder();

export const COOKIE_NAME = "tech-inventory-token";

export function getJwtSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (secret) return secret;

  if (process.env.NODE_ENV === "test") {
    return "test-jwt-secret";
  }

  throw new Error("JWT_SECRET must be set in environment variables");
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );

  if (typeof atob === "function") {
    return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  }

  return Uint8Array.from(Buffer.from(padded, "base64"));
}

function decodeJsonPart(value) {
  return JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
}

function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

async function signHs256(input, secret) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  return new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, textEncoder.encode(input)),
  );
}

export async function verifyJwtHs256(token, secret = getJwtSecret()) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    const header = decodeJsonPart(encodedHeader);
    if (header?.alg !== "HS256" || header?.typ !== "JWT") {
      return null;
    }

    const payload = decodeJsonPart(encodedPayload);
    if (!payload || typeof payload !== "object") return null;

    const expectedSignature = await signHs256(
      `${encodedHeader}.${encodedPayload}`,
      secret,
    );
    const providedSignature = decodeBase64Url(encodedSignature);
    if (!timingSafeEqual(expectedSignature, providedSignature)) {
      return null;
    }

    const nowInSeconds = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp <= nowInSeconds) return null;
    if (payload.nbf && payload.nbf > nowInSeconds) return null;

    return payload;
  } catch {
    return null;
  }
}
