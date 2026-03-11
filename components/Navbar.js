'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/AuthContext';
import { useCart } from '@/lib/CartContext';
import { useState, useEffect, useRef } from 'react';
import { RiDashboardLine, RiArchiveLine, RiFileListLine, RiShieldUserLine, RiNotification3Line, RiShoppingCart2Line, RiLogoutBoxLine, RiServerLine } from 'react-icons/ri';

export default function Navbar() {
  const { user, logout } = useAuth();
  const { totalItems, setIsOpen } = useCart();
  const pathname = usePathname();
  const router = useRouter();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifs, setShowNotifs] = useState(false);
  const notifRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    const fetchNotifs = async () => {
      try {
        const res = await fetch('/api/notifications');
        if (res.ok) {
          const data = await res.json();
          setNotifications(data.notifications);
          setUnreadCount(data.unreadCount);
        }
      } catch (err) {
        console.warn('Failed to fetch notifications:', err.message);
      }
    };
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 15000);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    const handleClick = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setShowNotifs(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  const markAllRead = async () => {
    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'read_all' }),
      });
      if (res.ok) {
        setNotifications(prev => prev.map(n => ({ ...n, read: 1 })));
        setUnreadCount(0);
      }
    } catch (err) {
      console.warn('Failed to mark notifications as read:', err.message);
    }
  };

  if (!user) return null;

  const navLinks = [
    { href: '/dashboard', label: 'Dashboard', icon: <RiDashboardLine /> },
    { href: '/inventory', label: 'Inventory', icon: <RiArchiveLine /> },
    { href: '/loans', label: 'My Loans', icon: <RiFileListLine /> },
  ];
  if (user.role === 'admin') {
    navLinks.push({ href: '/admin', label: 'Admin', icon: <RiShieldUserLine /> });
  }

  const timeAgo = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <>
      <nav className="navbar">
        <div className="navbar-inner">
          <Link href="/dashboard" className="navbar-brand">
            <RiServerLine className="brand-icon" />
            Tech Inventory
          </Link>

          <div className="navbar-links">
            {navLinks.map(link => (
              <Link key={link.href} href={link.href} className={`nav-link ${pathname === link.href ? 'active' : ''}`}>
                {link.icon} {link.label}
              </Link>
            ))}
          </div>

          <div className="navbar-right">
            <div style={{ position: 'relative' }} ref={notifRef}>
              <button className="notification-btn" onClick={() => setShowNotifs(!showNotifs)}>
                <RiNotification3Line />
                {unreadCount > 0 && <span className="notification-badge">{unreadCount > 9 ? '9+' : unreadCount}</span>}
              </button>
              {showNotifs && (
                <div className="notification-dropdown">
                  <div className="notification-dropdown-header">
                    <span style={{ fontWeight: 600, fontSize: 14 }}>Notifications</span>
                    {unreadCount > 0 && (
                      <button className="btn btn-sm btn-outline" onClick={markAllRead}>Mark all read</button>
                    )}
                  </div>
                  {notifications.length === 0 ? (
                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                      No notifications yet
                    </div>
                  ) : notifications.map(n => (
                    <div key={n.id} className={`notification-item ${n.read ? '' : 'unread'}`}
                      onClick={() => { if (n.link) router.push(n.link); setShowNotifs(false); }}>
                      <div>
                        <p>{n.message}</p>
                        <span className="notif-time">{timeAgo(n.created_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="user-menu" onClick={() => router.push('/profile')} style={{ cursor: 'pointer' }} title="Edit profile">
              <div className="user-avatar">{(user.display_name || user.username)[0].toUpperCase()}</div>
              <span>{user.display_name || user.username}</span>
            </div>
            <button className="logout-btn" onClick={handleLogout}>
              <RiLogoutBoxLine />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Nav */}
      <div className="mobile-nav">
        {navLinks.map(link => (
          <Link key={link.href} href={link.href} className={`nav-link ${pathname === link.href ? 'active' : ''}`}>
            {link.icon}
            <span>{link.label}</span>
          </Link>
        ))}
        <button className="nav-link" onClick={() => setIsOpen(true)} style={{ position: 'relative' }}>
          <RiShoppingCart2Line />
          <span>Cart</span>
          {totalItems > 0 && (
            <span style={{ position: 'absolute', top: 2, right: 8, background: 'var(--error)', color: 'white', width: 16, height: 16, borderRadius: '50%', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
              {totalItems}
            </span>
          )}
        </button>
      </div>

      {/* Cart FAB */}
      {totalItems > 0 && (
        <button className="cart-fab" onClick={() => setIsOpen(true)}>
          <RiShoppingCart2Line />
          <span className="cart-count">{totalItems}</span>
        </button>
      )}
    </>
  );
}
