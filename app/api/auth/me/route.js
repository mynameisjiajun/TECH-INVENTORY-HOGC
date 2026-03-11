import { getCurrentUser } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null });

  const db = getDb();
  const today = new Date().toISOString().split('T')[0];

  const overdueLoans = db.prepare(`
    SELECT id FROM loan_requests
    WHERE user_id = ? AND status = 'approved' AND loan_type = 'temporary'
      AND end_date IS NOT NULL AND end_date < ?
  `).all(user.id, today);

  return NextResponse.json({ user, overdueCount: overdueLoans.length });
}
