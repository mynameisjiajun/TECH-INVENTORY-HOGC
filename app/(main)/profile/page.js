'use client';
import { useAuth } from '@/lib/context/AuthContext';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Navbar from '@/components/Navbar';
import { RiUserLine, RiLockLine, RiCheckLine, RiMailLine } from 'react-icons/ri';

export default function ProfilePage() {
  const { user, loading, checkAuth } = useAuth();
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [profileMsg, setProfileMsg] = useState('');
  const [passwordMsg, setPasswordMsg] = useState('');
  const [profileErr, setProfileErr] = useState('');
  const [passwordErr, setPasswordErr] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;
    fetch('/api/profile')
      .then(r => {
        if (!r.ok) throw new Error('Failed to load profile');
        return r.json();
      })
      .then(data => {
        setProfile(data.profile);
        setDisplayName(data.profile.display_name);
        setEmail(data.profile.email || '');
      })
      .catch((err) => {
        setProfileErr(err.message || 'Could not load profile');
      });
  }, [user]);

  const handleUpdateProfile = async (e) => {
    e.preventDefault();
    setProfileMsg(''); setProfileErr('');
    setProfileLoading(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_profile', display_name: displayName, email: email.trim() || null }),
      });
      const data = await res.json();
      if (res.ok) {
        setProfileMsg(data.message);
        checkAuth();
      } else {
        setProfileErr(data.error || 'Failed to update profile');
      }
    } catch (err) {
      setProfileErr('Network error — could not update profile');
    } finally {
      setProfileLoading(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPasswordMsg(''); setPasswordErr('');
    if (newPassword !== confirmPassword) {
      setPasswordErr('Passwords do not match');
      return;
    }
    setPasswordLoading(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'change_password', current_password: currentPassword, new_password: newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setPasswordMsg(data.message);
        setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      } else {
        setPasswordErr(data.error || 'Failed to change password');
      }
    } catch (err) {
      setPasswordErr('Network error — could not change password');
    } finally {
      setPasswordLoading(false);
    }
  };

  if (loading || !user) return <div className="loading-spinner"><div className="spinner" /></div>;

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ maxWidth: 640, margin: '0 auto', padding: '24px 20px' }}>
        <div className="page-header" style={{ marginBottom: 32 }}>
          <h1><RiUserLine style={{ verticalAlign: 'middle' }} /> Profile</h1>
          <p>Manage your account settings</p>
        </div>

        {/* User Info Card */}
        {profile && (
          <div className="glass-card" style={{ padding: 28, marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), #818cf8)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 700, color: 'white', flexShrink: 0 }}>
                {profile.display_name[0].toUpperCase()}
              </div>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: '0 0 4px 0', fontSize: 22 }}>{profile.display_name}</h2>
                <p style={{ margin: '0 0 8px 0', color: 'var(--text-muted)', fontSize: 14 }}>@{profile.username}</p>
                <span className={`badge ${profile.role === 'admin' ? 'badge-warning' : 'badge-info'}`}>
                  {profile.role === 'admin' ? '🛡️ Admin' : '👤 User'}
                </span>
              </div>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 16, marginBottom: 0, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              Member since {new Date(profile.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
        )}

        {/* Edit Display Name */}
        <div style={{ padding: 32, marginBottom: 32, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 16 }}>
          <h3 style={{ marginTop: 0, marginBottom: 28, display: 'flex', alignItems: 'center', gap: 10, fontSize: 18, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
            <RiUserLine /> Edit Profile
          </h3>
          <form onSubmit={handleUpdateProfile}>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', marginBottom: 12, fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>Display Name</label>
              <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)}
                placeholder="Your display name" required minLength={2}
                style={{ width: '100%', padding: '14px 18px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-primary)', fontSize: 15, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', marginBottom: 12, fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
                <RiMailLine style={{ verticalAlign: 'middle', marginRight: 6 }} />Email for Notifications <span style={{ fontWeight: 400, fontSize: 12 }}>(optional)</span>
              </label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com — for loan reminders"
                style={{ width: '100%', padding: '14px 18px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-primary)', fontSize: 15, outline: 'none', boxSizing: 'border-box' }} />
            </div>

            <div style={{ marginBottom: 24, padding: 20, background: 'rgba(56, 189, 248, 0.05)', borderRadius: 12, border: '1px solid rgba(56, 189, 248, 0.15)' }}>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>
                Telegram Notifications
              </label>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                Receive instant alerts for loan approvals, returns, and overdue items.
              </p>
              
              {profileErr && profileErr.includes("Telegram") ? null : (
                profile?.telegram_chat_id ? (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(34, 197, 94, 0.1)', color: '#22c55e', padding: '8px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500 }}>
                    <RiCheckLine size={16} /> Linked & Active
                  </div>
                ) : (
                  <div style={{ background: 'rgba(56, 189, 248, 0.1)', padding: 16, borderRadius: 8, marginTop: 12 }}>
                    <p style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 12, fontWeight: 500 }}>To link your account:</p>
                    <ol style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 16px 0', paddingLeft: 20 }}>
                      <li style={{ marginBottom: 6 }}>Click the button below to open Telegram</li>
                      <li style={{ marginBottom: 6 }}>Press <strong>Start</strong> at the bottom of the chat</li>
                      <li>Wait for the confirmation message, then <strong>refresh this page</strong>.</li>
                    </ol>
                    <a 
                      href={`https://t.me/${process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "HOGC_Tech_Bot"}?start=${user.id}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="btn btn-outline"
                      style={{ background: '#38bdf8', color: '#fff', border: 'none', padding: '10px 18px', display: 'inline-block' }}
                    >
                      Open Telegram to Link
                    </a>
                  </div>
                )
              )}
            </div>

            {profileMsg && <p style={{ color: 'var(--success)', fontSize: 14, marginBottom: 20, padding: '12px 16px', background: 'rgba(34,197,94,0.08)', borderRadius: 10 }}>✅ {profileMsg}</p>}
            {profileErr && <p style={{ color: 'var(--error)', fontSize: 14, marginBottom: 20, padding: '12px 16px', background: 'rgba(239,68,68,0.08)', borderRadius: 10 }}>❌ {profileErr}</p>}
            <button type="submit" className="btn btn-primary" style={{ padding: '14px 28px', fontSize: 14, marginTop: 4 }} disabled={profileLoading}>
              {profileLoading ? <><span className="btn-spinner" /> Saving…</> : <><RiCheckLine /> Save Changes</>}
            </button>
          </form>
        </div>

        {/* Change Password */}
        <div style={{ padding: 32, marginBottom: 32, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 16 }}>
          <h3 style={{ marginTop: 0, marginBottom: 28, display: 'flex', alignItems: 'center', gap: 10, fontSize: 18, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
            <RiLockLine /> Change Password
          </h3>
          <form onSubmit={handleChangePassword}>
            <div style={{ marginBottom: 28 }}>
              <label style={{ display: 'block', marginBottom: 12, fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>Current Password</label>
              <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
                placeholder="Enter current password" required
                style={{ width: '100%', padding: '14px 18px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-primary)', fontSize: 15, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 28 }}>
              <label style={{ display: 'block', marginBottom: 12, fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>New Password</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                placeholder="Enter new password (min. 6 chars)" required minLength={6}
                style={{ width: '100%', padding: '14px 18px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-primary)', fontSize: 15, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            <div style={{ marginBottom: 28 }}>
              <label style={{ display: 'block', marginBottom: 12, fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.5px' }}>Confirm New Password</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password" required
                style={{ width: '100%', padding: '14px 18px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-primary)', fontSize: 15, outline: 'none', boxSizing: 'border-box' }} />
            </div>
            {passwordMsg && <p style={{ color: 'var(--success)', fontSize: 14, marginBottom: 20, padding: '12px 16px', background: 'rgba(34,197,94,0.08)', borderRadius: 10 }}>✅ {passwordMsg}</p>}
            {passwordErr && <p style={{ color: 'var(--error)', fontSize: 14, marginBottom: 20, padding: '12px 16px', background: 'rgba(239,68,68,0.08)', borderRadius: 10 }}>❌ {passwordErr}</p>}
            <button type="submit" className="btn btn-primary" style={{ padding: '14px 28px', fontSize: 14, marginTop: 4 }} disabled={passwordLoading}>
              {passwordLoading ? <><span className="btn-spinner" /> Updating…</> : <><RiLockLine /> Change Password</>}
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
