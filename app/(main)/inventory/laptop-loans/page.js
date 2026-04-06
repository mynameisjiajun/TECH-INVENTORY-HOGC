"use client";
import { useAuth } from "@/lib/context/AuthContext";
import { useCart } from "@/lib/context/CartContext";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useMemo, useRef, memo } from "react";
import Navbar from "@/components/Navbar";
import CartPanel from "@/components/CartPanel";
import {
  RiArrowLeftLine,
  RiMacbookLine,
  RiCalendarLine,
  RiBellLine,
  RiAddLine,
  RiTimeLine,
  RiPushpinLine,
  RiCheckLine,
} from "react-icons/ri";

const LaptopCard = memo(function LaptopCard({ laptop, loanType, startDate, endDate, onBorrow, isAdmin, onNotify, isInCart }) {
  const isAvailable = laptop.availability === "available";
  const isBlocked = laptop.availability === "blocked";
  const isPermLoaned = laptop.availability === "perm_loaned";
  const isTempLoaned = laptop.availability === "temp_loaned";
  const isUnavailable = isBlocked || isPermLoaned || isTempLoaned;

  const canBorrow = isAvailable && startDate && (loanType === "temporary" ? endDate : true) && !isInCart;

  const statusColor = isAvailable
    ? { bg: "rgba(16,185,129,0.12)", color: "#10b981", border: "rgba(16,185,129,0.3)" }
    : isBlocked
    ? { bg: "rgba(239,68,68,0.1)", color: "#ef4444", border: "rgba(239,68,68,0.25)" }
    : isTempLoaned
    ? { bg: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "rgba(245,158,11,0.25)" }
    : { bg: "rgba(139,92,246,0.1)", color: "#8b5cf6", border: "rgba(139,92,246,0.25)" };

  const statusLabel = isAvailable ? "Available"
    : isBlocked ? `Unavailable${laptop.return_date ? ` · Returns ${laptop.return_date}` : ""}`
    : isTempLoaned ? `On Loan · Returns ${laptop.return_date}`
    : "Deployed";

  return (
    <div style={{
      background: "var(--bg-card)",
      border: `1.5px solid ${isUnavailable ? statusColor.border : "var(--border)"}`,
      borderRadius: 18,
      overflow: "hidden",
      opacity: isUnavailable ? 0.7 : 1,
      display: "flex",
      flexDirection: "column",
      transition: "transform 0.15s, box-shadow 0.15s",
    }}>
      {/* Top accent strip */}
      <div style={{
        height: 4,
        background: isAvailable
          ? "linear-gradient(90deg, #10b981, #34d399)"
          : isBlocked
          ? "linear-gradient(90deg, #ef4444, #f87171)"
          : isTempLoaned
          ? "linear-gradient(90deg, #f59e0b, #fbbf24)"
          : "linear-gradient(90deg, #8b5cf6, #a78bfa)",
      }} />

      {/* Card body */}
      <div style={{ padding: "20px 22px", flex: 1, display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Icon + name */}
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14, flexShrink: 0,
            background: `linear-gradient(135deg, ${statusColor.bg}, rgba(255,255,255,0.03))`,
            border: `1px solid ${statusColor.border}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            color: statusColor.color, fontSize: 26,
          }}>
            <RiMacbookLine />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.3 }}>{laptop.name}</div>
            {(laptop.screen_size || laptop.cpu) && (
              <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: 3 }}>
                {laptop.screen_size}{laptop.screen_size && laptop.cpu ? " · " : ""}{laptop.cpu}
              </div>
            )}
            {(isAdmin || user?.role === "tech") && (laptop.ram || laptop.storage) && (
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>
                {laptop.ram}{laptop.ram && laptop.storage ? " · " : ""}{laptop.storage}
              </div>
            )}
          </div>
        </div>

        {/* Status badge */}
        <div>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 5,
            fontSize: 12, fontWeight: 600, padding: "5px 12px", borderRadius: 20,
            background: statusColor.bg, color: statusColor.color, border: `1px solid ${statusColor.border}`,
          }}>
            {isPermLoaned && <RiPushpinLine style={{ fontSize: 12 }} />}
            {statusLabel}
          </span>
        </div>

        {/* Perm loan person */}
        {isPermLoaned && laptop.perm_loan_person && (
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", marginTop: -8 }}>
            Assigned to <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{laptop.perm_loan_person}</span>
            {laptop.perm_loan_reason && <div style={{ color: "var(--text-muted)", marginTop: 2 }}>{laptop.perm_loan_reason}</div>}
          </div>
        )}
      </div>

      {/* Footer action */}
      {(isAvailable || (isBlocked && !isPermLoaned)) && (
        <div style={{ padding: "14px 22px", borderTop: "1px solid var(--border)", background: "rgba(255,255,255,0.02)" }}>
          {isAvailable && (
            <button
              className="btn btn-primary"
              disabled={!canBorrow}
              onClick={() => onBorrow(laptop)}
              title={isInCart ? "Already in cart" : !startDate ? "Select a borrow date first" : !endDate && loanType === "temporary" ? "Select a return date" : "Add to cart"}
              style={{
                width: "100%", justifyContent: "center",
                opacity: canBorrow ? 1 : 0.45,
                background: isInCart ? "rgba(16,185,129,0.15)" : undefined,
                borderColor: isInCart ? "rgba(16,185,129,0.4)" : undefined,
                color: isInCart ? "#10b981" : undefined,
              }}
            >
              {isInCart ? <><RiCheckLine /> Added to Cart</> : <><RiAddLine /> Borrow</>}
            </button>
          )}
          {isBlocked && (
            <button
              onClick={() => onNotify(laptop)}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                padding: "9px 0", fontSize: 13, fontWeight: 600, borderRadius: 10, cursor: "pointer",
                background: laptop.notify_me ? "rgba(99,102,241,0.12)" : "rgba(255,255,255,0.04)",
                border: `1px solid ${laptop.notify_me ? "var(--accent)" : "var(--border)"}`,
                color: laptop.notify_me ? "var(--accent)" : "var(--text-secondary)",
              }}
            >
              <RiBellLine style={{ opacity: laptop.notify_me ? 1 : 0.4 }} />
              {laptop.notify_me ? "Notify Me — On" : "Notify Me When Available"}
            </button>
          )}
        </div>
      )}
    </div>
  );
});

export default function LaptopLoansPage() {
  const { user, loading } = useAuth();
  const { addLaptopItem, items: cartItems } = useCart();
  const router = useRouter();

  const [tab, setTab] = useState("available"); // "available" | "perm"
  const [loanType, setLoanType] = useState("temporary"); // "temporary" | "permanent"
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [tiers, setTiers] = useState([]);
  const [returningSoon, setReturningSoon] = useState([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const abortRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  const today = new Date().toISOString().split("T")[0];

  const fetchLaptops = useCallback((signal) => {
    if (!user) return;
    setFetching(true);
    setError("");
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate && loanType === "temporary") params.set("end_date", endDate);
    else if (startDate && loanType === "permanent") params.set("end_date", "9999-12-31");

    fetch(`/api/laptops?${params}`, { cache: "no-store", signal })
      .then((res) => {
        if (!res.ok) return res.json().catch(() => ({})).then((d) => { throw new Error(d.error || "Failed to load laptops"); });
        return res.json();
      })
      .then((data) => {
        setTiers(data.tiers || []);
        setReturningSoon(data.returningSoon || []);
        setFetching(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return; // stale request cancelled — ignore
        setError(err.message || "Network error — could not load laptops");
        setFetching(false);
      });
  }, [user, startDate, endDate, loanType]);

  useEffect(() => {
    if (!user) return;
    // Cancel any in-flight request
    if (abortRef.current) abortRef.current.abort();
    // Debounce 300ms so rapid date changes don't fire multiple requests
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      fetchLaptops(controller.signal);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [user, fetchLaptops]);

  const handleBorrow = useCallback((laptop) => {
    addLaptopItem(laptop, startDate, loanType === "temporary" ? endDate : null, loanType);
  }, [addLaptopItem, startDate, endDate, loanType]);

  const handleNotify = useCallback(async (laptop) => {
    try {
      const res = await fetch(`/api/laptop-notify/${laptop.id}`, { method: "POST" });
      if (res.ok) {
        setTiers((prev) => prev.map((tier) => ({
          ...tier,
          laptops: tier.laptops.map((l) => l.id === laptop.id ? { ...l, notify_me: !l.notify_me } : l),
        })));
      }
    } catch { /* silent */ }
  }, []);

  const isAdmin = user?.role === "admin";
  const canPermanent = ["admin", "tech"].includes(user?.role);

  // Set of laptop IDs already in the cart (for the current date selection)
  const cartLaptopIds = useMemo(() => new Set(
    cartItems
      .filter((i) => i._cartType === "laptop" && i.start_date === startDate && i.end_date === (loanType === "temporary" ? endDate : null))
      .map((i) => i.id)
  ), [cartItems, startDate, endDate, loanType]);

  // All perm-loaned laptops across all tiers
  const permLoanedLaptops = tiers.flatMap((t) => t.laptops.filter((l) => l.is_perm_loaned));

  if (loading || !user) return (
    <div className="loading-spinner" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div className="spinner" />
    </div>
  );

  const showReturningSidebar = (startDate && returningSoon.length > 0);

  return (
    <>
      <Navbar />
      <CartPanel />
      <div className="page-container">
        {/* Header */}
        <div className="page-header" style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button className="btn btn-sm btn-outline" onClick={() => router.push("/inventory")} style={{ flexShrink: 0 }}>
            <RiArrowLeftLine />
          </button>
          <div>
            <h1>Laptop Loans</h1>
            <p>Borrow Apple laptops for your ministry or project</p>
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs" style={{ marginBottom: 20 }}>
          <button className={`tab ${tab === "available" ? "active" : ""}`} onClick={() => setTab("available")}>
            Available & Temp
          </button>
          <button className={`tab ${tab === "perm" ? "active" : ""}`} onClick={() => setTab("perm")}>
            Perm Loans
          </button>
        </div>

        {error && (
          <div style={{ padding: "10px 16px", background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 8, marginBottom: 16, fontSize: 13, color: "var(--error)" }}>
            {error}
          </div>
        )}

        {/* ====== AVAILABLE & TEMP TAB ====== */}
        {tab === "available" && (
          <>
            {/* Loan type toggle + date pickers */}
            <div className="laptop-sticky-bar">
              {/* Loan type toggle */}
              <div className="laptop-loan-type-toggle">
                <button
                  onClick={() => { setLoanType("temporary"); setEndDate(""); }}
                  style={{
                    flex: 1, padding: "10px 0", borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer", border: "none",
                    background: loanType === "temporary" ? "linear-gradient(135deg, var(--accent), #818cf8)" : "rgba(255,255,255,0.05)",
                    color: loanType === "temporary" ? "white" : "var(--text-secondary)",
                    transition: "all 0.15s",
                  }}
                >
                  <RiTimeLine style={{ verticalAlign: "middle", marginRight: 4 }} />⏱️ Temporary Loan
                </button>
                {canPermanent && (
                  <button
                    onClick={() => { setLoanType("permanent"); setEndDate(""); }}
                    style={{
                      flex: 1, padding: "10px 0", borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer", border: "none",
                      background: loanType === "permanent" ? "linear-gradient(135deg, #8b5cf6, #a78bfa)" : "rgba(255,255,255,0.05)",
                      color: loanType === "permanent" ? "white" : "var(--text-secondary)",
                      transition: "all 0.15s",
                    }}
                  >
                    <RiPushpinLine style={{ verticalAlign: "middle", marginRight: 4 }} />📌 Permanent Loan
                  </button>
                )}
              </div>

              {/* Date pickers */}
              <div className={`laptop-date-grid${loanType !== "temporary" ? " single-col" : ""}`}>
                <div className="input-group" style={{ margin: 0 }}>
                  <label style={{ fontSize: 12, marginBottom: 6, display: "block" }}>
                    {loanType === "temporary" ? "Borrow Date *" : "Start Date *"}
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    min={today}
                    onChange={(e) => {
                      const val = e.target.value;
                      setStartDate(val);
                      // Clear end date if it's now before the new start date
                      if (endDate && val && endDate < val) setEndDate("");
                    }}
                    style={{ width: "100%" }}
                  />
                </div>
                {loanType === "temporary" && (
                  <div className="input-group" style={{ margin: 0 }}>
                    <label style={{ fontSize: 12, marginBottom: 6, display: "block" }}>Return Date *</label>
                    <input
                      type="date"
                      value={endDate}
                      min={startDate || today}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (startDate && val < startDate) return; // silently reject invalid range
                        setEndDate(val);
                      }}
                      style={{ width: "100%", borderColor: endDate && startDate && endDate < startDate ? "var(--error)" : undefined }}
                    />
                  </div>
                )}
              </div>

              {!startDate && (
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10, marginBottom: 0 }}>
                  📅 Select a date to see availability and enable borrowing
                </p>
              )}
            </div>

            {/* Main content: tiers + optional returning soon sidebar */}
            <div className={`laptop-content-grid${showReturningSidebar ? " with-sidebar" : ""}`}>
              {/* Laptop tiers */}
              <div>
                {fetching ? (
                  <div className="loading-spinner"><div className="spinner" /></div>
                ) : tiers.length === 0 ? (
                  <div className="empty-state">
                    <h3>No laptops yet</h3>
                    <p>Admins can add laptops in the Admin panel</p>
                  </div>
                ) : (
                  tiers.map((tier) => {
                    const availableLaptops = tier.laptops.filter((l) => !l.is_perm_loaned);
                    if (availableLaptops.length === 0) return null;
                    return (
                      <div key={tier.id} style={{ marginBottom: 32 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid var(--border)" }}>
                          {tier.name}
                        </div>
                        <div className="laptop-cards-grid">
                          {availableLaptops.map((laptop) => (
                            <LaptopCard
                              key={laptop.id}
                              laptop={laptop}
                              loanType={loanType}
                              startDate={startDate}
                              endDate={endDate}
                              onBorrow={handleBorrow}
                              isAdmin={isAdmin}
                              onNotify={handleNotify}
                              isInCart={cartLaptopIds.has(laptop.id)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Returning Soon sidebar */}
              {showReturningSidebar && (
                <div className="laptop-sidebar" style={{ position: "sticky", top: 80 }}>
                  <div style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14, padding: 18 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 14, display: "flex", alignItems: "center", gap: 6 }}>
                      <RiCalendarLine style={{ color: "var(--accent)" }} /> Returning Soon
                    </h3>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {returningSoon.map((laptop) => (
                        <div key={laptop.id} style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "10px 12px", background: "rgba(255,255,255,0.03)",
                          border: "1px solid var(--border)", borderRadius: 10,
                        }}>
                          <div style={{
                            width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                            background: "rgba(99,102,241,0.1)", display: "flex",
                            alignItems: "center", justifyContent: "center", color: "var(--accent)",
                          }}>
                            <RiMacbookLine size={18} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{laptop.name}</div>
                            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                              {laptop.screen_size && `${laptop.screen_size}`}{laptop.screen_size && laptop.cpu ? " · " : ""}{laptop.cpu}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--warning)", fontWeight: 600, marginTop: 2 }}>
                              Returns: {laptop.return_date}
                            </div>
                          </div>
                          <button
                            onClick={() => handleNotify(laptop)}
                            style={{
                              padding: "4px 8px", fontSize: 11, fontWeight: 600, borderRadius: 6, cursor: "pointer",
                              background: laptop.notify_me ? "rgba(99,102,241,0.15)" : "transparent",
                              border: `1px solid ${laptop.notify_me ? "var(--accent)" : "var(--border)"}`,
                              color: laptop.notify_me ? "var(--accent)" : "var(--text-muted)",
                              flexShrink: 0,
                            }}
                          >
                            {laptop.notify_me ? <RiBellLine size={13} /> : <RiBellLine size={13} style={{ opacity: 0.35 }} />}
                            <span style={{ marginLeft: 3 }}>{laptop.notify_me ? "On" : "Notify"}</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* On mobile: Returning Soon below grid */}
            {showReturningSidebar && (
              <div style={{ marginTop: 24, display: "none" }} className="returning-soon-mobile">
                {/* Duplicated below for mobile — handled via CSS */}
              </div>
            )}
          </>
        )}

        {/* ====== PERM LOANS TAB ====== */}
        {tab === "perm" && (
          <div>
            <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 20 }}>
              These laptops are permanently assigned and not available for general borrowing.
            </p>
            {fetching ? (
              <div className="loading-spinner"><div className="spinner" /></div>
            ) : permLoanedLaptops.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon"><RiMacbookLine /></div>
                <h3>No permanent loans</h3>
                <p>No laptops are currently on permanent loan</p>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
                {permLoanedLaptops.map((laptop) => (
                  <div key={laptop.id} style={{
                    background: "var(--bg-card)", border: "1px solid rgba(139,92,246,0.25)",
                    borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 10,
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 10, flexShrink: 0,
                        background: "linear-gradient(135deg, rgba(139,92,246,0.15), rgba(99,102,241,0.1))",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        color: "#8b5cf6", fontSize: 22,
                      }}>
                        <RiMacbookLine />
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 15 }}>{laptop.name}</div>
                        <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                          {laptop.screen_size}{laptop.screen_size && laptop.cpu ? " · " : ""}{laptop.cpu}
                        </div>
                        {isAdmin && (
                          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                            {laptop.ram}{laptop.ram && laptop.storage ? " · " : ""}{laptop.storage}
                          </div>
                        )}
                      </div>
                    </div>
                    <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, fontWeight: 700,
                        padding: "3px 10px", borderRadius: 20,
                        background: "rgba(139,92,246,0.12)", color: "#8b5cf6", border: "1px solid rgba(139,92,246,0.3)",
                        marginBottom: 8,
                      }}>
                        <RiPushpinLine /> Permanently Deployed
                      </span>
                      {laptop.perm_loan_person && (
                        <div style={{ fontSize: 13 }}>
                          <span style={{ color: "var(--text-muted)", fontSize: 11 }}>Assigned to </span>
                          <span style={{ fontWeight: 600 }}>{laptop.perm_loan_person}</span>
                        </div>
                      )}
                      {laptop.perm_loan_reason && (
                        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
                          {laptop.perm_loan_reason}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile returning soon */}
      <style>{`
        @media (max-width: 768px) {
          .returning-soon-mobile { display: block !important; }
        }
      `}</style>
    </>
  );
}
