import { test, expect, vi, describe, beforeEach, afterEach } from 'vitest';

const mockSend = vi.fn();

vi.mock('resend', () => {
  return {
    Resend: class {
      constructor() {
        this.emails = {
          send: mockSend
        };
      }
    }
  };
});

describe('sendOverdueEmail', () => {
  let originalEnv;
  let originalConsoleError;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.RESEND_API_KEY = 'test_key';

    // Reset module to re-evaluate the Resend instantiation with the new env var
    vi.resetModules();
    mockSend.mockReset();

    originalConsoleError = console.error;
    console.error = vi.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    console.error = originalConsoleError;
    vi.clearAllMocks();
  });

  test('should not send if resend is not initialized (no API key)', async () => {
    process.env.RESEND_API_KEY = '';

    const { sendOverdueEmail } = await import('./email.js');

    await sendOverdueEmail({
      to: 'test@example.com',
      displayName: 'Test User',
      loanId: 123,
      items: [{ item: 'Camera', quantity: 1 }],
      endDate: '2023-10-27',
    });

    expect(mockSend).not.toHaveBeenCalled();
  });

  test('should not send if to address is missing', async () => {
    const { sendOverdueEmail } = await import('./email.js');

    await sendOverdueEmail({
      to: '',
      displayName: 'Test User',
      loanId: 123,
      items: [{ item: 'Camera', quantity: 1 }],
      endDate: '2023-10-27',
    });

    expect(mockSend).not.toHaveBeenCalled();
  });

  test('should call resend.emails.send with correct arguments', async () => {
    const { sendOverdueEmail } = await import('./email.js');

    mockSend.mockResolvedValueOnce({ data: { id: 'test_id' }, error: null });

    const params = {
      to: 'test@example.com',
      displayName: 'Test User',
      loanId: 123,
      items: [{ item: 'Camera', quantity: 1 }, { item: 'Lens', quantity: 2 }],
      endDate: '2023-10-27',
    };

    await sendOverdueEmail(params);

    expect(mockSend).toHaveBeenCalledTimes(1);

    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.to).toBe(params.to);
    expect(callArgs.subject).toContain(String(params.loanId));
    expect(callArgs.html).toContain(params.displayName);
    expect(callArgs.html).toContain(String(params.loanId));
    expect(callArgs.html).toContain(params.endDate);
    expect(callArgs.html).toContain('Camera × 1');
    expect(callArgs.html).toContain('Lens × 2');
  });

  test('should log error if resend.emails.send returns an error object', async () => {
    const { sendOverdueEmail } = await import('./email.js');

    const mockError = { message: 'API Error' };
    mockSend.mockResolvedValueOnce({ data: null, error: mockError });

    await sendOverdueEmail({
      to: 'test@example.com',
      displayName: 'Test User',
      loanId: 123,
      items: [{ item: 'Camera', quantity: 1 }],
      endDate: '2023-10-27',
    });

    expect(console.error).toHaveBeenCalledWith('Resend API Error (Overdue):', mockError);
  });

  test('should log error if resend.emails.send throws an exception', async () => {
     const { sendOverdueEmail } = await import('./email.js');

    const exception = new Error('Network Error');
    mockSend.mockRejectedValueOnce(exception);

    await sendOverdueEmail({
      to: 'test@example.com',
      displayName: 'Test User',
      loanId: 123,
      items: [{ item: 'Camera', quantity: 1 }],
      endDate: '2023-10-27',
    });

    expect(console.error).toHaveBeenCalledWith('Failed to send overdue email:', exception.message);
  });
});
