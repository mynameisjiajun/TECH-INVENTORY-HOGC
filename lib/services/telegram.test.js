import { test, mock } from 'node:test';
import assert from 'node:assert';
import { sendTelegramMessage } from './telegram.js';
import * as dbModule from '@/lib/db/db.js';

test('sendTelegramMessage without chat_id returns false', async () => {
    // Save original env
    const originalEnv = process.env.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_BOT_TOKEN = 'fake-token';

    const db = dbModule.getDb();

    // We mock the `prepare` and `get` functions of the existing db object
    mock.method(db, 'prepare', (query) => {
        if (query === 'SELECT telegram_chat_id FROM users WHERE id = ?') {
            return {
                get: (userId) => {
                    // Return mock user without a chat_id
                    return { telegram_chat_id: null };
                }
            };
        }
        // Fallback for other queries if any
        return { get: () => null, run: () => null, all: () => [] };
    });

    try {
        const result = await sendTelegramMessage(1234, 'Test Message');
        assert.strictEqual(result, false, 'Expected false when user has no chat_id');
    } finally {
        mock.restoreAll();
        process.env.TELEGRAM_BOT_TOKEN = originalEnv;
    }
});

test('sendTelegramMessage returns false when bot token is not set', async () => {
    const originalEnv = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;

    try {
        const result = await sendTelegramMessage(1, 'Test Message');
        assert.strictEqual(result, false, 'Expected false when no bot token is set');
    } finally {
        process.env.TELEGRAM_BOT_TOKEN = originalEnv;
    }
});
