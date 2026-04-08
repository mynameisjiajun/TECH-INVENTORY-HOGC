import test from 'node:test';
import assert from 'node:assert';
import { checkRateLimit, resetRateLimit } from './rateLimit.js';

test('resetRateLimit should clear the limit for a key', () => {
  const key = 'test-reset-key';

  // Initial check
  const firstCheck = checkRateLimit(key);
  assert.strictEqual(firstCheck.limited, false);
  assert.strictEqual(firstCheck.remaining, 9);

  // Call it a few more times to decrease remaining
  checkRateLimit(key);
  const thirdCheck = checkRateLimit(key);
  assert.strictEqual(thirdCheck.remaining, 7);

  // Reset the limit
  resetRateLimit(key);

  // Check again, it should be fully reset
  const afterReset = checkRateLimit(key);
  assert.strictEqual(afterReset.limited, false);
  assert.strictEqual(afterReset.remaining, 9);
});

test('resetRateLimit should clear the limit for an already limited key', () => {
  const key = 'test-reset-limited-key';

  // Call it 10 times to reach the limit
  for (let i = 0; i < 10; i++) {
    checkRateLimit(key);
  }

  // The 11th call should be limited
  const limitedCheck = checkRateLimit(key);
  assert.strictEqual(limitedCheck.limited, true);
  assert.strictEqual(limitedCheck.remaining, 0);

  // Reset the limit
  resetRateLimit(key);

  // Check again, it should be fully reset
  const afterReset = checkRateLimit(key);
  assert.strictEqual(afterReset.limited, false);
  assert.strictEqual(afterReset.remaining, 9);
});
