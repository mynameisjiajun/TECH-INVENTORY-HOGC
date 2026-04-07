import { getDb, waitForSync } from "@/lib/db/db";
import { getCurrentUser } from "@/lib/utils/auth";
import { cached } from "@/lib/utils/cache";
import { NextResponse } from "next/server";

// Fuzzy search: handles word reordering, partial matches, and normalized comparisons.
// e.g. "type c to HDMI cable" will match "HDMI to Type C Cable"
function fuzzyMatch(text, search) {
  if (!text || !search) return false;
  const normalize = (s) => s.toLowerCase().replace(/[\s\-_\/\.]+/g, "");
  const textStr = String(text);
  const normalizedText = normalize(textStr);
  const normalizedSearch = normalize(search);

  // Direct normalized substring match
  if (normalizedText.includes(normalizedSearch)) return true;

  // Split search into words and check all appear in text (any order)
  const textLower = textStr.toLowerCase().replace(/[\-_\/\.]+/g, " ");
  const words = search
    .toLowerCase()
    .replace(/[\-_\/\.]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0);
  if (words.length > 0 && words.every((word) => textLower.includes(word)))
    return true;

  // Try with normalized words against normalized text
  if (
    words.length > 0 &&
    words.every((word) => normalizedText.includes(normalize(word)))
  )
    return true;

  // Combine adjacent word pairs and try matching
  for (let i = 0; i < words.length - 1; i++) {
    const pair = words[i] + words[i + 1];
    if (normalizedText.includes(pair)) {
      const remaining = [...words.slice(0, i), ...words.slice(i + 2)];
      if (remaining.every((w) => normalizedText.includes(normalize(w))))
        return true;
    }
  }

  return false;
}

// Cache TTL: 30 seconds for inventory data (balances freshness vs performance)
const CACHE_TTL = 30_000;

function getFilters(db, table) {
  return cached(`filters:${table}`, () => {
    const types = db
      .prepare(`SELECT DISTINCT type FROM ${table} ORDER BY type`)
      .all()
      .map((r) => r.type);
    const brands = db
      .prepare(
        `SELECT DISTINCT brand FROM ${table} WHERE brand != '-' ORDER BY brand`,
      )
      .all()
      .map((r) => r.brand);
    return { types, brands };
  }, CACHE_TTL);
}

function respond(data) {
  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "private, s-maxage=10, stale-while-revalidate=30",
    },
  });
}

export async function GET(request) {
  try {
    const user = await getCurrentUser();
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await waitForSync();
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const tab = searchParams.get("tab") || "storage";
    const search = searchParams.get("search") || "";
    const type = searchParams.get("type") || "";
    const brand = searchParams.get("brand") || "";

    if (tab === "storage") {
      let query = "SELECT * FROM storage_items WHERE 1=1";
      const params = [];
      if (type) {
        query += " AND type = ?";
        params.push(type);
      }
      if (brand) {
        query += " AND brand = ?";
        params.push(brand);
      }
      query += " ORDER BY sheet_row ASC, id ASC";
      let items = db.prepare(query).all(...params);

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

      const filters = await getFilters(db, "storage_items");
      return respond({ items, filters });
    }

    if (tab === "deployed") {
      let query = "SELECT * FROM deployed_items WHERE 1=1";
      const params = [];
      if (type) {
        query += " AND type = ?";
        params.push(type);
      }
      if (brand) {
        query += " AND brand = ?";
        params.push(brand);
      }
      query += " ORDER BY id ASC";
      let items = db.prepare(query).all(...params);

      if (search) {
        items = items.filter(
          (item) =>
            fuzzyMatch(item.item, search) ||
            fuzzyMatch(item.brand, search) ||
            fuzzyMatch(item.type, search) ||
            fuzzyMatch(item.model, search),
        );
      }

      const filters = await getFilters(db, "deployed_items");
      return respond({ items, filters });
    }

    if (tab === "total_quantity") {
      const items = await cached(
        "total_quantity",
        () =>
          db.prepare(`
            SELECT type,
                   SUM(quantity_spare) as total_spare,
                   SUM(current) as total_current,
                   SUM(quantity_spare - current) as total_loaned
            FROM storage_items
            GROUP BY type
            ORDER BY type
          `).all(),
        CACHE_TTL,
      );
      return respond({ items });
    }

    if (tab === "total_breakdown") {
      const items = await cached(
        "total_breakdown",
        () =>
          db.prepare(`
            SELECT item, type, brand, model, quantity_spare,
                   current, (quantity_spare - current) as loaned_out
            FROM storage_items
            ORDER BY sheet_row ASC, id ASC
          `).all(),
        CACHE_TTL,
      );
      return respond({ items });
    }

    if (tab === "low_stock") {
      const items = await cached(
        "low_stock",
        () =>
          db.prepare(`
            SELECT * FROM storage_items
            WHERE current <= 2 AND quantity_spare > 0
            ORDER BY current ASC, item ASC
          `).all(),
        CACHE_TTL,
      );
      return respond({ items });
    }

    if (tab === "presets") {
      return respond({ items: [] });
    }

    return NextResponse.json({ error: "Invalid tab" }, { status: 400 });
  } catch (error) {
    console.error("Items GET error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to load inventory" },
      { status: 500 },
    );
  }
}
