"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/context/AuthContext";
import { useCart } from "@/lib/context/CartContext";
import { useState, useEffect, useRef } from "react";
import { supabaseClient } from "@/lib/db/supabaseClient";
import {
  RiDashboardLine,
  RiArchiveLine,
  RiFileListLine,
  RiShieldUserLine,
  RiNotification3Line,
  RiShoppingCart2Line,
  RiLogoutBoxLine,
  RiLoginBoxLine,
  RiUserAddLine,
  RiServerLine,
} from "react-icons/ri";
import InstallPrompt from "./InstallPrompt";

export default function Navbar() {
  const { user, loading, logout } = useAuth();
  const { totalItems, setIsOpen } = useCart();
  const pathname = usePathname();
  const router = useRouter();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [notifPermission, setNotifPermission] = useState("default");
  const [adminPendingCount, setAdminPendingCount] = useState(0);
  const notifRef = useRef(null);
  const accountRef = useRef(null);
  const prevUnreadRef = useRef(-1);

  useEffect(() => {
    if (!user) return;

    const fetchNotifs = async () => {
      try {
        const res = await fetch("/api/notifications");
        if (res.ok) {
          const data = await res.json();
          setNotifications(data.notifications);
          // Show browser push notification when new unreads arrive
          // Skip on first load (prevUnreadRef === -1) to avoid spamming
          if (
            data.unreadCount > prevUnreadRef.current &&
            prevUnreadRef.current >= 0 &&
            typeof Notification !== "undefined" &&
            Notification.permission === "granted"
          ) {
            const newest = data.notifications.find((n) => !n.read);
            if (newest) {
              if (
                "serviceWorker" in navigator &&
                navigator.serviceWorker.controller
              ) {
                navigator.serviceWorker.ready.then((reg) => {
                  reg.showNotification("Tech Inventory", {
                    body: newest.message,
                    icon: "/icons/icon-192.png",
                    badge: "/icons/icon-192.png",
                    tag: `notif-${newest.id}`,
                    data: { url: newest.link || "/dashboard" },
                  });
                });
              } else {
                new Notification("Tech Inventory", {
                  body: newest.message,
                  icon: "/icons/icon-192.png",
                  tag: `notif-${newest.id}`,
                });
              }
            }
          }
          prevUnreadRef.current = data.unreadCount;
          setUnreadCount(data.unreadCount);
        }
      } catch (err) {
        console.warn("Failed to fetch notifications:", err.message);
      }
    };

    fetchNotifs();

    // Realtime: refetch when a notification is inserted for this user
    let channel;
    try {
      channel = supabaseClient
        .channel(`notifications-${user.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            fetchNotifs();
          },
        )
        .subscribe((_status, err) => {
          if (err)
            console.warn(
              "Notification Realtime unavailable, using polling:",
              err.message,
            );
        });
    } catch (err) {
      console.warn(
        "Notification Realtime not available on this device:",
        err.message,
      );
    }

    // Fallback poll every 60s in case Realtime drops
    const fallback = setInterval(fetchNotifs, 60000);

    return () => {
      if (channel) supabaseClient.removeChannel(channel);
      clearInterval(fallback);
    };
  }, [user]);

  useEffect(() => {
    if (!user || user.role !== "admin") return;
    const fetchPending = async () => {
      try {
        const [r1, r2] = await Promise.all([
          fetch("/api/loans?count_only=true&status=pending"),
          fetch("/api/laptop-loans?count_only=true&status=pending"),
        ]);
        const d1 = r1.ok ? await r1.json() : { count: 0 };
        const d2 = r2.ok ? await r2.json() : { count: 0 };
        setAdminPendingCount((d1.count || 0) + (d2.count || 0));
      } catch {
        /* silent */
      }
    };
    fetchPending();
    const interval = setInterval(fetchPending, 60000);
    return () => clearInterval(interval);
  }, [user]);

  useEffect(() => {
    const handleClose = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target))
        setShowNotifs(false);
      if (accountRef.current && !accountRef.current.contains(e.target))
        setShowAccountMenu(false);
    };
    document.addEventListener("mousedown", handleClose);
    document.addEventListener("touchstart", handleClose, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handleClose);
      document.removeEventListener("touchstart", handleClose);
    };
  }, []);

  useEffect(() => {
    if (typeof Notification !== "undefined") {
      setTimeout(() => setNotifPermission(Notification.permission), 0);
    }
  }, []);

  const handleLogout = async () => {
    setShowAccountMenu(false);
    setShowNotifs(false);
    await logout();
    router.replace("/home");
  };

  const markOneRead = async (id) => {
    // Optimistically update locally
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", notification_id: id }),
    }).catch(() => {});
  };

  const markAllRead = async () => {
    try {
      const res = await fetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read_all" }),
      });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        setUnreadCount(0);
      }
    } catch (err) {
      console.warn("Failed to mark notifications as read:", err.message);
    }
  };

  const clearAllNotifs = async () => {
    try {
      const res = await fetch("/api/notifications", { method: "DELETE" });
      if (res.ok) {
        setNotifications([]);
        setUnreadCount(0);
      }
    } catch (err) {
      console.warn("Failed to clear notifications:", err.message);
    }
  };

  const isNavActive = (href) =>
    pathname === href || pathname.startsWith(`${href}/`);

  if (loading) {
    return (
      <>
        <nav className="navbar">
          <div className="navbar-inner">
            <div className="navbar-brand" style={{ pointerEvents: "none" }}>
              <RiServerLine className="brand-icon" />
              Tech Inventory
            </div>
            <div
              style={{
                width: 112,
                height: 36,
                borderRadius: 12,
                background: "rgba(255,255,255,0.06)",
                border: "1px solid var(--border)",
                flexShrink: 0,
              }}
            />
          </div>
        </nav>

        <div className="mobile-nav" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="nav-link"
              style={{ pointerEvents: "none" }}
            >
              <span
                className="nav-icon-wrap"
                style={{ background: "rgba(255,255,255,0.05)" }}
              />
              <span
                style={{
                  width: 34,
                  height: 8,
                  borderRadius: 999,
                  background: "rgba(255,255,255,0.06)",
                }}
              />
            </div>
          ))}
        </div>
      </>
    );
  }

  const navLinks = [
    { href: "/home", label: "Home", icon: <RiArchiveLine /> },
    { href: "/dashboard", label: "Dashboard", icon: <RiDashboardLine /> },
    { href: "/loans", label: "My Loans", icon: <RiFileListLine /> },
  ];
  if (user?.role === "admin") {
    navLinks.push({
      href: "/admin",
      label: "Admin",
      icon: <RiShieldUserLine />,
    });
  }
  const displayName = user?.display_name || user?.username || "Guest";
  const accountMeta = user
    ? `@${user.username}${user.role === "admin" ? " · admin" : ""}`
    : "Browse first, log in when you need it";
  const profileEmoji = user?.profile_emoji || null;
  const avatarLabel = profileEmoji || displayName[0]?.toUpperCase() || "G";
  const avatarGradient = user?.role === "admin"
    ? "linear-gradient(135deg, #f59e0b, #ef4444)"
    : user?.role === "tech"
      ? "linear-gradient(135deg, #10b981, #059669)"
      : "linear-gradient(135deg, var(--accent), #818cf8)";

  const timeAgo = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <>
      <nav className="navbar">
        <div className="navbar-inner">
          <Link href="/home" className="navbar-brand">
            <RiServerLine className="brand-icon" />
            <span className="navbar-brand-text">Tech Inventory</span>
          </Link>

          <div className="navbar-links">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`nav-link ${isNavActive(link.href) ? "active" : ""}`}
              >
                {link.icon} {link.label}
              </Link>
            ))}
          </div>

          <div className="navbar-right">
            {user && (
              <div style={{ position: "relative" }} ref={notifRef}>
                <button
                  aria-label="Notifications"
                  className="notification-btn"
                  onClick={() => {
                    setShowNotifs((v) => !v);
                    setShowAccountMenu(false);
                  }}
                >
                  <RiNotification3Line />
                  {unreadCount > 0 && (
                    <span className="notification-badge">
                      {unreadCount > 9 ? "9+" : unreadCount}
                    </span>
                  )}
                </button>
                {showNotifs && (
                  <div className="notification-dropdown">
                    <div className="notification-dropdown-header">
                      <span style={{ fontWeight: 600, fontSize: 14 }}>
                        Notifications
                      </span>
                      <div style={{ display: "flex", gap: 6 }}>
                        {unreadCount > 0 && (
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={markAllRead}
                          >
                            Mark all read
                          </button>
                        )}
                        {notifications.length > 0 && (
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={clearAllNotifs}
                            style={{
                              color: "var(--error)",
                              borderColor: "var(--error)",
                            }}
                          >
                            Clear all
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="notification-dropdown-list">
                      {notifications.length === 0 ? (
                        <div
                          style={{
                            padding: 24,
                            textAlign: "center",
                            color: "var(--text-muted)",
                            fontSize: 13,
                          }}
                        >
                          No notifications yet
                        </div>
                      ) : (
                        notifications.map((n) => (
                          <div
                            key={n.id}
                            className={`notification-item ${n.read ? "" : "unread"}`}
                            onClick={() => {
                              if (!n.read) markOneRead(n.id);
                              if (n.link) router.push(n.link);
                              setShowNotifs(false);
                            }}
                          >
                            <div>
                              <p>{n.message}</p>
                              <span className="notif-time">
                                {timeAgo(n.created_at)}
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    {notifPermission !== "granted" &&
                      typeof Notification !== "undefined" && (
                        <div className="notification-dropdown-footer">
                          <button
                            onClick={async () => {
                              const perm = await Notification.requestPermission();
                              setNotifPermission(perm);
                            }}
                            style={{
                              display: "block",
                              width: "100%",
                              padding: "10px",
                              background: "rgba(99,102,241,0.1)",
                              border: "none",
                              borderTop: "1px solid var(--border)",
                              color: "var(--accent)",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                              fontFamily: "inherit",
                              borderRadius: "0 0 12px 12px",
                            }}
                          >
                            🔔 Enable Push Notifications
                          </button>
                        </div>
                      )}
                  </div>
                )}
              </div>
            )}

            <div className="account-menu-shell" ref={accountRef}>
              <button
                aria-label="Account menu"
                className="account-btn"
                onClick={() => {
                  setShowAccountMenu((v) => !v);
                  setShowNotifs(false);
                }}
              >
                <div className="user-avatar" style={{ background: avatarGradient, fontSize: profileEmoji ? 17 : undefined }}>{avatarLabel}</div>
              </button>
              {showAccountMenu && (
                <div className="account-menu-dropdown">
                  <button
                    className="account-menu-profile"
                    onClick={() => {
                      router.push(user ? "/profile" : "/login");
                      setShowAccountMenu(false);
                    }}
                  >
                    <div className="user-avatar account-menu-avatar" style={{ background: avatarGradient, fontSize: profileEmoji ? 17 : undefined }}>
                      {avatarLabel}
                    </div>
                    <div className="account-menu-copy">
                      <strong>{displayName}</strong>
                      <span>{accountMeta}</span>
                    </div>
                  </button>
                  {user ? (
                    <>
                      <button
                        className="account-menu-item"
                        onClick={() => {
                          router.push("/profile");
                          setShowAccountMenu(false);
                        }}
                      >
                        Profile
                      </button>
                      <button
                        className="account-menu-item account-menu-item-danger"
                        onClick={handleLogout}
                      >
                        <RiLogoutBoxLine /> Logout
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="account-menu-item"
                        onClick={() => {
                          router.push("/login");
                          setShowAccountMenu(false);
                        }}
                      >
                        <RiLoginBoxLine /> Log In
                      </button>
                      <button
                        className="account-menu-item"
                        onClick={() => {
                          router.push("/register");
                          setShowAccountMenu(false);
                        }}
                      >
                        <RiUserAddLine /> Register
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile Nav */}
      <div className="mobile-nav">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`nav-link ${isNavActive(link.href) ? "active" : ""}`}
            style={{ position: "relative" }}
          >
            {/* pill wraps icon only — active state highlights this, not the full item */}
            <span className="nav-icon-wrap">{link.icon}</span>
            <span>{link.label}</span>
            {link.href === "/admin" && adminPendingCount > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: 0,
                  right: 0,
                  background: "#f59e0b",
                  color: "white",
                  minWidth: 16,
                  height: 16,
                  borderRadius: 8,
                  fontSize: 9,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  padding: "0 3px",
                }}
              >
                {adminPendingCount > 99 ? "99+" : adminPendingCount}
              </span>
            )}
          </Link>
        ))}
        <button
          className="nav-link"
          onClick={() => setIsOpen(true)}
          style={{ position: "relative" }}
        >
          <span className="nav-icon-wrap" style={{ position: "relative" }}>
            <RiShoppingCart2Line />
            {totalItems > 0 && (
              <span
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  background: "var(--error)",
                  color: "white",
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  fontSize: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                }}
              >
                {totalItems}
              </span>
            )}
          </span>
          <span>Cart</span>
          {totalItems > 0 && (
            <span
              style={{
                display: "none", // badge now on icon wrap above
              }}
            >
              {totalItems}
            </span>
          )}
        </button>
      </div>

      {/* Cart FAB */}
      {totalItems > 0 && (
        <button
          aria-label="Open cart"
          className="cart-fab"
          onClick={() => setIsOpen(true)}
        >
          <RiShoppingCart2Line />
          <span className="cart-count">{totalItems}</span>
        </button>
      )}

      <InstallPrompt />
    </>
  );
}
