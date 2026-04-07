"use client";
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useRef,
  useEffect,
} from "react";

const ToastContext = createContext();

let toastId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  // Map<id, { outer: TimerId, inner: TimerId | null }>
  const timersRef = useRef(new Map());

  // Cancel both timers for a toast and clean up the map entry
  const clearTimers = useCallback((id) => {
    const entry = timersRef.current.get(id);
    if (entry) {
      clearTimeout(entry.outer);
      clearTimeout(entry.inner);
      timersRef.current.delete(id);
    }
  }, []);

  // Clear all pending timers when the provider unmounts
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const id of timers.keys()) {
        const entry = timers.get(id);
        if (!entry) continue;
        clearTimeout(entry.outer);
        clearTimeout(entry.inner);
      }
      timers.clear();
    };
  }, []);

  const addToast = useCallback((message, type = "info", duration = 4000) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, message, type, exiting: false }]);

    const entry = { outer: null, inner: null };
    entry.outer = setTimeout(() => {
      setToasts((prev) =>
        prev.map((t) => (t.id === id ? { ...t, exiting: true } : t)),
      );
      entry.inner = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        timersRef.current.delete(id);
      }, 300);
    }, duration);

    timersRef.current.set(id, entry);
    return id;
  }, []);

  const dismissToast = useCallback(
    (id) => {
      clearTimers(id);
      setToasts((prev) => prev.filter((x) => x.id !== id));
    },
    [clearTimers],
  );

  const toast = useMemo(
    () => ({
      success: (msg, dur) => addToast(msg, "success", dur),
      error: (msg, dur) => addToast(msg, "error", dur),
      info: (msg, dur) => addToast(msg, "info", dur),
      warning: (msg, dur) => addToast(msg, "warning", dur),
    }),
    [addToast],
  );

  const icons = {
    success: "✓",
    error: "✕",
    warning: "⚠",
    info: "ℹ",
  };

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-container">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.type} ${t.exiting ? "toast-exit" : "toast-enter"}`}
            onClick={() => dismissToast(t.id)}
          >
            <span className="toast-icon">{icons[t.type]}</span>
            <span className="toast-message">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
