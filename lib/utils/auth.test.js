import { describe, it, expect, vi } from 'vitest';
import { verifyPassword, hashPassword } from './auth';

vi.mock('next/headers', () => ({
  cookies: vi.fn()
}));

describe('verifyPassword', () => {
  it('should return true when the password matches the hash', async () => {
    const password = 'mysecretpassword123';
    const hash = await hashPassword(password);

    const isMatch = await verifyPassword(password, hash);
    expect(isMatch).toBe(true);
  });

  it('should return false when the password does not match the hash', async () => {
    const password = 'mysecretpassword123';
    const wrongPassword = 'wrongpassword';
    const hash = await hashPassword(password);

    const isMatch = await verifyPassword(wrongPassword, hash);
    expect(isMatch).toBe(false);
  });

  it('should return false when verifying against an invalid hash format', async () => {
    const password = 'mysecretpassword123';
    const invalidHash = 'invalidhash';

    // bcryptjs compares an invalid hash format by returning false, not throwing
    const isMatch = await verifyPassword(password, invalidHash);
    expect(isMatch).toBe(false);
  });
});
