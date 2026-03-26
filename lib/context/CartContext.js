"use client";
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";

const CartContext = createContext(null);
const STORAGE_KEY = "tech-inventory-cart";

export function CartProvider({ children }) {
  const [items, setItems] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [modifyingLoan, setModifyingLoan] = useState(null);

  // Load cart from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setItems(parsed);
        }
      }
    } catch (e) {
      console.error("Failed to load cart", e);
    } finally {
      setHydrated(true);
    }
  }, []);

  // Save cart to localStorage on change
  useEffect(() => {
    if (!hydrated) return;
    try {
      // Small debounce/delay to ensure we aren't overwriting with empty state during unmounts/remounts
      const timer = setTimeout(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      }, 50);
      return () => clearTimeout(timer);
    } catch (e) {
      console.error("Failed to save cart", e);
    }
  }, [items, hydrated]);

  const addItem = useCallback((item) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.id === item.id);
      if (existing) {
        return prev.map((i) =>
          i.id === item.id
            ? { ...i, quantity: Math.min(i.quantity + 1, i.max) }
            : i,
        );
      }
      return [...prev, { ...item, quantity: 1, max: item.current }];
    });
  }, []);

  const removeItem = useCallback((id) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const updateQuantity = useCallback((id, qty) => {
    setItems((prev) =>
      prev
        .map((i) => {
          if (i.id === id) {
            const newQty = Math.max(0, Math.min(qty, i.max));
            return newQty === 0 ? null : { ...i, quantity: newQty };
          }
          return i;
        })
        .filter(Boolean),
    );
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setModifyingLoan(null);
    setIsOpen(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        isOpen,
        setIsOpen,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        totalItems,
        setItems,
        modifyingLoan,
        setModifyingLoan,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
