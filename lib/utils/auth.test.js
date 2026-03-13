import { describe, it, expect, vi, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { verifyResetToken } from './auth.js';

describe('verifyResetToken', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns null for invalid purpose', () => {
        // Set a test secret
        const testSecret = 'test-secret';
        process.env.JWT_SECRET = testSecret;

        // Mock verify to return a wrong purpose
        vi.spyOn(jwt, 'verify').mockReturnValue({
            id: 1,
            username: "test",
            purpose: "wrong_purpose"
        });

        const result = verifyResetToken("fake-token");

        // Assert it returns null
        expect(result).toBeNull();
    });

    it('returns payload for valid purpose', () => {
        // Set a test secret
        const testSecret = 'test-secret';
        process.env.JWT_SECRET = testSecret;

        const mockPayload = {
            id: 1,
            username: "test",
            purpose: "password_reset"
        };

        // Mock verify to return valid purpose
        vi.spyOn(jwt, 'verify').mockReturnValue(mockPayload);

        const result = verifyResetToken("fake-token");

        // Assert it returns payload
        expect(result).toEqual(mockPayload);
    });

    it('returns null when verify throws', () => {
        // Set a test secret
        const testSecret = 'test-secret';
        process.env.JWT_SECRET = testSecret;

        // Mock verify to throw
        vi.spyOn(jwt, 'verify').mockImplementation(() => {
            throw new Error('invalid token');
        });

        const result = verifyResetToken("fake-token");

        // Assert it returns null
        expect(result).toBeNull();
    });
});
