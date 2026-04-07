'use client';
import { useAuth } from '@/lib/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import FluidBackground from '@/components/FluidBackground';

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      router.replace(user ? '/dashboard' : '/login');
    }
  }, [user, loading, router]);

  // Safety timeout: if we're still loading after 5 seconds, try to force redirect to login
  useEffect(() => {
    if (loading) {
      const timer = setTimeout(() => {
        console.warn('Home page loading timed out, forcing redirect to login');
        router.replace('/login');
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [loading, router]);

  return (
    <>
      <FluidBackground />
      {/* position:fixed inset:0 is immune to parent height/overflow quirks on iOS PWA */}
      <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1 }}>
        <div className="spinner" />
      </div>
    </>
  );
}
