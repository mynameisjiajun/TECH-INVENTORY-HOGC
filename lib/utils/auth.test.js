import { describe, it, expect, vi, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { verifyResetToken } from './auth';

vi.mock('jsonwebtoken', () => ({
  default: {
    verify: vi.fn(),
    sign: vi.fn(),
  }
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn()
}));

describe('verifyResetToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return payload when token is valid and purpose is password_reset', () => {
    const mockPayload = { id: 1, purpose: 'password_reset' };
    jwt.verify.mockReturnValue(mockPayload);

    const result = verifyResetToken('valid_token');

    expect(result).toEqual(mockPayload);
    expect(jwt.verify).toHaveBeenCalled();
  });

  it('should return null when purpose is not password_reset', () => {
    const mockPayload = { id: 1, purpose: 'login' };
    jwt.verify.mockReturnValue(mockPayload);

    const result = verifyResetToken('valid_token_wrong_purpose');

    expect(result).toBeNull();
  });

  it('should return null when jwt.verify throws an error', () => {
    jwt.verify.mockImplementation(() => {
      throw new Error('jwt malformed');
    });

    const result = verifyResetToken('invalid_token');

    expect(result).toBeNull();
  });
});
