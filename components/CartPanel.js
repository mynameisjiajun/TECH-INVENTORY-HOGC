"use client";
import { useCart } from "@/lib/context/CartContext";
import { useAuth } from "@/lib/context/AuthContext";
import { useToast } from "@/lib/context/ToastContext";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  RiCloseLine,
  RiAddLine,
  RiSubtractLine,
  RiDeleteBinLine,
  RiShoppingCart2Line,
  RiMacbookLine,
  RiCalendarLine,
  RiTimeLine,
  RiPushpinLine,
} from "react-icons/ri";

export default function CartPanel() {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const canPermanent = ["admin", "tech"].includes(user?.role);
  const {
    items,
    isOpen,
    setIsOpen,
    updateQuantity,
    updateLaptopDates,
    removeItem,
    clearCart,
    totalItems,
    modifyingLoan,
    cartType,
  } = useCart();

  const [showForm, setShowForm] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [techLoanType, setTechLoanType] = useState("temporary");
  const [formData, setFormData] = useState({
    purpose: "",
    department: "",
    start_date: "",
    end_date: "",
    location: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const laptopItems = items.filter((i) => i._cartType === "laptop");
  const techItems = items.filter((i) => i._cartType !== "laptop");

  // Group laptop items by (start_date, end_date, loan_type) for API submission
  const laptopGroups = Object.values(
    laptopItems.reduce((acc, item) => {
      const key = `${item.start_date}__${item.end_date || ""}__${item.loan_type}`;
      if (!acc[key])
        acc[key] = {
          start_date: item.start_date,
          end_date: item.end_date,
          loan_type: item.loan_type,
          laptops: [],
        };
      acc[key].laptops.push(item);
      return acc;
    }, {}),
  );

  useEffect(() => {
    if (modifyingLoan) {
      setTechLoanType(modifyingLoan.loan_type);
      setFormData({
        purpose: modifyingLoan.purpose || "",
        department: modifyingLoan.department || "",
        start_date: modifyingLoan.start_date || "",
        end_date: modifyingLoan.end_date || "",
        location: modifyingLoan.location || "",
      });
    }
  }, [modifyingLoan]);

  // Reset success/form state each time the panel is opened fresh
  useEffect(() => {
    if (isOpen) {
      setSubmitted(false);
      setShowForm(false);
      setError("");
    }
  }, [isOpen]);

  const openCheckoutForm = () => {
    setError("");
    const today = new Date().toISOString().split("T")[0];
    if (!modifyingLoan) {
      setFormData((prev) => ({ ...prev, start_date: today }));
    }
    setShowForm(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // Validate laptop dates before submitting
      if (laptopItems.length > 0) {
        const missingDates = laptopItems.filter(
          (i) => !i.start_date || (i.loan_type === "temporary" && !i.end_date),
        );
        if (missingDates.length > 0) {
          setError(
            `Please set ${missingDates.length === 1 ? "dates for" : "dates for all"} ${missingDates.map((l) => l.name).join(", ")} before submitting.`,
          );
          setLoading(false);
          return;
        }
      }

      const errors = [];
      const results = [];

      // Modifying an existing laptop loan
      if (modifyingLoan?._loanKind === "laptop") {
        const firstItem = laptopItems[0];
        const res = await fetch(`/api/laptop-loans/${modifyingLoan.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            laptop_ids: laptopItems.map((i) => i.id),
            loan_type: firstItem?.loan_type || "temporary",
            start_date: firstItem?.start_date || "",
            end_date: firstItem?.end_date || null,
            purpose: formData.purpose,
            department: formData.department,
          }),
        });
        const data = await res.json();
        if (res.status === 401) {
          const msg =
            "Session expired — please refresh the page and try again.";
          setError(msg);
          toast.error(msg);
          setLoading(false);
          return;
        }
        if (!res.ok)
          errors.push(data.error || "Laptop loan modification failed");
        else results.push("laptop");
      } else {
        // Submit tech loan
        if (techItems.length > 0) {
          const isModifying = !!modifyingLoan;
          const endpoint = isModifying
            ? `/api/loans/${modifyingLoan.id}`
            : "/api/loans";
          const method = isModifying ? "PUT" : "POST";

          const res = await fetch(endpoint, {
            method,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              loan_type: techLoanType,
              purpose: formData.purpose,
              department: formData.department,
              start_date: formData.start_date,
              end_date: techLoanType === "temporary" ? formData.end_date : null,
              location: techLoanType === "permanent" ? formData.location : "",
              items: techItems.map((i) => ({
                item_id: i.id,
                quantity: i.quantity,
              })),
            }),
          });
          const data = await res.json();
          if (res.status === 401) {
            const msg =
              "Session expired — please refresh the page and try again.";
            setError(msg);
            toast.error(msg);
            setLoading(false);
            return;
          }
          if (!res.ok) errors.push(data.error || "Tech loan failed");
          else results.push("tech");
        }

        // Submit laptop loans (new)
        if (laptopItems.length > 0) {
          const loan_groups = laptopGroups.map((g) => ({
            loan_type: g.loan_type,
            start_date: g.start_date,
            end_date: g.end_date || null,
            laptop_ids: g.laptops.map((l) => l.id),
          }));

          const res = await fetch("/api/laptop-loans", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              loan_groups,
              purpose: formData.purpose,
              department: formData.department,
            }),
          });
          const data = await res.json();
          if (res.status === 401) {
            const msg =
              "Session expired — please refresh the page and try again.";
            setError(msg);
            toast.error(msg);
            setLoading(false);
            return;
          }
          if (!res.ok) errors.push(data.error || "Laptop loan failed");
          else results.push("laptop");
        }
      }

      if (errors.length > 0) {
        const msg = errors.join(" | ");
        setError(msg);
        toast.error(msg);
        return;
      }

      clearCart();
      setShowForm(false);
      setSubmitted(true);
      toast.success("Request submitted! We'll notify you when it's reviewed.");
    } catch (err) {
      setError(err.message);
      toast.error(err.message || "Submission failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const cartTitle = () => {
    if (modifyingLoan) return `Modifying Loan #${modifyingLoan.id}`;
    if (cartType === "mixed") return `Cart (${totalItems})`;
    if (cartType === "laptop") return `Laptop Cart (${totalItems})`;
    return `Cart (${totalItems})`;
  };

  const cartIcon =
    cartType === "laptop" ? (
      <RiMacbookLine style={{ verticalAlign: "middle", marginRight: 8 }} />
    ) : (
      <RiShoppingCart2Line
        style={{ verticalAlign: "middle", marginRight: 8 }}
      />
    );

  return (
    <>
      <div
        className={`cart-overlay ${isOpen ? "open" : ""}`}
        onClick={() => setIsOpen(false)}
      />
      <div className={`cart-panel ${isOpen ? "open" : ""}`}>
        <div className="cart-header">
          <h2>
            {cartIcon}
            {cartTitle()}
          </h2>
          <button
            aria-label="Close cart"
            className="btn btn-icon btn-outline"
            onClick={() => setIsOpen(false)}
          >
            <RiCloseLine size={20} />
          </button>
        </div>

        {/* ====== SUCCESS SCREEN ====== */}
        {submitted && (
          <div
            className="cart-success-state"
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: 32,
              textAlign: "center",
              gap: 16,
            }}
          >
            <div className="cart-success-icon" style={{ fontSize: 56 }}>
              🎉
            </div>
            <h3
              className="cart-success-title"
              style={{ fontSize: 20, fontWeight: 700, margin: 0 }}
            >
              Request Submitted!
            </h3>
            <p
              className="cart-success-copy"
              style={{
                color: "var(--text-secondary)",
                fontSize: 14,
                lineHeight: 1.6,
                margin: 0,
              }}
            >
              Your loan request has been sent for approval. We&apos;ll notify
              you when it&apos;s reviewed.
            </p>
            <div
              className="cart-success-actions"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 10,
                width: "100%",
                marginTop: 8,
              }}
            >
              <button
                className="btn btn-primary"
                style={{ width: "100%" }}
                onClick={() => {
                  setSubmitted(false);
                  setIsOpen(false);
                  router.push("/loans");
                }}
              >
                View My Loans →
              </button>
              <button
                className="btn btn-outline"
                style={{ width: "100%" }}
                onClick={() => {
                  setSubmitted(false);
                  setIsOpen(false);
                }}
              >
                Continue Browsing
              </button>
            </div>
          </div>
        )}

        {/* ====== CART VIEW ====== */}
        {!showForm && !submitted && (
          <>
            <div className="cart-items">
              {items.length === 0 ? (
                <div
                  className="empty-state cart-empty-state"
                  style={{
                    padding: 32,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 20,
                  }}
                >
                  <div className="empty-icon">🛒</div>
                  <div style={{ textAlign: "center" }}>
                    <h3 style={{ marginBottom: 6 }}>Cart is empty</h3>
                    <p
                      className="cart-empty-copy"
                      style={{ fontSize: 13, color: "var(--text-secondary)" }}
                    >
                      Browse items to get started
                    </p>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      width: "100%",
                    }}
                  >
                    <button
                      className="btn btn-outline"
                      style={{
                        width: "100%",
                        justifyContent: "center",
                        gap: 8,
                      }}
                      onClick={() => {
                        setIsOpen(false);
                        router.push("/inventory/tech-inventory");
                      }}
                    >
                      📦 Browse Tech Inventory →
                    </button>
                    <button
                      className="btn btn-outline"
                      style={{
                        width: "100%",
                        justifyContent: "center",
                        gap: 8,
                      }}
                      onClick={() => {
                        setIsOpen(false);
                        router.push("/inventory/laptop-loans");
                      }}
                    >
                      💻 Browse Laptop Loans →
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Laptop section */}
                  {laptopItems.length > 0 && (
                    <>
                      {cartType === "mixed" && (
                        <div
                          className="cart-section-kicker"
                          style={{
                            padding: "8px 16px",
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: 1,
                            color: "var(--text-muted)",
                            background: "rgba(255,255,255,0.02)",
                            borderBottom: "1px solid var(--border)",
                            textTransform: "uppercase",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <RiMacbookLine /> Laptops
                        </div>
                      )}
                      {laptopItems.map((item) => (
                        <div
                          key={`laptop-${item.id}-${item.start_date}`}
                          className="cart-item"
                          style={{
                            flexDirection: "column",
                            alignItems: "stretch",
                            gap: 8,
                            padding: "12px 16px",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                            }}
                          >
                            <div className="cart-item-info" style={{ flex: 1 }}>
                              <h4
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                }}
                              >
                                <RiMacbookLine
                                  style={{
                                    color: "var(--accent)",
                                    flexShrink: 0,
                                  }}
                                />
                                {item.name}
                              </h4>
                              <p style={{ fontSize: 12 }}>
                                {item.screen_size}
                                {item.screen_size && item.cpu ? " · " : ""}
                                {item.cpu}
                              </p>
                              <span
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 3,
                                  fontSize: 10,
                                  fontWeight: 700,
                                  padding: "2px 7px",
                                  borderRadius: 5,
                                  marginTop: 3,
                                  background:
                                    item.loan_type === "permanent"
                                      ? "rgba(139,92,246,0.15)"
                                      : "rgba(59,130,246,0.12)",
                                  color:
                                    item.loan_type === "permanent"
                                      ? "#8b5cf6"
                                      : "#3b82f6",
                                  border: `1px solid ${item.loan_type === "permanent" ? "rgba(139,92,246,0.3)" : "rgba(59,130,246,0.3)"}`,
                                }}
                              >
                                {item.loan_type === "permanent" ? (
                                  <>
                                    <RiPushpinLine />
                                    Permanent
                                  </>
                                ) : (
                                  <>
                                    <RiTimeLine />
                                    Temporary
                                  </>
                                )}
                              </span>
                            </div>
                            <button
                              aria-label="Remove laptop"
                              className="cart-delete-btn"
                              onClick={() =>
                                removeItem(item.id, item.start_date)
                              }
                              title="Remove"
                            >
                              <RiDeleteBinLine size={16} />
                            </button>
                          </div>
                          {/* Per-laptop date pickers */}
                          {(!item.start_date ||
                            (item.loan_type === "temporary" &&
                              !item.end_date)) && (
                            <div
                              style={{
                                fontSize: 11,
                                color: "var(--warning)",
                                fontWeight: 600,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                              }}
                            >
                              ⚠️{" "}
                              {!item.start_date
                                ? "Borrow date required"
                                : "Return date required"}
                            </div>
                          )}
                          <div
                            style={{
                              display: "grid",
                              /* Always 1 column — date text at 16px is too wide
                                 to fit two columns in a narrow cart panel */
                              gridTemplateColumns: "minmax(0, 1fr)",
                              gap: 6,
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <label
                                style={{
                                  fontSize: 10,
                                  color: "var(--text-muted)",
                                  fontWeight: 600,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  marginBottom: 4,
                                }}
                              >
                                <RiCalendarLine />
                                Borrow Date
                              </label>
                              <input
                                type="date"
                                value={item.start_date}
                                onChange={(e) =>
                                  updateLaptopDates(
                                    item.id,
                                    e.target.value,
                                    item.start_date,
                                    item.end_date,
                                  )
                                }
                                style={{
                                  width: "100%",
                                  boxSizing: "border-box",
                                  minWidth: 0,
                                  fontSize: 16,
                                  padding: "5px 8px",
                                }}
                              />
                            </div>
                            {item.loan_type === "temporary" && (
                              <div style={{ minWidth: 0 }}>
                                <label
                                  style={{
                                    fontSize: 10,
                                    color: "var(--text-muted)",
                                    fontWeight: 600,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 4,
                                    marginBottom: 4,
                                  }}
                                >
                                  <RiCalendarLine />
                                  Return Date
                                </label>
                                <input
                                  type="date"
                                  value={item.end_date || ""}
                                  min={item.start_date}
                                  onChange={(e) =>
                                    updateLaptopDates(
                                      item.id,
                                      item.start_date,
                                      item.start_date,
                                      e.target.value,
                                    )
                                  }
                                  style={{
                                    width: "100%",
                                    boxSizing: "border-box",
                                    minWidth: 0,
                                    fontSize: 16,
                                    padding: "5px 8px",
                                  }}
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </>
                  )}

                  {/* Tech inventory section */}
                  {techItems.length > 0 && (
                    <>
                      {cartType === "mixed" && (
                        <div
                          className="cart-section-kicker"
                          style={{
                            padding: "8px 16px",
                            fontSize: 11,
                            fontWeight: 700,
                            letterSpacing: 1,
                            color: "var(--text-muted)",
                            background: "rgba(255,255,255,0.02)",
                            borderBottom: "1px solid var(--border)",
                            textTransform: "uppercase",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <RiShoppingCart2Line /> Tech Items
                        </div>
                      )}
                      {techItems.map((item) => (
                        <div key={`tech-${item.id}`} className="cart-item">
                          <div className="cart-item-info">
                            <h4>{item.item}</h4>
                            <p>
                              {item.type} · {item.brand}
                            </p>
                            <p
                              style={{
                                color: "var(--text-muted)",
                                fontSize: 10,
                              }}
                            >
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
                      ))}
                    </>
                  )}
                </>
              )}
            </div>

            {items.length > 0 && (
              <div className="cart-footer">
                {!modifyingLoan ? (
                  <button
                    className="btn btn-primary cart-checkout-btn"
                    style={{
                      width: "100%",
                      background:
                        "linear-gradient(135deg, var(--accent), #818cf8)",
                    }}
                    onClick={openCheckoutForm}
                  >
                    {cartType === "laptop"
                      ? "💻"
                      : cartType === "mixed"
                        ? "📋"
                        : "🛒"}{" "}
                    Checkout
                  </button>
                ) : (
                  <button
                    className="btn btn-primary cart-checkout-btn"
                    style={{
                      width: "100%",
                      background: "linear-gradient(135deg, #f59e0b, #fbbf24)",
                    }}
                    onClick={() => setShowForm(true)}
                  >
                    Continue Modifying Form →
                  </button>
                )}
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
        )}

        {/* ====== CHECKOUT FORM ====== */}
        {showForm && (
          <form
            onSubmit={handleSubmit}
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
            }}
          >
            <div
              className="cart-form-body"
              style={{
                flex: 1,
                minHeight: 0,
                overflow: "auto",
                padding: 24,
              }}
            >
              <div
                className="cart-form-header"
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
                  onClick={() => setShowForm(false)}
                >
                  ← Back
                </button>
                <h3 className="cart-form-title" style={{ fontSize: 16 }}>
                  {modifyingLoan ? "Update Loan Request" : "Loan Request"}
                </h3>
              </div>

              {error && (
                <div className="error-msg" style={{ marginBottom: 16 }}>
                  {error}
                </div>
              )}

              {/* Summary */}
              <div
                className="cart-summary-box"
                style={{
                  marginBottom: 16,
                  padding: 12,
                  background: "rgba(99,102,241,0.05)",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                }}
              >
                {laptopItems.length > 0 && (
                  <>
                    <p
                      className="cart-summary-kicker"
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "var(--text-muted)",
                        marginBottom: 6,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}
                    >
                      Laptops
                    </p>
                    {laptopGroups.map((g, gi) => (
                      <div
                        key={gi}
                        style={{
                          marginBottom: gi < laptopGroups.length - 1 ? 8 : 0,
                        }}
                      >
                        {g.laptops.map((l) => (
                          <p
                            key={l.id}
                            className="cart-summary-line"
                            style={{ fontSize: 13, marginBottom: 2 }}
                          >
                            • {l.name}
                            <span
                              style={{
                                color: "var(--text-muted)",
                                fontSize: 11,
                                marginLeft: 6,
                              }}
                            >
                              {g.start_date}
                              {g.end_date ? ` → ${g.end_date}` : " (permanent)"}
                            </span>
                          </p>
                        ))}
                      </div>
                    ))}
                  </>
                )}
                {techItems.length > 0 && (
                  <>
                    {laptopItems.length > 0 && (
                      <div
                        style={{
                          borderTop: "1px solid var(--border)",
                          margin: "8px 0",
                        }}
                      />
                    )}
                    <p
                      className="cart-summary-kicker"
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: "var(--text-muted)",
                        marginBottom: 6,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}
                    >
                      Tech Items
                    </p>
                    {techItems.map((item) => (
                      <p
                        key={item.id}
                        className="cart-summary-line"
                        style={{ fontSize: 13, marginBottom: 2 }}
                      >
                        • {item.item} × {item.quantity}
                      </p>
                    ))}
                  </>
                )}
              </div>

              {/* Shared fields — apply to all loan types */}
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
                  placeholder="e.g., Projection, VP, Sound, Youth"
                />
              </div>

              {/* Tech loan fields — only shown when tech items present */}
              {techItems.length > 0 && (
                <>
                  <div
                    style={{
                      borderTop: "1px solid var(--border)",
                      paddingTop: 16,
                      marginBottom: 16,
                    }}
                  >
                    <p
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: "var(--text-muted)",
                        marginBottom: 12,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                      }}
                    >
                      Tech Loan Details
                    </p>

                    {/* Loan type toggle */}
                    {!modifyingLoan && (
                      <div
                        style={{ display: "flex", gap: 8, marginBottom: 16 }}
                      >
                        <button
                          type="button"
                          onClick={() => setTechLoanType("temporary")}
                          style={{
                            flex: 1,
                            padding: "9px 0",
                            borderRadius: 10,
                            fontWeight: 600,
                            fontSize: 13,
                            cursor: "pointer",
                            border: "none",
                            background:
                              techLoanType === "temporary"
                                ? "linear-gradient(135deg, var(--accent), #818cf8)"
                                : "rgba(255,255,255,0.05)",
                            color:
                              techLoanType === "temporary"
                                ? "white"
                                : "var(--text-secondary)",
                          }}
                        >
                          ⏱️ Temporary
                        </button>
                        {canPermanent && (
                          <button
                            type="button"
                            onClick={() => setTechLoanType("permanent")}
                            style={{
                              flex: 1,
                              padding: "9px 0",
                              borderRadius: 10,
                              fontWeight: 600,
                              fontSize: 13,
                              cursor: "pointer",
                              border: "none",
                              background:
                                techLoanType === "permanent"
                                  ? "linear-gradient(135deg, #8b5cf6, #a78bfa)"
                                  : "rgba(255,255,255,0.05)",
                              color:
                                techLoanType === "permanent"
                                  ? "white"
                                  : "var(--text-secondary)",
                            }}
                          >
                            📌 Permanent
                          </button>
                        )}
                      </div>
                    )}

                    <div className="input-group">
                      <label>Start Date *</label>
                      <input
                        type="date"
                        value={formData.start_date}
                        onChange={(e) =>
                          setFormData((p) => ({
                            ...p,
                            start_date: e.target.value,
                          }))
                        }
                        required
                      />
                    </div>

                    {techLoanType === "temporary" && (
                      <div className="input-group">
                        <label>Return Date *</label>
                        <input
                          type="date"
                          value={formData.end_date}
                          min={formData.start_date}
                          onChange={(e) =>
                            setFormData((p) => ({
                              ...p,
                              end_date: e.target.value,
                            }))
                          }
                          required
                        />
                      </div>
                    )}

                    {techLoanType === "permanent" && (
                      <>
                        <div className="input-group">
                          <label>Deployment Location *</label>
                          <input
                            type="text"
                            value={formData.location}
                            onChange={(e) =>
                              setFormData((p) => ({
                                ...p,
                                location: e.target.value,
                              }))
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
                          ⚠️ Permanent loans require admin approval and items
                          will be marked as deployed.
                        </div>
                      </>
                    )}
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
                {loading
                  ? "Submitting..."
                  : modifyingLoan
                    ? "Update Loan Request"
                    : "Submit Loan Request"}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
