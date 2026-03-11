import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

// Fuzzy search: normalize search term and target by removing spaces, 
// dashes, and converting to lowercase for comparison
function fuzzyMatch(text, search) {
  if (!text || !search) return false;
  const normalize = (s) => s.toLowerCase().replace(/[\s\-_\/\.]+/g, '');
  const normalizedText = normalize(String(text));
  const normalizedSearch = normalize(search);
  // Check if the normalized search is a substring of normalized text
  if (normalizedText.includes(normalizedSearch)) return true;
  // Also check each word in the search against the text
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every(word => normalizedText.includes(normalize(word)));
}

export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(request.url);
  const tab = searchParams.get('tab') || 'storage';
  const search = searchParams.get('search') || '';
  const type = searchParams.get('type') || '';
  const brand = searchParams.get('brand') || '';

  if (tab === 'storage') {
    let query = 'SELECT * FROM storage_items WHERE 1=1';
    const params = [];
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    if (brand) {
      query += ' AND brand = ?';
      params.push(brand);
    }
    query += ' ORDER BY sheet_row ASC, id ASC';
    let items = db.prepare(query).all(...params);

    // Apply fuzzy search in JS for smart matching
    if (search) {
      items = items.filter(item =>
        fuzzyMatch(item.item, search) ||
        fuzzyMatch(item.brand, search) ||
        fuzzyMatch(item.type, search) ||
        fuzzyMatch(item.model, search) ||
        fuzzyMatch(item.location, search)
      );
    }

    // Get filter options
    const types = db.prepare('SELECT DISTINCT type FROM storage_items ORDER BY type').all().map(r => r.type);
    const brands = db.prepare("SELECT DISTINCT brand FROM storage_items WHERE brand != '-' ORDER BY brand").all().map(r => r.brand);

    return NextResponse.json({ items, filters: { types, brands } });
  }

  if (tab === 'deployed') {
    let query = 'SELECT * FROM deployed_items WHERE 1=1';
    const params = [];
    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    if (brand) {
      query += ' AND brand = ?';
      params.push(brand);
    }
    query += ' ORDER BY id ASC';
    let items = db.prepare(query).all(...params);

    // Apply fuzzy search
    if (search) {
      items = items.filter(item =>
        fuzzyMatch(item.item, search) ||
        fuzzyMatch(item.brand, search) ||
        fuzzyMatch(item.type, search) ||
        fuzzyMatch(item.model, search)
      );
    }

    // Get filter options for deployed tab
    const types = db.prepare('SELECT DISTINCT type FROM deployed_items ORDER BY type').all().map(r => r.type);
    const brands = db.prepare("SELECT DISTINCT brand FROM deployed_items WHERE brand != '-' ORDER BY brand").all().map(r => r.brand);

    return NextResponse.json({ items, filters: { types, brands } });
  }

  if (tab === 'total_quantity') {
    const items = db.prepare(`
      SELECT type,
             SUM(quantity_spare) as total_spare,
             SUM(current) as total_current,
             SUM(quantity_spare - current) as total_loaned
      FROM storage_items
      GROUP BY type
      ORDER BY type
    `).all();
    return NextResponse.json({ items });
  }

  if (tab === 'total_breakdown') {
    const items = db.prepare(`
      SELECT item, type, brand, model, quantity_spare,
             current, (quantity_spare - current) as loaned_out
      FROM storage_items
      ORDER BY sheet_row ASC, id ASC
    `).all();
    return NextResponse.json({ items });
  }

  if (tab === 'low_stock') {
    const items = db.prepare(`
      SELECT * FROM storage_items
      WHERE current <= 2 AND quantity_spare > 0
      ORDER BY current ASC, item ASC
    `).all();
    return NextResponse.json({ items });
  }

  return NextResponse.json({ error: 'Invalid tab' }, { status: 400 });
}
