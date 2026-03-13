import test from 'node:test';
import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import { verifyResetToken, createResetToken } from './auth.js';

test('verifyResetToken', async (t) => {
  // Set required JWT_SECRET for auth utils
  process.env.JWT_SECRET = 'test-secret';

  await t.test('returns payload for valid reset token', () => {
    const user = { id: 1, username: 'testuser' };
    const token = createResetToken(user);

    const payload = verifyResetToken(token);
    assert.ok(payload);
    assert.strictEqual(payload.id, 1);
    assert.strictEqual(payload.username, 'testuser');
    assert.strictEqual(payload.purpose, 'password_reset');
  });

  await t.test('returns null for invalid token', () => {
    const invalidToken = 'not.a.valid.token';
    const payload = verifyResetToken(invalidToken);
    assert.strictEqual(payload, null);
  });

  await t.test('returns null for token with wrong purpose', () => {
    // create a token signed correctly but with wrong purpose
    const wrongPurposeToken = jwt.sign(
      { id: 1, username: 'testuser', purpose: 'login' },
      process.env.JWT_SECRET
    );
    const payload = verifyResetToken(wrongPurposeToken);
    assert.strictEqual(payload, null);
  });

  await t.test('returns null for expired token', () => {
    // create a token that is already expired
    const expiredToken = jwt.sign(
      { id: 1, username: 'testuser', purpose: 'password_reset' },
      process.env.JWT_SECRET,
      { expiresIn: '-1h' }
    );
    const payload = verifyResetToken(expiredToken);
    assert.strictEqual(payload, null);
  });
});
