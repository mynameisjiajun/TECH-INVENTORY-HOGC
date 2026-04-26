import { test, describe, after } from 'node:test';
import assert from 'node:assert';
import { checkRateLimit, resetRateLimit } from './rateLimit.js';

describe('rateLimit', () => {
  after(() => {
    // The rateLimit module starts a setInterval that keeps the process alive.
    // For testing purposes, we forcefully exit once tests are done.
    setTimeout(() => process.exit(0), 10);
  });

  test('initial rate limit check returns correct structure', () => {
    const key = 'test-initial';
    // Ensure starting clean
    resetRateLimit(key);

    const result = checkRateLimit(key);

    // On the first check, count becomes 1, so remaining is MAX_ATTEMPTS (10) - 1 = 9
    assert.deepStrictEqual(result, {
      limited: false,
      remaining: 9,
      retryAfterSeconds: 0,
    });

    // Clean up
    resetRateLimit(key);
  });

  test('exceeding rate limit', () => {
    const key = 'test-exceed';
    resetRateLimit(key);

    // Hit the limit (10 attempts)
    // 1st attempt: remaining 9
    // 2nd attempt: remaining 8
    // ...
    // 10th attempt: remaining 0
    for (let i = 0; i < 10; i++) {
      const res = checkRateLimit(key);
      assert.strictEqual(res.limited, false);
    }

    // 11th attempt should be limited
    const result = checkRateLimit(key);

    assert.strictEqual(result.limited, true);
    assert.strictEqual(result.remaining, 0);
    assert.ok(result.retryAfterSeconds > 0 && result.retryAfterSeconds <= 900);

    resetRateLimit(key);
  });

  test('reset rate limit', () => {
    const key = 'test-reset';
    resetRateLimit(key);

    // 1 attempt
    checkRateLimit(key);
    // Should be 9 remaining
    assert.strictEqual(checkRateLimit(key).remaining, 8);

    // Reset
    resetRateLimit(key);

    // Should be back to 9 remaining on next check
    const result = checkRateLimit(key);
    assert.strictEqual(result.limited, false);
    assert.strictEqual(result.remaining, 9);
    assert.strictEqual(result.retryAfterSeconds, 0);

    resetRateLimit(key);
  });
});
