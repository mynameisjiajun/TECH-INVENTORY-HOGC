import { getDb } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

// GET: fetch loan requests
export async function GET(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || '';
  const view = searchParams.get('view') || 'my'; // 'my' or 'all' (admin)

  let query = `
    SELECT lr.*, u.display_name as requester_name, u.username as requester_username
    FROM loan_requests lr
    JOIN users u ON lr.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (view !== 'all' || user.role !== 'admin') {
    query += ' AND lr.user_id = ?';
    params.push(user.id);
  }
  if (status) {
    query += ' AND lr.status = ?';
    params.push(status);
  }
  query += ' ORDER BY lr.created_at DESC';

  const loans = db.prepare(query).all(...params);

  // Get items for each loan
  for (const loan of loans) {
    loan.items = db.prepare(`
      SELECT li.*, si.item, si.type, si.brand, si.model
      FROM loan_items li
      JOIN storage_items si ON li.item_id = si.id
      WHERE li.loan_request_id = ?
    `).all(loan.id);
  }

  return NextResponse.json({ loans });
}

// POST: create a new loan request
export async function POST(request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { loan_type, purpose, department, start_date, end_date, location, items } = await request.json();

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'No items selected' }, { status: 400 });
    }
    for (const item of items) {
      if (!item.quantity || item.quantity < 1 || !Number.isInteger(item.quantity)) {
        return NextResponse.json({ error: 'Each item must have a quantity of at least 1' }, { status: 400 });
      }
    }
    if (!purpose || !purpose.trim()) {
      return NextResponse.json({ error: 'Purpose is required' }, { status: 400 });
    }
    if (!start_date) {
      return NextResponse.json({ error: 'Start date is required' }, { status: 400 });
    }
    if (loan_type === 'temporary' && !end_date) {
      return NextResponse.json({ error: 'End date is required for temporary loans' }, { status: 400 });
    }

    const db = getDb();

    const createLoanTx = db.transaction(() => {
      for (const item of items) {
        const storageItem = db.prepare('SELECT * FROM storage_items WHERE id = ?').get(item.item_id);
        if (!storageItem) {
          throw new Error(`Item not found: ${item.item_id}`);
        }
        if (storageItem.current < item.quantity) {
          throw new Error(`Not enough stock for "${storageItem.item}". Available: ${storageItem.current}, Requested: ${item.quantity}`);
        }
      }

      const result = db.prepare(`
        INSERT INTO loan_requests (user_id, loan_type, purpose, department, location, start_date, end_date)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(user.id, loan_type, purpose.trim(), department || '', location || '', start_date, end_date || null);

      const loanId = result.lastInsertRowid;

      const insertItem = db.prepare('INSERT INTO loan_items (loan_request_id, item_id, quantity) VALUES (?, ?, ?)');
      for (const item of items) {
        insertItem.run(loanId, item.item_id, item.quantity);
      }

      const admins = db.prepare('SELECT id FROM users WHERE role = ?').all('admin');
      const insertNotif = db.prepare('INSERT INTO notifications (user_id, message, link) VALUES (?, ?, ?)');
      for (const admin of admins) {
        insertNotif.run(admin.id, `New ${loan_type} loan request from ${user.display_name}`, '/admin');
      }

      return loanId;
    });

    try {
      const loanId = createLoanTx();
      return NextResponse.json({ loan_id: loanId, message: 'Loan request submitted!' });
    } catch (txErr) {
      return NextResponse.json({ error: txErr.message }, { status: 400 });
    }
  } catch (error) {
    console.error('Loan creation error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
