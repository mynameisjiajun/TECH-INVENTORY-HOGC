"use client";
import { useCart } from "@/lib/context/CartContext";
import { useState, useEffect } from "react";
import {
  RiCloseLine,
  RiAddLine,
  RiSubtractLine,
  RiDeleteBinLine,
  RiShoppingCart2Line,
} from "react-icons/ri";

export default function CartPanel() {
  const {
    items,
    isOpen,
    setIsOpen,
    updateQuantity,
    removeItem,
    clearCart,
    totalItems,
    modifyingLoan,
    setModifyingLoan,
  } = useCart();
  const [showLoanForm, setShowLoanForm] = useState(false);
  const [loanType, setLoanType] = useState("");
  const [formData, setFormData] = useState({
    purpose: "",
    department: "",
    start_date: "",
    end_date: "",
    location: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const handleCheckout = (type) => {
    setLoanType(type);
    setShowLoanForm(true);
    setError("");
    const today = new Date().toISOString().split("T")[0];
    setFormData((prev) => ({ ...prev, start_date: today }));
  };

  useEffect(() => {
    if (modifyingLoan) {
      setLoanType(modifyingLoan.loan_type);
      setFormData({
        purpose: modifyingLoan.purpose || "",
        department: modifyingLoan.department || "",
        start_date: modifyingLoan.start_date || "",
        end_date: modifyingLoan.end_date || "",
        location: modifyingLoan.location || "",
      });
      // Don't auto-open form here so they can add/remove items first
    }
  }, [modifyingLoan]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const isModifying = !!modifyingLoan;
      const endpoint = isModifying ? `/api/loans/${modifyingLoan.id}` : "/api/loans";
      const method = isModifying ? "PUT" : "POST";
      
      const res = await fetch(endpoint, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loan_type: loanType,
          purpose: formData.purpose,
          department: formData.department,
          start_date: formData.start_date,
          end_date: loanType === "temporary" ? formData.end_date : null,
          location: loanType === "permanent" ? formData.location : "",
          items: items.map((i) => ({ item_id: i.id, quantity: i.quantity })),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      clearCart();
      setShowLoanForm(false);
      setIsOpen(false);
      // Hard navigate to bust Next.js client cache so new loan appears immediately
      window.location.href = "/loans";
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div
        className={`cart-overlay ${isOpen ? "open" : ""}`}
        onClick={() => setIsOpen(false)}
      />
      <div className={`cart-panel ${isOpen ? "open" : ""}`}>
        <div className="cart-header">
          <h2>
            <RiShoppingCart2Line
              style={{ verticalAlign: "middle", marginRight: 8 }}
            />{" "}
            {modifyingLoan ? `Modifying Loan #${modifyingLoan.id}` : `Cart (${totalItems})`}
          </h2>
          <button
            aria-label="Close cart"
            className="btn btn-icon btn-outline"
            onClick={() => setIsOpen(false)}
          >
            <RiCloseLine size={20} />
          </button>
        </div>

        {!showLoanForm ? (
          <>
            <div className="cart-items">
              {items.length === 0 ? (
                <div className="empty-state" style={{ padding: 40 }}>
                  <div className="empty-icon">🛒</div>
                  <h3>Cart is empty</h3>
                  <p>Browse the inventory and add items to borrow</p>
                </div>
              ) : (
                items.map((item) => (
                  <div key={item.id} className="cart-item">
                    <div className="cart-item-info">
                      <h4>{item.item}</h4>
                      <p>
                        {item.type} · {item.brand}
                      </p>
                      <p style={{ color: "var(--text-muted)", fontSize: 10 }}>
                        Available: {item.max}
                      </p>
                    </div>
                    <div className="qty-control">
                      <button
                        aria-label="Decrease quantity"
                        onClick={() =>
                          updateQuantity(item.id, item.quantity - 1)
                        }
                      >
                        <RiSubtractLine />
                      </button>
                      <span>{item.quantity}</span>
                      <button
                        aria-label="Increase quantity"
                        onClick={() =>
                          updateQuantity(item.id, item.quantity + 1)
                        }
                      >
                        <RiAddLine />
                      </button>
                    </div>
                    <button
                      aria-label="Remove item"
                      className="cart-delete-btn"
                      onClick={() => removeItem(item.id)}
                      title="Remove item"
                    >
                      <RiDeleteBinLine size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>

            {items.length > 0 && (
              <div className="cart-footer">
                <p style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>
                  {totalItems} item{totalItems !== 1 ? "s" : ""} selected
                </p>
                <div className="cart-checkout-buttons">
                  {!modifyingLoan ? (
                    <>
                      <button
                        className="btn btn-primary cart-checkout-btn"
                        style={{
                          background: "linear-gradient(135deg, var(--temporary), #60a5fa)",
                        }}
                        onClick={() => handleCheckout("temporary")}
                      >
                        ⏱️ Temp Loan
                      </button>
                      <button
                        className="btn btn-primary cart-checkout-btn"
                        style={{
                          background: "linear-gradient(135deg, var(--permanent), #c084fc)",
                        }}
                        onClick={() => handleCheckout("permanent")}
                      >
                        📌 Perm Loan
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-primary cart-checkout-btn"
                      style={{ width: "100%", background: "linear-gradient(135deg, #f59e0b, #fbbf24)" }}
                      onClick={() => setShowLoanForm(true)}
                    >
                      Continue Modifying Form →
                    </button>
                  )}
                </div>
                <button
                  className="btn btn-outline"
                  style={{ width: "100%", marginTop: 8 }}
                  onClick={clearCart}
                >
                  Clear Cart
                </button>
              </div>
            )}
          </>
        ) : (
          <form
            onSubmit={handleSubmit}
            style={{ display: "flex", flexDirection: "column", height: "100%" }}
          >
            <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginBottom: 20,
                }}
              >
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  onClick={() => setShowLoanForm(false)}
                >
                  ← Back to Items
                </button>
                <h3 style={{ fontSize: 16 }}>
                  {modifyingLoan ? "Update Loan Request" : loanType === "temporary" ? "⏱️ Temporary Loan Request" : "📌 Permanent Loan Request"}
                </h3>
              </div>

              {error && <div className="error-msg">{error}</div>}

              <div
                style={{
                  marginBottom: 16,
                  padding: 12,
                  background: "rgba(99,102,241,0.05)",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                }}
              >
                <p
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    marginBottom: 6,
                  }}
                >
                  Items to borrow:
                </p>
                {items.map((item) => (
                  <p
                    key={item.id}
                    style={{
                      fontSize: 13,
                      color: "var(--text-primary)",
                      marginBottom: 2,
                    }}
                  >
                    • {item.item} × {item.quantity}
                  </p>
                ))}
              </div>

              <div className="input-group">
                <label>Purpose *</label>
                <textarea
                  value={formData.purpose}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, purpose: e.target.value }))
                  }
                  placeholder="Why do you need these items?"
                  required
                />
              </div>

              <div className="input-group">
                <label>Department / Ministry</label>
                <input
                  type="text"
                  value={formData.department}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, department: e.target.value }))
                  }
                  placeholder="e.g., Projection, VP, Sound"
                />
              </div>

              <div className="input-group">
                <label>Start Date *</label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, start_date: e.target.value }))
                  }
                  required
                />
              </div>

              {loanType === "temporary" && (
                <div className="input-group">
                  <label>Return Date *</label>
                  <input
                    type="date"
                    value={formData.end_date}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, end_date: e.target.value }))
                    }
                    required
                  />
                </div>
              )}

              {loanType === "permanent" && (
                <>
                  <div className="input-group">
                    <label>Deployment Location *</label>
                    <input
                      type="text"
                      value={formData.location}
                      onChange={(e) =>
                        setFormData((p) => ({ ...p, location: e.target.value }))
                      }
                      placeholder="e.g., Loft, TLR, MCR"
                      required
                    />
                  </div>
                  <div
                    style={{
                      padding: 12,
                      background: "var(--warning-bg)",
                      borderRadius: 8,
                      border: "1px solid rgba(245,158,11,0.2)",
                      fontSize: 12,
                      color: "var(--warning)",
                    }}
                  >
                    ⚠️ Permanent loans require admin approval and items will be
                    marked as deployed to the specified location.
                  </div>
                </>
              )}
            </div>

            <div className="cart-footer">
              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: "100%" }}
                disabled={loading}
              >
                {loading ? "Submitting..." : modifyingLoan ? "Update Loan Request" : "Submit Loan Request"}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
