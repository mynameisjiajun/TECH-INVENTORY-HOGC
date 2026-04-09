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

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // Holds the AbortController for any in-flight checkAuth call so that a
  // rapid sequence of tab-focus events cancels the previous request before
  // starting a new one, preventing stale responses from overwriting fresh state.
  const pendingCheckRef = useRef(null);

  const checkAuth = useCallback(async () => {
    // Abort any previous in-flight check
    pendingCheckRef.current?.abort();

    const controller = new AbortController();
    pendingCheckRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch("/api/auth/me", { signal: controller.signal });
      clearTimeout(timeout);

      // If this request was superseded, discard its result
      if (controller.signal.aborted) return;

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch (err) {
      clearTimeout(timeout);
      // AbortError is expected when cancelled — don't clear user state
      if (err.name !== "AbortError") setUser(null);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
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
