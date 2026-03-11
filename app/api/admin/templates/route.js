import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const templates = db.prepare(`
    SELECT lt.*, u.display_name as created_by_name
    FROM loan_templates lt
    JOIN users u ON lt.created_by = u.id
    ORDER BY lt.created_at DESC
  `).all();

  return NextResponse.json({
    templates: templates.map(t => ({ ...t, items: JSON.parse(t.items_json) })),
  });
}

export async function POST(request) {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const db = getDb();
  const { action, id, name, description, loan_type, items } = await request.json();

  if (action === 'create' || action === 'update') {
    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Template name is required' }, { status: 400 });
    }
    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'At least one item is required' }, { status: 400 });
    }

    // Validate items exist
    for (const item of items) {
      const si = db.prepare('SELECT id, item FROM storage_items WHERE id = ?').get(item.item_id);
      if (!si) return NextResponse.json({ error: `Item not found: ${item.item_id}` }, { status: 400 });
    }

    const itemsJson = JSON.stringify(items);

    if (action === 'create') {
      const result = db.prepare(`
        INSERT INTO loan_templates (name, description, loan_type, items_json, created_by)
        VALUES (?, ?, ?, ?, ?)
      `).run(name.trim(), description || '', loan_type || 'temporary', itemsJson, user.id);
      return NextResponse.json({ message: 'Template created', id: result.lastInsertRowid });
    } else {
      if (!id) return NextResponse.json({ error: 'Template ID required' }, { status: 400 });
      db.prepare(`
        UPDATE loan_templates SET name=?, description=?, loan_type=?, items_json=? WHERE id=?
      `).run(name.trim(), description || '', loan_type || 'temporary', itemsJson, id);
      return NextResponse.json({ message: 'Template updated' });
    }
  }

  if (action === 'delete') {
    if (!id) return NextResponse.json({ error: 'Template ID required' }, { status: 400 });
    db.prepare('DELETE FROM loan_templates WHERE id = ?').run(id);
    return NextResponse.json({ message: 'Template deleted' });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
