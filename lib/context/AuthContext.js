"use client";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Check for token existence before even starting loading if possible
  // But since cookies are not accessible in 'use client' easily for httpOnly, we rely on the check.

  const checkAuth = useCallback(async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch("/api/auth/me", { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      clearTimeout(timeout);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
    // Re-check when tab becomes visible again — ensures role changes made by
    // an admin take effect on the affected user's next tab focus, not just on
    // next full page reload.
    const onVisible = () => { if (document.visibilityState === "visible") checkAuth(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [checkAuth]);

  const login = async (username, password) => {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", username, password }),
    });
    const data = await res.json();
    if (res.ok) {
      setUser(data.user);
      return { ok: true };
    }
    return { ok: false, error: data.error };
  };

  const register = async (
    username,
    password,
    display_name,
    invite_code,
    email,
    telegram_handle
  ) => {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "register",
        username,
        password,
        display_name,
        invite_code,
        email,
        telegram_handle,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setUser(data.user);
      return { ok: true };
    }
    return { ok: false, error: data.error };
  };

  const logout = async () => {
    await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
    });
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, login, register, logout, checkAuth }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
