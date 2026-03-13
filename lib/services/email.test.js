import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

test('sendLoanStatusEmail edge cases', async (t) => {
  // Set RESEND_API_KEY before importing so resend is created
  process.env.RESEND_API_KEY = 'test_api_key';

  // Mock global.fetch because Resend client uses it under the hood
  const originalFetch = global.fetch;
  const fetchMock = mock.fn(async () => {
    return {
      ok: true,
      json: async () => ({ id: 'mocked_id' }),
      text: async () => JSON.stringify({ id: 'mocked_id' }),
      headers: new Headers()
    };
  });
  global.fetch = fetchMock;

  try {
    const { sendLoanStatusEmail } = await import('./email.js');

    await t.test('returns early when status is invalid (e.g., "pending")', async () => {
      fetchMock.mock.resetCalls();

      await sendLoanStatusEmail({
        to: 'test@example.com',
        displayName: 'User',
        loanId: '123',
        status: 'pending', // invalid status
        adminNotes: '',
        items: [{ item: 'Laptop', quantity: 1 }]
      });

      assert.equal(fetchMock.mock.calls.length, 0, 'Should not call fetch when status is invalid');
    });

    await t.test('calls fetch when status is valid ("approved")', async () => {
      fetchMock.mock.resetCalls();

      await sendLoanStatusEmail({
        to: 'test@example.com',
        displayName: 'User',
        loanId: '123',
        status: 'approved', // valid
        adminNotes: '',
        items: [{ item: 'Laptop', quantity: 1 }]
      });

      assert.equal(fetchMock.mock.calls.length, 1, 'Should call fetch when status is approved');
    });

    await t.test('calls fetch when status is valid ("rejected")', async () => {
      fetchMock.mock.resetCalls();

      await sendLoanStatusEmail({
        to: 'test@example.com',
        displayName: 'User',
        loanId: '123',
        status: 'rejected', // valid
        adminNotes: '',
        items: [{ item: 'Laptop', quantity: 1 }]
      });

      assert.equal(fetchMock.mock.calls.length, 1, 'Should call fetch when status is rejected');
    });
  } finally {
    // Restore fetch
    global.fetch = originalFetch;
  }
});
