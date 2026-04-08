import { test, describe } from 'node:test';
import assert from 'node:assert';
import { checkRateLimit } from './rateLimit.js';

describe('rateLimit', () => {
  test('allows requests under the limit', () => {
    const key = 'test-user-happy-path';
    let result;

    // First attempt
    result = checkRateLimit(key);
    assert.strictEqual(result.limited, false);
    assert.strictEqual(result.remaining, 9);
    assert.strictEqual(result.retryAfterSeconds, 0);

    // Second attempt
    result = checkRateLimit(key);
    assert.strictEqual(result.limited, false);
    assert.strictEqual(result.remaining, 8);
    assert.strictEqual(result.retryAfterSeconds, 0);
  });

  test('blocks requests when exceeding MAX_ATTEMPTS', () => {
    const key = 'test-user-exceed-limit';
    let result;

    // MAX_ATTEMPTS is 10, so let's hit it 10 times to reach the limit
    for (let i = 0; i < 10; i++) {
      result = checkRateLimit(key);
      assert.strictEqual(result.limited, false, `Failed at attempt ${i + 1}`);
      assert.strictEqual(result.remaining, 9 - i);
    }

    // 11th attempt should be blocked
    result = checkRateLimit(key);
    assert.strictEqual(result.limited, true);
    assert.strictEqual(result.remaining, 0);
    assert.ok(result.retryAfterSeconds > 0, 'Should have a retry delay');

    // 12th attempt should also be blocked
    result = checkRateLimit(key);
    assert.strictEqual(result.limited, true);
    assert.strictEqual(result.remaining, 0);
    assert.ok(result.retryAfterSeconds > 0, 'Should have a retry delay');
  });
});
