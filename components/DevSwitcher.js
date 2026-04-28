"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/context/AuthContext";

const PANEL_STYLE = {
  position: "fixed",
  bottom: 16,
  right: 16,
  zIndex: 2147483000,
  fontFamily: "var(--font-sans), system-ui, sans-serif",
  fontSize: 13,
  color: "var(--text-primary)",
  background: "var(--bg-card, #111b32)",
  border: "1px solid var(--border, rgba(120, 110, 255, 0.4))",
  borderRadius: 12,
  boxShadow: "0 8px 40px rgba(0, 0, 0, 0.55)",
  padding: 12,
  width: 280,
  maxWidth: "calc(100vw - 32px)",
};

const COLLAPSED_STYLE = {
  position: "fixed",
  bottom: 16,
  right: 16,
  zIndex: 2147483000,
  background: "var(--bg-card, #111b32)",
  border: "1px solid var(--border, rgba(120, 110, 255, 0.4))",
  borderRadius: 999,
  padding: "6px 12px",
  fontFamily: "var(--font-sans), system-ui, sans-serif",
  fontSize: 12,
  color: "var(--text-primary)",
  cursor: "pointer",
  boxShadow: "0 4px 24px rgba(0, 0, 0, 0.45)",
};

const ROW_STYLE = { display: "flex", gap: 8, marginTop: 8 };
const SELECT_STYLE = {
  width: "100%",
  padding: "6px 8px",
  background: "var(--bg-secondary, #0c1322)",
  color: "var(--text-primary)",
  border: "1px solid var(--border, rgba(120, 110, 255, 0.4))",
  borderRadius: 8,
  fontSize: 13,
};
const BUTTON_STYLE = {
  flex: 1,
  padding: "6px 10px",
  border: "1px solid var(--border, rgba(120, 110, 255, 0.4))",
  borderRadius: 8,
  background: "var(--accent, #7266ff)",
  color: "#fff",
  cursor: "pointer",
  fontSize: 12,
};
const SECONDARY_BUTTON_STYLE = {
  ...BUTTON_STYLE,
  background: "transparent",
  color: "var(--text-secondary, #94a3b8)",
};

export default function DevSwitcher() {
  const { user, checkAuth, logout } = useAuth();
  const [collapsed, setCollapsed] = useState(false);
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const enabled =
    typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_DEV_BYPASS === "1";

  const loadUsers = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/dev/login");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUsers(data.users ?? []);
    } catch (err) {
      setError(err.message || "Failed to load users");
    }
  }, []);

  useEffect(() => {
    if (!enabled || collapsed) return;
    loadUsers();
  }, [enabled, collapsed, loadUsers]);

  useEffect(() => {
    if (!user || !users.length) return;
    if (!users.find((u) => u.username === selected)) {
      setSelected(user.username || users[0].username);
    }
  }, [user, users, selected]);

  const switchUser = useCallback(async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: selected }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      await checkAuth();
    } catch (err) {
      setError(err.message || "Switch failed");
    } finally {
      setBusy(false);
    }
  }, [selected, busy, checkAuth]);

  const handleLogout = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fetch("/api/dev/login", { method: "DELETE" });
      await logout();
    } catch (err) {
      setError(err.message || "Logout failed");
    } finally {
      setBusy(false);
    }
  }, [busy, logout]);

  const label = useMemo(() => {
    if (!user) return "anonymous";
    const role = user.role === "admin" ? "admin" : "user";
    const ministry = user.ministry ? ` · ${user.ministry}` : "";
    return `${user.display_name || user.username} (${role})${ministry}`;
  }, [user]);

  if (!enabled) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        style={COLLAPSED_STYLE}
        onClick={() => setCollapsed(false)}
        title="Open dev login switcher"
      >
        🛠️ dev: {user ? user.username : "anon"}
      </button>
    );
  }

  return (
    <div style={PANEL_STYLE} role="dialog" aria-label="Dev login switcher">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <strong style={{ fontSize: 12, letterSpacing: 0.4 }}>
          🛠️ DEV LOGIN
        </strong>
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          style={{
            background: "transparent",
            color: "var(--text-secondary, #94a3b8)",
            border: "none",
            cursor: "pointer",
            fontSize: 14,
          }}
          aria-label="Collapse dev switcher"
        >
          ×
        </button>
      </div>

      <div style={{ color: "var(--text-secondary, #94a3b8)", fontSize: 11 }}>
        current: <span style={{ color: "var(--text-primary)" }}>{label}</span>
      </div>

      <div style={{ marginTop: 8 }}>
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          style={SELECT_STYLE}
          disabled={busy || !users.length}
        >
          {!users.length && <option value="">(loading…)</option>}
          {users.map((u) => (
            <option key={u.id} value={u.username}>
              {u.username} — {u.role}
              {u.ministry ? ` · ${u.ministry}` : ""}
            </option>
          ))}
        </select>
      </div>

      <div style={ROW_STYLE}>
        <button
          type="button"
          style={BUTTON_STYLE}
          onClick={switchUser}
          disabled={busy || !selected}
        >
          {busy ? "…" : "Switch"}
        </button>
        <button
          type="button"
          style={SECONDARY_BUTTON_STYLE}
          onClick={handleLogout}
          disabled={busy}
        >
          Logout
        </button>
      </div>

      {error && (
        <div
          style={{
            marginTop: 8,
            color: "var(--error, #f43f5e)",
            fontSize: 11,
            wordBreak: "break-word",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
