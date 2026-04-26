import { test, describe } from 'node:test';
import assert from 'node:assert';
import { Resend } from 'resend';

// Intercept `Emails.prototype.send`
const dummy = new Resend('dummy');
const originalSend = dummy.emails.constructor.prototype.send;

describe('sendOverdueEmail', () => {
  test('catches exceptions when Resend SDK throws', async () => {
    // Setup mock
    dummy.emails.constructor.prototype.send = async () => {
      throw new Error('Resend SDK Error');
    };

    // Capture console.error
    const originalConsoleError = console.error;
    let loggedError = null;
    let loggedMsg = null;
    console.error = (msg, err) => {
      loggedMsg = msg;
      loggedError = err;
    };

    try {
      // Set env var before importing
      process.env.RESEND_API_KEY = 'test_key';
      const { sendOverdueEmail } = await import('./email.js');

      await sendOverdueEmail({
        to: 'test@example.com',
        displayName: 'Test User',
        loanId: '123',
        items: [{ item: 'Laptop', quantity: 1 }],
        endDate: '2023-01-01'
      });

      assert.strictEqual(loggedMsg, 'Failed to send overdue email:');
      assert.strictEqual(loggedError, 'Resend SDK Error');
    } finally {
      console.error = originalConsoleError;
      // Restore mock
      dummy.emails.constructor.prototype.send = originalSend;
    }
  });
});
