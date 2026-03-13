import { test } from 'node:test';
import assert from 'node:assert';
import { sendTelegramMessage } from './telegram.js';
import { getDb } from '@/lib/db/db.js';

function setupDb() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      email TEXT DEFAULT NULL,
      telegram_chat_id TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, password_hash, display_name, telegram_chat_id)
    VALUES (999, 'testuser', 'hash', 'Test', '12345')
  `).run();

  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, password_hash, display_name, telegram_chat_id)
    VALUES (998, 'testuser2', 'hash', 'Test2', NULL)
  `).run();

  return db;
}

test('sendTelegramMessage returns false when fetch returns ok: false', async (t) => {
  setupDb();

  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = 'test_token';

  t.mock.method(global, 'fetch', async () => {
    return {
      ok: false,
      json: async () => ({ error_code: 400, description: 'Bad Request' }),
    };
  });

  const originalConsoleError = console.error;
  t.mock.method(console, 'error', () => {});

  const result = await sendTelegramMessage(999, 'Hello');

  assert.strictEqual(result, false);

  process.env.TELEGRAM_BOT_TOKEN = originalToken;
  console.error = originalConsoleError;
});

test('sendTelegramMessage returns false when API throws an error', async (t) => {
  setupDb();

  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = 'test_token';

  t.mock.method(global, 'fetch', async () => {
    throw new Error('Network error');
  });

  const originalConsoleError = console.error;
  t.mock.method(console, 'error', () => {});

  const result = await sendTelegramMessage(999, 'Hello');

  assert.strictEqual(result, false);

  process.env.TELEGRAM_BOT_TOKEN = originalToken;
  console.error = originalConsoleError;
});

test('sendTelegramMessage returns true when API is successful', async (t) => {
  setupDb();

  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = 'test_token';

  t.mock.method(global, 'fetch', async () => {
    return {
      ok: true,
      json: async () => ({ ok: true, result: {} }),
    };
  });

  const result = await sendTelegramMessage(999, 'Hello');

  assert.strictEqual(result, true);

  process.env.TELEGRAM_BOT_TOKEN = originalToken;
});

test('sendTelegramMessage returns false when telegram_chat_id is null', async (t) => {
  setupDb();

  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = 'test_token';

  const result = await sendTelegramMessage(998, 'Hello');

  assert.strictEqual(result, false);

  process.env.TELEGRAM_BOT_TOKEN = originalToken;
});

test('sendTelegramMessage returns false when bot token is not set', async (t) => {
  setupDb();

  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_BOT_TOKEN;

  const result = await sendTelegramMessage(999, 'Hello');

  assert.strictEqual(result, false);

  process.env.TELEGRAM_BOT_TOKEN = originalToken;
});
