import { getDb, getSetting } from '@/lib/db';
import { hashPassword, verifyPassword, createToken, getTokenCookieOptions } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { action, username, password, display_name, invite_code } = await request.json();

    const db = getDb();

    if (action === 'register') {
      if (!username || username.trim().length < 2) {
        return NextResponse.json({ error: 'Username must be at least 2 characters' }, { status: 400 });
      }
      if (!password || password.length < 6) {
        return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 });
      }

      // Validate invite code (stored in DB, editable by admins)
      const currentInviteCode = getSetting('invite_code') || process.env.INVITE_CODE;
      if (!currentInviteCode || invite_code !== currentInviteCode) {
        return NextResponse.json({ error: 'Invalid invite code' }, { status: 403 });
      }

      // Check if username exists
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        return NextResponse.json({ error: 'Username already taken' }, { status: 409 });
      }

      // Create user
      const hash = hashPassword(password);
      const result = db.prepare(
        'INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)'
      ).run(username, hash, display_name || username, 'user');

      const user = { id: result.lastInsertRowid, username, role: 'user', display_name: display_name || username };
      const token = createToken(user);

      const response = NextResponse.json({ user });
      const cookieOpts = getTokenCookieOptions();
      response.cookies.set(cookieOpts.name, token, cookieOpts);
      return response;
    }

    if (action === 'login') {
      if (!username || !password) {
        return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
      }
      const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      if (!user || !verifyPassword(password, user.password_hash)) {
        return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
      }

      const token = createToken(user);
      const response = NextResponse.json({
        user: { id: user.id, username: user.username, role: user.role, display_name: user.display_name }
      });
      const cookieOpts = getTokenCookieOptions();
      response.cookies.set(cookieOpts.name, token, cookieOpts);
      return response;
    }

    if (action === 'logout') {
      const response = NextResponse.json({ ok: true });
      response.cookies.set('tech-inventory-token', '', { maxAge: 0, path: '/' });
      return response;
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
