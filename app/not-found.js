import Link from 'next/link';
import { RiSearchLine, RiArrowLeftLine } from 'react-icons/ri';

export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      background: '#060a14',
    }}>
      <div style={{
        maxWidth: 420,
        width: '100%',
        textAlign: 'center',
        padding: 40,
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(120,110,255,0.2)',
        borderRadius: 20,
      }}>
        <div style={{
          width: 64,
          height: 64,
          margin: '0 auto 20px',
          borderRadius: '50%',
          background: 'rgba(114,102,255,0.12)',
          border: '1px solid rgba(114,102,255,0.2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          <RiSearchLine style={{ fontSize: 30, color: '#7266ff' }} />
        </div>

        <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: '#f0f4fc' }}>
          Page Not Found
        </h2>
        <p style={{ margin: '0 0 8px', fontSize: 36, fontWeight: 800, color: '#7266ff', letterSpacing: -1 }}>
          404
        </p>
        <p style={{ margin: '0 0 28px', fontSize: 14, color: '#94a3b8', lineHeight: 1.6 }}>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        <Link
          href="/dashboard"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '12px 24px', borderRadius: 12, fontSize: 14, fontWeight: 600,
            background: 'linear-gradient(135deg, #7266ff, #a78bfa)',
            color: '#fff', textDecoration: 'none',
          }}
        >
          <RiArrowLeftLine /> Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
