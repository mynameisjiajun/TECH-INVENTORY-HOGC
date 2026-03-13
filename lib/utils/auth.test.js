import { test, describe } from 'node:test';
import assert from 'node:assert';
import jwt from 'jsonwebtoken';
import { createResetToken } from './auth.js';

describe('auth.js', () => {
  describe('createResetToken', () => {
    test('should generate a token with purpose "password_reset"', () => {
      // Setup fake environment variable for the test since auth.js requires it
      process.env.JWT_SECRET = 'test-secret-key';

      const mockUser = {
        id: 123,
        username: 'test_user',
        display_name: 'Test User',
        role: 'user',
      };

      const token = createResetToken(mockUser);

      // Token must be a string
      assert.strictEqual(typeof token, 'string');
      assert.ok(token.length > 0);

      // Decode the token using jsonwebtoken
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Check for necessary payload fields
      assert.strictEqual(decoded.id, mockUser.id);
      assert.strictEqual(decoded.username, mockUser.username);
      assert.strictEqual(decoded.purpose, 'password_reset');

      // The token should expire in 1 hour (3600 seconds)
      assert.ok(decoded.exp);
      assert.ok(decoded.iat);
      assert.strictEqual(decoded.exp - decoded.iat, 3600);
    });
  });
});
