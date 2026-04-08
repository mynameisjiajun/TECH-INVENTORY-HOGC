import { getDb, startSyncIfNeeded, waitForSync } from "@/lib/db/db";
import { cached } from "@/lib/utils/cache";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL = 30_000;

function fuzzyMatch(text, search) {
  if (!text || !search) return false;
  const normalize = (value) => value.toLowerCase().replace(/[\s\-_\/\.]+/g, "");
  const textValue = String(text);
  const normalizedText = normalize(textValue);
  const normalizedSearch = normalize(search);

  if (normalizedText.includes(normalizedSearch)) return true;

  const words = search
    .toLowerCase()
    .replace(/[\-_\/\.]+/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const lowerText = textValue.toLowerCase().replace(/[\-_\/\.]+/g, " ");

  if (words.length > 0 && words.every((word) => lowerText.includes(word))) {
    return true;
  }

  return false;
}

function respond(data) {
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, max-age=15, stale-while-revalidate=30",
    },
  });
}

export async function GET(request) {
  try {
    startSyncIfNeeded();
    await waitForSync();
    const db = getDb();

    const { searchParams } = new URL(request.url);
    const search = (searchParams.get("search") || "").trim().slice(0, 100);

    let items = await cached(
      "guest-storage-items",
      () =>
        db
          .prepare(
            `
              SELECT id, sheet_row, item, type, brand, model, current, location
              FROM storage_items
              WHERE current > 0
              ORDER BY item ASC, brand ASC, sheet_row ASC, id ASC
            `,
          )
          .all(),
      CACHE_TTL,
    );

    if (search) {
      items = items.filter(
        (item) =>
          fuzzyMatch(item.item, search) ||
          fuzzyMatch(item.brand, search) ||
          fuzzyMatch(item.type, search) ||
          fuzzyMatch(item.model, search) ||
          fuzzyMatch(item.location, search),
      );
    }

    return respond({ items });
  } catch (error) {
    console.error("Guest items GET error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to load guest inventory" },
      { status: 500 },
    );
  }
}
