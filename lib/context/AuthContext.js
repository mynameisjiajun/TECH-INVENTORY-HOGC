"use client";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
} from "react";

const AUTH_CACHE_KEY = "auth_user_cache";

function readCache() {
  try {
    const raw = localStorage.getItem(AUTH_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(user) {
  try {
    if (user) {
      localStorage.setItem(
        AUTH_CACHE_KEY,
        JSON.stringify({
          id: user.id,
          username: user.username,
          display_name: user.display_name,
          profile_emoji: user.profile_emoji || null,
          role: user.role,
        }),
      );
    } else {
      localStorage.removeItem(AUTH_CACHE_KEY);
    }
  } catch {}
}

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // Start with null/loading on both server and client so SSR and hydration match.
  // Cached user is applied in a useEffect after mount, which avoids the hydration
  // mismatch that caused the Navbar brand to flip between <div> (loading) and <Link>.
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const pendingCheckRef = useRef(null);

  const checkAuth = useCallback(async () => {
    pendingCheckRef.current?.abort();

    const controller = new AbortController();
    pendingCheckRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch("/api/auth/me", { signal: controller.signal });
      clearTimeout(timeout);

      if (controller.signal.aborted) return;

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
        writeCache(data.user);
      } else {
        setUser(null);
        writeCache(null);
      }
    } catch (err) {
      clearTimeout(timeout);
      if (err.name !== "AbortError") {
        setUser(null);
        writeCache(null);
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Apply cached user on mount so authed users don't see a loading flash.
    const cached = readCache();
    if (cached) {
      setUser(cached);
      setLoading(false);
    }
    checkAuth();
    const onVisible = () => {
      if (document.visibilityState === "visible") checkAuth();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      // Cancel any in-flight check when the provider unmounts
      pendingCheckRef.current?.abort();
    };
  }, [checkAuth]);

  const login = useCallback(async (username, password) => {
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
  }, []);

  const register = useCallback(async (
    username,
    password,
    display_name,
    invite_code,
    email,
    telegram_handle,
    ministry,
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
        ministry: ministry || null,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setUser(data.user);
      return { ok: true };
    }
    return { ok: false, error: data.error };
  }, []);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
    } catch {
      // Network error — clear client-side state regardless
    }
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, checkAuth }),
    [user, loading, login, register, logout, checkAuth],
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
