"use client";
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
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
          const today = new Date().toISOString().split("T")[0];
          const migrated = parsed
            .map((item) => item._cartType ? item : { ...item, _cartType: "tech" })
            // Drop laptop items whose start_date is in the past
            .filter((item) => !(item._cartType === "laptop" && item.start_date && item.start_date < today));
          setItems(migrated);
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
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
      } catch (e) {
        console.error("Failed to save cart", e);
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [items, hydrated]);

  // Derived cart type from items (no longer stored as state)
  const cartType = useMemo(() => {
    if (items.length === 0) return null;
    const hasLaptop = items.some((i) => i._cartType === "laptop");
    const hasTech = items.some((i) => i._cartType !== "laptop");
    if (hasLaptop && hasTech) return "mixed";
    if (hasLaptop) return "laptop";
    return "tech";
  }, [items]);

  // Add a tech inventory item
  const addItem = useCallback((item) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.id === item.id && i._cartType !== "laptop");
      if (existing) {
        return prev.map((i) =>
          i.id === item.id && i._cartType !== "laptop"
            ? { ...i, quantity: Math.min(i.quantity + 1, i.max) }
            : i
        );
      }
      return [...prev, { ...item, _cartType: "tech", quantity: 1, max: item.current }];
    });
  }, []);

  // Add a laptop item (with dates baked in)
  const addLaptopItem = useCallback((laptop, startDate, endDate, loanType) => {
    setItems((prev) => {
      // Duplicate check: same laptop + same dates
      const existing = prev.find(
        (i) => i.id === laptop.id && i._cartType === "laptop" && i.start_date === startDate && i.end_date === endDate
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
  }, []);

  const removeItem = useCallback((id, startDate) => {
    setItems((prev) => {
      if (startDate !== undefined) {
        return prev.filter((i) => !(i.id === id && i._cartType === "laptop" && i.start_date === startDate));
      }
      return prev.filter((i) => !(i.id === id && i._cartType !== "laptop"));
    });
  }, []);

  const updateQuantity = useCallback((id, qty) => {
    setItems((prev) => {
      const next = prev
        .map((i) => {
          if (i.id === id && i._cartType !== "laptop") {
            const newQty = Math.max(0, Math.min(qty, i.max));
            return newQty === 0 ? null : { ...i, quantity: newQty };
          }
          return i;
        })
        .filter(Boolean);
      return next;
    });
  }, []);

  // Update dates for a specific laptop in the cart
  const updateLaptopDates = useCallback((id, startDate, startDateOld, endDate) => {
    setItems((prev) =>
      prev.map((i) => {
        if (i.id === id && i._cartType === "laptop" && i.start_date === startDateOld) {
          return { ...i, start_date: startDate, end_date: endDate || null };
        }
        return i;
      })
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
        addLaptopItem,
        removeItem,
        updateQuantity,
        updateLaptopDates,
        clearCart,
        totalItems,
        setItems,
        modifyingLoan,
        setModifyingLoan,
        cartType,
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
