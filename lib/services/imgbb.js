/**
 * Upload a base64 image to ImgBB (free permanent image hosting).
 * Get a free API key at https://imgbb.com/
 * Add IMGBB_API_KEY to your Vercel environment variables.
 *
 * @param {string} base64Data - base64 string or data URI
 * @returns {Promise<string>} - permanent public image URL
 */
export async function uploadToImgBB(base64Data) {
  const apiKey = process.env.IMGBB_API_KEY;
  if (!apiKey) throw new Error("IMGBB_API_KEY is not set");

  // Strip data URI prefix if present
  const base64 = base64Data.includes(",")
    ? base64Data.split(",")[1]
    : base64Data;

  const body = new URLSearchParams();
  body.append("key", apiKey);
  body.append("image", base64);

  const res = await fetch("https://api.imgbb.com/1/upload", {
    method: "POST",
    body,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`ImgBB upload failed: ${err?.error?.message || res.status}`);
  }

  const data = await res.json();
  if (!data.success) throw new Error("ImgBB upload failed");

  return data.data.url;
}
