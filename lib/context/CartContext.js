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
const CART_TYPE_KEY = "tech-inventory-cart-type";

export function CartProvider({ children }) {
  const [items, setItems] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [modifyingLoan, setModifyingLoan] = useState(null);
  const [cartType, setCartType] = useState(null); // 'tech' | 'laptop' | null
  const [conflictAction, setConflictAction] = useState(null); // pending action waiting for user confirmation

  // Load cart from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const savedType = localStorage.getItem(CART_TYPE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setItems(parsed);
      }
      if (savedType) setCartType(savedType);
    } catch (e) {
      console.error("Failed to load cart", e);
    } finally {
      setHydrated(true);
    }
  }, []);

  // Save cart to localStorage on change
  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
        if (cartType) localStorage.setItem(CART_TYPE_KEY, cartType);
        else localStorage.removeItem(CART_TYPE_KEY);
      } catch (e) {
        console.error("Failed to save cart", e);
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [items, cartType, hydrated]);

  // Add a tech inventory item
  const addItem = useCallback((item) => {
    // Conflict: cart has laptop items
    if (cartType === "laptop" && items.length > 0) {
      setConflictAction({ type: "add_tech", item });
      return;
    }
    setCartType("tech");
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
  }, [cartType, items]);

  // Add a laptop item (with dates baked in)
  const addLaptopItem = useCallback((laptop, startDate, endDate, loanType) => {
    // Conflict: cart has tech items
    if (cartType === "tech" && items.length > 0) {
      setConflictAction({ type: "add_laptop", laptop, startDate, endDate, loanType });
      return;
    }
    setCartType("laptop");
    setItems((prev) => {
      // Duplicate check: same laptop + same dates
      const existing = prev.find(
        (i) => i.id === laptop.id && i.start_date === startDate && i.end_date === endDate
      );
      if (existing) return prev;
      return [
        ...prev,
        {
          ...laptop,
          _cartType: "laptop",
          quantity: 1,
          max: 1,
          start_date: startDate,
          end_date: endDate || null,
          loan_type: loanType,
        },
      ];
    });
    setIsOpen(true);
  }, [cartType, items]);

  const removeItem = useCallback((id, startDate) => {
    setItems((prev) => {
      const next = startDate
        ? prev.filter((i) => !(i.id === id && i.start_date === startDate))
        : prev.filter((i) => i.id !== id);
      if (next.length === 0) setCartType(null);
      return next;
    });
  }, []);

  const updateQuantity = useCallback((id, qty) => {
    setItems((prev) => {
      const next = prev
        .map((i) => {
          if (i.id === id) {
            const newQty = Math.max(0, Math.min(qty, i.max));
            return newQty === 0 ? null : { ...i, quantity: newQty };
          }
          return i;
        })
        .filter(Boolean);
      if (next.length === 0) setCartType(null);
      return next;
    });
  }, []);

  const clearCart = useCallback(() => {
    setItems([]);
    setCartType(null);
    setModifyingLoan(null);
    setIsOpen(false);
    setConflictAction(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(CART_TYPE_KEY);
    } catch {}
  }, []);

  // Called when user confirms the conflict prompt (clear + proceed)
  const resolveConflict = useCallback(() => {
    if (!conflictAction) return;
    const action = conflictAction;
    setConflictAction(null);
    setItems([]);
    setCartType(null);
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(CART_TYPE_KEY); } catch {}

    if (action.type === "add_tech") {
      setCartType("tech");
      setItems([{ ...action.item, quantity: 1, max: action.item.current }]);
    } else {
      setCartType("laptop");
      setItems([{
        ...action.laptop, _cartType: "laptop", quantity: 1, max: 1,
        start_date: action.startDate, end_date: action.endDate || null, loan_type: action.loanType,
      }]);
      setIsOpen(true);
    }
  }, [conflictAction]);

  const dismissConflict = useCallback(() => setConflictAction(null), []);

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        isOpen,
        setIsOpen,
        addItem,
        addLaptopItem,
        removeItem,
        updateQuantity,
        clearCart,
        totalItems,
        setItems,
        modifyingLoan,
        setModifyingLoan,
        cartType,
        conflictAction,
        resolveConflict,
        dismissConflict,
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
