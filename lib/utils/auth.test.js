import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import { verifyToken } from './auth.js';

describe('verifyToken', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('returns null when jwt.verify throws an error', () => {
    // Mock jwt.verify to throw an error
    mock.method(jwt, 'verify', () => {
      throw new Error('Test error: invalid token');
    });

    const result = verifyToken('invalid-token');
    assert.strictEqual(result, null);
  });

  it('returns the decoded token when valid', () => {
    // Mock jwt.verify to return a payload
    const mockPayload = { id: 1, role: 'admin' };
    mock.method(jwt, 'verify', () => mockPayload);

    const result = verifyToken('valid-token');
    assert.deepStrictEqual(result, mockPayload);
  });
});
