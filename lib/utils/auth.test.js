import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { verifyResetToken } from './auth.js';

vi.mock('jsonwebtoken');
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(),
    compare: vi.fn()
  }
}));

const mockCookiesGet = vi.fn();
vi.mock('next/headers', () => ({
  cookies: vi.fn(() => ({
    get: mockCookiesGet
  }))
}));

describe('verifyResetToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret';
  });

  it('returns null when jwt.verify throws an error', () => {
    jwt.verify.mockImplementation(() => {
      throw new Error('mock error');
    });

    const result = verifyResetToken('fake-token');

    expect(result).toBeNull();
    expect(jwt.verify).toHaveBeenCalledWith('fake-token', expect.any(String));
  });

  it('returns null when payload purpose is not password_reset', () => {
    jwt.verify.mockReturnValue({ purpose: 'other_purpose' });
    const result = verifyResetToken('fake-token');
    expect(result).toBeNull();
  });

  it('returns the payload when token is valid and purpose is password_reset', () => {
    const mockPayload = { purpose: 'password_reset', id: 1 };
    jwt.verify.mockReturnValue(mockPayload);
    const result = verifyResetToken('fake-token');
    expect(result).toEqual(mockPayload);
  });
});
