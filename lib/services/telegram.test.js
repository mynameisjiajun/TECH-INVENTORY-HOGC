import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendTelegramMessage } from './telegram.js';
import { getDb } from '@/lib/db/db';

vi.mock('@/lib/db/db', () => ({
  getDb: vi.fn()
}));

describe('sendTelegramMessage', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    global.fetch = vi.fn();

    // Mock console.error to avoid noise in test output
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('should return false if TELEGRAM_BOT_TOKEN is not set', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    const result = await sendTelegramMessage(1, 'Hello');
    expect(result).toBe(false);
    expect(getDb).not.toHaveBeenCalled();
  });

  it('should return false if user is not found', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test_token';
    const mockPrepare = vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(null)
    });
    getDb.mockReturnValue({ prepare: mockPrepare });

    const result = await sendTelegramMessage(1, 'Hello');
    expect(result).toBe(false);
    expect(mockPrepare).toHaveBeenCalledWith("SELECT telegram_chat_id FROM users WHERE id = ?");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should return false if user has no telegram_chat_id', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test_token';
    const mockPrepare = vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({ telegram_chat_id: null })
    });
    getDb.mockReturnValue({ prepare: mockPrepare });

    const result = await sendTelegramMessage(1, 'Hello');
    expect(result).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('should return true if fetch succeeds', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test_token';
    const mockPrepare = vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({ telegram_chat_id: 'chat_123' })
    });
    getDb.mockReturnValue({ prepare: mockPrepare });

    global.fetch.mockResolvedValue({
      ok: true
    });

    const result = await sendTelegramMessage(1, 'Hello');
    expect(result).toBe(true);
    expect(global.fetch).toHaveBeenCalledWith('https://api.telegram.org/bottest_token/sendMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: 'chat_123',
        text: 'Hello',
        parse_mode: 'HTML',
      }),
    });
  });

  it('should return false if fetch fails (res.ok is false)', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test_token';
    const mockPrepare = vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({ telegram_chat_id: 'chat_123' })
    });
    getDb.mockReturnValue({ prepare: mockPrepare });

    global.fetch.mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ error_code: 400, description: 'Bad Request' })
    });

    const result = await sendTelegramMessage(1, 'Hello');
    expect(result).toBe(false);
    expect(console.error).toHaveBeenCalledWith('Telegram API Error:', { error_code: 400, description: 'Bad Request' });
  });

  it('should return false if json parsing fails on error response', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test_token';
    const mockPrepare = vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({ telegram_chat_id: 'chat_123' })
    });
    getDb.mockReturnValue({ prepare: mockPrepare });

    global.fetch.mockResolvedValue({
      ok: false,
      json: vi.fn().mockRejectedValue(new Error('Parse error'))
    });

    const result = await sendTelegramMessage(1, 'Hello');
    expect(result).toBe(false);
    expect(console.error).toHaveBeenCalledWith('Telegram API Error:', {});
  });

  it('should return false if an exception is thrown', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test_token';
    getDb.mockImplementation(() => {
      throw new Error('Database error');
    });

    const result = await sendTelegramMessage(1, 'Hello');
    expect(result).toBe(false);
    expect(console.error).toHaveBeenCalledWith('Failed to send Telegram message:', 'Database error');
  });
});
