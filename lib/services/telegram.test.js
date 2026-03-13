import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { sendTelegramMessage } from './telegram';
import * as dbModule from '@/lib/db/db';

describe('sendTelegramMessage', () => {
  const originalEnv = process.env.TELEGRAM_BOT_TOKEN;
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalEnv === undefined) {
      delete process.env.TELEGRAM_BOT_TOKEN;
    } else {
      process.env.TELEGRAM_BOT_TOKEN = originalEnv;
    }
    vi.restoreAllMocks();
  });

  it('should return false when fetch throws an error', async () => {
    // Mock the database getDb call and the resulting user object
    const mockGet = vi.fn().mockReturnValue({ telegram_chat_id: '12345' });
    const mockPrepare = vi.fn().mockReturnValue({ get: mockGet });

    vi.spyOn(dbModule, 'getDb').mockReturnValue({
      prepare: mockPrepare,
    });

    // Mock global.fetch to throw an error
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    // Spy on console.error to avoid polluting test output
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await sendTelegramMessage(1, 'Hello');

    expect(result).toBe(false);
    expect(global.fetch).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith('Failed to send Telegram message:', 'Network error');
  });
});
