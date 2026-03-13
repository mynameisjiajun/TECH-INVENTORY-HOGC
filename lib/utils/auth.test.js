import { test, describe } from 'node:test';
import assert from 'node:assert';
import { hashPassword, verifyPassword } from './auth.js';

describe('auth utilities', () => {
  describe('hashPassword', () => {
    test('should return a hashed string', async () => {
      const password = 'mySuperSecretPassword123!';
      const hash = await hashPassword(password);

      assert.strictEqual(typeof hash, 'string');
      assert.notStrictEqual(hash, password);
      assert.ok(hash.startsWith('$2'), 'Bcrypt hashes should start with $2');
    });

    test('should hash password correctly so it can be verified', async () => {
      const password = 'mySuperSecretPassword123!';
      const hash = await hashPassword(password);

      const isMatch = await verifyPassword(password, hash);
      assert.strictEqual(isMatch, true);
    });

    test('should fail verification for incorrect password', async () => {
      const password = 'mySuperSecretPassword123!';
      const hash = await hashPassword(password);

      const isMatch = await verifyPassword('wrongPassword', hash);
      assert.strictEqual(isMatch, false);
    });

    test('should generate different hashes for the same password due to salting', async () => {
      const password = 'mySuperSecretPassword123!';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      assert.notStrictEqual(hash1, hash2);
    });
  });
});
