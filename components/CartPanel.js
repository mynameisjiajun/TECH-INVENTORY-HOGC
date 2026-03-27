"use client";
import { useCart } from "@/lib/context/CartContext";
import { useState, useEffect } from "react";
import {
  RiCloseLine,
  RiAddLine,
  RiSubtractLine,
  RiDeleteBinLine,
  RiShoppingCart2Line,
  RiMacbookLine,
  RiAlertLine,
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
    cartType,
    conflictAction,
    resolveConflict,
    dismissConflict,
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

  // Laptop checkout state
  const [showLaptopForm, setShowLaptopForm] = useState(false);
  const [laptopPurpose, setLaptopPurpose] = useState("");
  const [laptopSplitWarning, setLaptopSplitWarning] = useState(false);
  const [laptopLoading, setLaptopLoading] = useState(false);
  const [laptopError, setLaptopError] = useState("");

  const isLaptopCart = cartType === "laptop";

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
    }
  }, [modifyingLoan]);

  // Group laptop items by (start_date, end_date, loan_type)
  const laptopGroups = isLaptopCart
    ? Object.values(
        items.reduce((acc, item) => {
          const key = `${item.start_date}__${item.end_date || ""}__${item.loan_type}`;
          if (!acc[key]) acc[key] = { start_date: item.start_date, end_date: item.end_date, loan_type: item.loan_type, laptops: [] };
          acc[key].laptops.push(item);
          return acc;
        }, {})
      )
    : [];

  const hasMultipleDateGroups = laptopGroups.length > 1;

  const handleLaptopCheckout = () => {
    if (hasMultipleDateGroups) {
      setLaptopSplitWarning(true);
      return;
    }
    setShowLaptopForm(true);
    setLaptopError("");
  };

  const submitLaptopLoans = async (e) => {
    if (e) e.preventDefault();
    setLaptopLoading(true);
    setLaptopError("");
    setLaptopSplitWarning(false);

    try {
      const loan_groups = laptopGroups.map((g) => ({
        loan_type: g.loan_type,
        start_date: g.start_date,
        end_date: g.end_date || null,
        laptop_ids: g.laptops.map((l) => l.id),
      }));

      const res = await fetch("/api/laptop-loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loan_groups, purpose: laptopPurpose }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      clearCart();
      setShowLaptopForm(false);
      setIsOpen(false);
      window.location.href = "/loans";
    } catch (err) {
      setLaptopError(err.message);
    } finally {
      setLaptopLoading(false);
    }
  };

  // Tech inventory submit
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
      window.location.href = "/loans";
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Cart conflict modal */}
      {conflictAction && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)",
          zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }}>
          <div style={{
            background: "var(--bg-card)", borderRadius: 16, border: "1px solid var(--border)",
            maxWidth: 400, width: "100%", padding: 28, boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <RiAlertLine style={{ color: "var(--warning)", fontSize: 24, flexShrink: 0 }} />
              <h3 style={{ margin: 0, fontSize: 17 }}>Cart Conflict</h3>
            </div>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 20, lineHeight: 1.6 }}>
              You can&apos;t mix <strong>Laptop Loans</strong> and <strong>Tech Inventory</strong> items in the same cart.
              Clear your current cart and start fresh?
            </p>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={dismissConflict}>
                Keep Current Cart
              </button>
              <button
                className="btn btn-primary"
                style={{ flex: 1, background: "var(--warning)", borderColor: "var(--warning)" }}
                onClick={resolveConflict}
              >
                Clear & Switch
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={`cart-overlay ${isOpen ? "open" : ""}`} onClick={() => setIsOpen(false)} />
      <div className={`cart-panel ${isOpen ? "open" : ""}`}>
        <div className="cart-header">
          <h2>
            {isLaptopCart
              ? <><RiMacbookLine style={{ verticalAlign: "middle", marginRight: 8 }} />Laptop Cart ({totalItems})</>
              : <><RiShoppingCart2Line style={{ verticalAlign: "middle", marginRight: 8 }} />{modifyingLoan ? `Modifying Loan #${modifyingLoan.id}` : `Cart (${totalItems})`}</>
            }
          </h2>
          <button aria-label="Close cart" className="btn btn-icon btn-outline" onClick={() => setIsOpen(false)}>
            <RiCloseLine size={20} />
          </button>
        </div>

        {/* ====== LAPTOP CART ====== */}
        {isLaptopCart && !showLaptopForm && !laptopSplitWarning && (
          <>
            <div className="cart-items">
              {items.length === 0 ? (
                <div className="empty-state" style={{ padding: 40 }}>
                  <div className="empty-icon">💻</div>
                  <h3>No laptops added</h3>
                  <p>Select dates and click Borrow on a laptop</p>
                </div>
              ) : (
                laptopGroups.map((group, gi) => (
                  <div key={gi}>
                    {/* Date group header */}
                    <div style={{
                      padding: "6px 16px", fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                      color: "var(--text-muted)", background: "rgba(255,255,255,0.02)",
                      borderBottom: "1px solid var(--border)", textTransform: "uppercase",
                    }}>
                      {group.loan_type === "permanent" ? "📌 Permanent" : "⏱️ Temp"} · {group.start_date}{group.end_date ? ` → ${group.end_date}` : ""}
                    </div>
                    {group.laptops.map((item) => (
                      <div key={`${item.id}-${item.start_date}`} className="cart-item">
                        <div className="cart-item-info">
                          <h4>{item.name}</h4>
                          <p style={{ fontSize: 12 }}>
                            {item.screen_size}{item.screen_size && item.cpu ? " · " : ""}{item.cpu}
                          </p>
                        </div>
                        <button
                          aria-label="Remove laptop"
                          className="cart-delete-btn"
                          onClick={() => removeItem(item.id, item.start_date)}
                          title="Remove"
                        >
                          <RiDeleteBinLine size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                ))
              )}
            </div>
            {items.length > 0 && (
              <div className="cart-footer">
                <p style={{ fontWeight: 600, marginBottom: 12, fontSize: 14 }}>
                  {totalItems} laptop{totalItems !== 1 ? "s" : ""} selected
                </p>
                <button
                  className="btn btn-primary cart-checkout-btn"
                  style={{ width: "100%", background: "linear-gradient(135deg, #10b981, #059669)" }}
                  onClick={handleLaptopCheckout}
                >
                  💻 Checkout Laptop Loan{laptopGroups.length > 1 ? "s" : ""}
                </button>
                <button className="btn btn-outline" style={{ width: "100%", marginTop: 8 }} onClick={clearCart}>
                  Clear Cart
                </button>
              </div>
            )}
          </>
        )}

        {/* Split warning */}
        {isLaptopCart && laptopSplitWarning && (
          <div style={{ flex: 1, padding: 24 }}>
            <div style={{ background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.3)", borderRadius: 12, padding: 16, marginBottom: 20 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <RiAlertLine style={{ color: "var(--warning)", fontSize: 18, flexShrink: 0 }} />
                <strong style={{ fontSize: 14 }}>Multiple Date Groups Detected</strong>
              </div>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
                Your laptops have different borrow dates. This will create <strong>{laptopGroups.length} separate loan requests</strong>:
              </p>
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                {laptopGroups.map((g, i) => (
                  <div key={i} style={{ fontSize: 12, padding: "6px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 6, border: "1px solid var(--border)" }}>
                    <strong>Request {i + 1}:</strong> {g.laptops.map((l) => l.name).join(", ")}
                    <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>
                      {g.start_date}{g.end_date ? ` → ${g.end_date}` : " (permanent)"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button className="btn btn-primary" style={{ width: "100%", background: "linear-gradient(135deg, #10b981, #059669)" }} onClick={() => { setLaptopSplitWarning(false); setShowLaptopForm(true); }}>
                Confirm & Continue →
              </button>
              <button className="btn btn-outline" style={{ width: "100%" }} onClick={() => setLaptopSplitWarning(false)}>
                ← Back to Cart
              </button>
            </div>
          </div>
        )}

        {/* Laptop loan form */}
        {isLaptopCart && showLaptopForm && (
          <form onSubmit={submitLaptopLoans} style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => setShowLaptopForm(false)}>
                  ← Back
                </button>
                <h3 style={{ fontSize: 16 }}>💻 Laptop Loan Request</h3>
              </div>

              {laptopError && <div className="error-msg" style={{ marginBottom: 16 }}>{laptopError}</div>}

              {/* Summary */}
              <div style={{ marginBottom: 16, padding: 12, background: "rgba(16,185,129,0.05)", borderRadius: 8, border: "1px solid rgba(16,185,129,0.2)" }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>Laptops:</p>
                {laptopGroups.map((g, gi) => (
                  <div key={gi} style={{ marginBottom: gi < laptopGroups.length - 1 ? 8 : 0 }}>
                    {g.laptops.map((l) => (
                      <p key={l.id} style={{ fontSize: 13, color: "var(--text-primary)", marginBottom: 2 }}>
                        • {l.name} <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                          {g.start_date}{g.end_date ? ` → ${g.end_date}` : " (permanent)"}
                        </span>
                      </p>
                    ))}
                  </div>
                ))}
              </div>

              <div className="input-group">
                <label>Purpose *</label>
                <textarea
                  value={laptopPurpose}
                  onChange={(e) => setLaptopPurpose(e.target.value)}
                  placeholder="Why do you need this laptop?"
                  required
                />
              </div>
            </div>

            <div className="cart-footer">
              <button type="submit" className="btn btn-primary" style={{ width: "100%", background: "linear-gradient(135deg, #10b981, #059669)" }} disabled={laptopLoading}>
                {laptopLoading ? "Submitting..." : `Submit ${laptopGroups.length > 1 ? `${laptopGroups.length} ` : ""}Loan Request${laptopGroups.length > 1 ? "s" : ""}`}
              </button>
            </div>
          </form>
        )}

        {/* ====== TECH INVENTORY CART ====== */}
        {!isLaptopCart && !showLoanForm && (
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
                      <p>{item.type} · {item.brand}</p>
                      <p style={{ color: "var(--text-muted)", fontSize: 10 }}>Available: {item.max}</p>
                    </div>
                    <div className="qty-control">
                      <button aria-label="Decrease quantity" onClick={() => updateQuantity(item.id, item.quantity - 1)}>
                        <RiSubtractLine />
                      </button>
                      <span>{item.quantity}</span>
                      <button aria-label="Increase quantity" onClick={() => updateQuantity(item.id, item.quantity + 1)}>
                        <RiAddLine />
                      </button>
                    </div>
                    <button aria-label="Remove item" className="cart-delete-btn" onClick={() => removeItem(item.id)} title="Remove item">
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
                        style={{ background: "linear-gradient(135deg, var(--temporary), #60a5fa)" }}
                        onClick={() => handleCheckout("temporary")}
                      >
                        ⏱️ Temp Loan
                      </button>
                      <button
                        className="btn btn-primary cart-checkout-btn"
                        style={{ background: "linear-gradient(135deg, var(--permanent), #c084fc)" }}
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
                <button className="btn btn-outline" style={{ width: "100%", marginTop: 8 }} onClick={clearCart}>
                  Clear Cart
                </button>
              </div>
            )}
          </>
        )}

        {/* Tech inventory loan form */}
        {!isLaptopCart && showLoanForm && (
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            <div style={{ flex: 1, overflow: "auto", padding: 24 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20 }}>
                <button type="button" className="btn btn-sm btn-outline" onClick={() => setShowLoanForm(false)}>
                  ← Back to Items
                </button>
                <h3 style={{ fontSize: 16 }}>
                  {modifyingLoan ? "Update Loan Request" : loanType === "temporary" ? "⏱️ Temporary Loan Request" : "📌 Permanent Loan Request"}
                </h3>
              </div>

              {error && <div className="error-msg">{error}</div>}

              <div style={{ marginBottom: 16, padding: 12, background: "rgba(99,102,241,0.05)", borderRadius: 8, border: "1px solid var(--border)" }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 6 }}>Items to borrow:</p>
                {items.map((item) => (
                  <p key={item.id} style={{ fontSize: 13, color: "var(--text-primary)", marginBottom: 2 }}>
                    • {item.item} × {item.quantity}
                  </p>
                ))}
              </div>

              <div className="input-group">
                <label>Purpose *</label>
                <textarea
                  value={formData.purpose}
                  onChange={(e) => setFormData((p) => ({ ...p, purpose: e.target.value }))}
                  placeholder="Why do you need these items?"
                  required
                />
              </div>

              <div className="input-group">
                <label>Department / Ministry</label>
                <input
                  type="text"
                  value={formData.department}
                  onChange={(e) => setFormData((p) => ({ ...p, department: e.target.value }))}
                  placeholder="e.g., Projection, VP, Sound"
                />
              </div>

              <div className="input-group">
                <label>Start Date *</label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData((p) => ({ ...p, start_date: e.target.value }))}
                  required
                />
              </div>

              {loanType === "temporary" && (
                <div className="input-group">
                  <label>Return Date *</label>
                  <input
                    type="date"
                    value={formData.end_date}
                    onChange={(e) => setFormData((p) => ({ ...p, end_date: e.target.value }))}
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
                      onChange={(e) => setFormData((p) => ({ ...p, location: e.target.value }))}
                      placeholder="e.g., Loft, TLR, MCR"
                      required
                    />
                  </div>
                  <div style={{ padding: 12, background: "var(--warning-bg)", borderRadius: 8, border: "1px solid rgba(245,158,11,0.2)", fontSize: 12, color: "var(--warning)" }}>
                    ⚠️ Permanent loans require admin approval and items will be marked as deployed.
                  </div>
                </>
              )}
            </div>

            <div className="cart-footer">
              <button type="submit" className="btn btn-primary" style={{ width: "100%" }} disabled={loading}>
                {loading ? "Submitting..." : modifyingLoan ? "Update Loan Request" : "Submit Loan Request"}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
