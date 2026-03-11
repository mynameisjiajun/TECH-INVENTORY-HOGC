'use client';
import { useEffect } from 'react';
import { RiAlertLine, RiRefreshLine } from 'react-icons/ri';

export default function DashboardError({ error, reset }) {
  useEffect(() => {
    console.error('Dashboard error:', error);
  }, [error]);

  return (
    <div style={{
      minHeight: '60vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
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
          width: 56,
          height: 56,
          margin: '0 auto 16px',
          borderRadius: '50%',
          background: 'rgba(239,68,68,0.1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <RiAlertLine style={{ fontSize: 28, color: 'var(--error, #ef4444)' }} />
        </div>

        <h2 style={{ margin: '0 0 8px', fontSize: 20, color: 'var(--text-primary, #fff)' }}>
          Dashboard Error
        </h2>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: 'var(--text-secondary, #a1a1aa)', lineHeight: 1.6 }}>
          {error?.message || 'Something went wrong loading the dashboard.'}
        </p>

        <button
          onClick={reset}
          className="btn btn-primary"
          style={{ padding: '10px 20px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 8 }}
        >
          <RiRefreshLine /> Try Again
        </button>
      </div>
    </div>
  );
}
