'use client';
import { useEffect } from 'react';
import { RiAlertLine, RiRefreshLine, RiArrowLeftLine } from 'react-icons/ri';

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error('Application error:', error);
  }, [error]);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: 'var(--bg, #0f0f14)',
    }}>
      <div style={{
        maxWidth: 480,
        width: '100%',
        textAlign: 'center',
        padding: 40,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(239,68,68,0.3)',
        borderRadius: 16,
      }}>
        <div style={{
          width: 64,
          height: 64,
          margin: '0 auto 20px',
          borderRadius: '50%',
          background: 'rgba(239,68,68,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <RiAlertLine style={{ fontSize: 32, color: 'var(--error, #ef4444)' }} />
        </div>

        <h2 style={{ margin: '0 0 8px', fontSize: 22, color: 'var(--text-primary, #fff)' }}>
          Something went wrong
        </h2>
        <p style={{ margin: '0 0 24px', fontSize: 14, color: 'var(--text-secondary, #a1a1aa)', lineHeight: 1.6 }}>
          {error?.message || 'An unexpected error occurred. Please try again.'}
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button
            onClick={reset}
            className="btn btn-primary"
            style={{ padding: '12px 24px', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <RiRefreshLine /> Try Again
          </button>
          <button
            onClick={() => window.location.href = '/dashboard'}
            className="btn btn-outline"
            style={{ padding: '12px 24px', fontSize: 14, display: 'inline-flex', alignItems: 'center', gap: 8 }}
          >
            <RiArrowLeftLine /> Go to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
