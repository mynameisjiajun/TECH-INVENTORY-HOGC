"use client";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/context/AuthContext";
import Navbar from "@/components/Navbar";
import CartPanel from "@/components/CartPanel";
import { displayPeriod } from "@/lib/laptops";

const CHECKLIST_ITEMS = [
  { key: "archived",     label: "Archived & deleted files" },
  { key: "trashCleared", label: "Trash bin cleared?" },
  { key: "quitApps",     label: "Quit all apps?" },
  { key: "shutDown",     label: "Shut down Mac?" },
  { key: "returned",     label: "Returned Mac (cable + charger)?" },
];

export default function MyLaptopLoans() {
  const { user } = useAuth();
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [returningLoan, setReturningLoan] = useState(null);
  const [checklist, setChecklist] = useState({});
  const [remarks, setRemarks] = useState("");
  const [returning, setReturning] = useState(false);

  async function fetchLoans() {
    try {
      const res = await fetch("/api/laptop-loans");
      const data = await res.json();
      const all = Array.isArray(data) ? data : [];
      setLoans(all.sort((a, b) => b.start_date.localeCompare(a.start_date)));
    } catch {}
    setLoading(false);
  }

  useEffect(() => { fetchLoans(); }, []);

  const activeLoans = useMemo(() => loans.filter((l) => l.status === "active"), [loans]);
  const pastLoans = useMemo(() => loans.filter((l) => l.status === "returned"), [loans]);
  const checkedCount = CHECKLIST_ITEMS.filter((i) => checklist[i.key]).length;

  function openReturnModal(loan) {
    setReturningLoan(loan);
    setChecklist(Object.fromEntries(CHECKLIST_ITEMS.map((i) => [i.key, false])));
    setRemarks("");
  }

  async function confirmReturn() {
    if (!returningLoan) return;
    setReturning(true);
    const checkedLabels = CHECKLIST_ITEMS.filter((i) => checklist[i.key]).map((i) => i.label);
    const uncheckedLabels = CHECKLIST_ITEMS.filter((i) => !checklist[i.key]).map((i) => i.label);
    try {
      await fetch(`/api/laptop-loans/${returningLoan.id}/return`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnRemarks: remarks || undefined,
          checkedItems: checkedLabels.length ? checkedLabels : undefined,
          uncheckedItems: uncheckedLabels.length ? uncheckedLabels : undefined,
        }),
      });
      await fetchLoans();
    } catch {}
    setReturning(false);
    setReturningLoan(null);
  }

  return (
    <>
      <Navbar />
      <CartPanel />
      <div className="page-container" style={{ maxWidth: 780 }}>
        <div className="page-header">
          <h1>My Laptop Loans</h1>
          <p>Your laptop loan history.</p>
        </div>

        <div style={{ marginBottom: 32 }}>
          <h2
            style={{
              fontSize: 11, fontWeight: 600, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12,
            }}
          >
            Active
          </h2>
          <div className="card">
            {loading ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
                Loading…
              </div>
            ) : !activeLoans.length ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
                No active loans.
              </div>
            ) : (
              activeLoans.map((loan, i) => (
                <div
                  key={loan.id}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    gap: 16, padding: "16px 20px",
                    borderBottom: i < activeLoans.length - 1 ? "1px solid var(--border)" : "none",
                  }}
                >
                  <div>
                    <p style={{ fontWeight: 600, fontSize: 14 }}>
                      {loan.laptop_id} · {loan.laptop_name}
                    </p>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                      {loan.reason}
                    </p>
                  </div>
                  <div
                    style={{
                      textAlign: "right", fontSize: 12, color: "var(--text-secondary)",
                      display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6,
                    }}
                  >
                    <p>{displayPeriod(loan)}</p>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <span
                        style={{
                          padding: "2px 8px", borderRadius: 20,
                          background: "var(--success-bg)", color: "var(--success)",
                          fontWeight: 600, fontSize: 11,
                        }}
                      >
                        Active
                      </span>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => openReturnModal(loan)}
                      >
                        Return
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <h2
            style={{
              fontSize: 11, fontWeight: 600, color: "var(--text-muted)",
              textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12,
            }}
          >
            Past
          </h2>
          <div className="card">
            {!pastLoans.length ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
                No past loans.
              </div>
            ) : (
              pastLoans.map((loan, i) => (
                <div
                  key={loan.id}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    gap: 16, padding: "16px 20px",
                    borderBottom: i < pastLoans.length - 1 ? "1px solid var(--border)" : "none",
                  }}
                >
                  <div>
                    <p style={{ fontWeight: 600, fontSize: 14 }}>
                      {loan.laptop_id} · {loan.laptop_name}
                    </p>
                    <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                      {loan.reason}
                    </p>
                  </div>
                  <div style={{ textAlign: "right", fontSize: 12, color: "var(--text-secondary)" }}>
                    <p>{displayPeriod(loan)}</p>
                    <span
                      style={{
                        display: "inline-block", marginTop: 4,
                        padding: "2px 8px", borderRadius: 20,
                        background: "rgba(100,116,139,0.15)", color: "var(--text-muted)",
                        fontWeight: 600, fontSize: 11,
                      }}
                    >
                      Returned
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {returningLoan && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 50,
            display: "flex", alignItems: "center", justifyContent: "center",
            padding: 16, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setReturningLoan(null); }}
        >
          <div className="card" style={{ width: "100%", maxWidth: 440, padding: 24, position: "relative" }}>
            <button
              onClick={() => setReturningLoan(null)}
              style={{
                position: "absolute", top: 16, right: 16,
                background: "none", border: "none",
                color: "var(--text-muted)", cursor: "pointer", fontSize: 22, lineHeight: 1,
              }}
            >
              ×
            </button>
            <h2 style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>Return Laptop</h2>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 20 }}>
              {returningLoan.laptop_id} · {returningLoan.reason}
            </p>

            <div style={{ marginBottom: 16 }}>
              {CHECKLIST_ITEMS.map((item) => (
                <label
                  key={item.key}
                  style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "6px 0" }}
                >
                  <input
                    type="checkbox"
                    checked={!!checklist[item.key]}
                    onChange={(e) =>
                      setChecklist((prev) => ({ ...prev, [item.key]: e.target.checked }))
                    }
                    style={{ width: 16, height: 16, accentColor: "var(--accent)", cursor: "pointer", flexShrink: 0 }}
                  />
                  <span
                    style={{
                      fontSize: 14,
                      color: checklist[item.key] ? "var(--text-muted)" : "var(--text-primary)",
                      textDecoration: checklist[item.key] ? "line-through" : "none",
                      transition: "all 0.15s",
                    }}
                  >
                    {item.label}
                  </span>
                </label>
              ))}
            </div>

            <div style={{ marginBottom: 20 }}>
              <div
                style={{
                  height: 6, background: "rgba(99,102,241,0.15)",
                  borderRadius: 3, overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%", background: "var(--success)", borderRadius: 3,
                    width: `${(checkedCount / CHECKLIST_ITEMS.length) * 100}%`,
                    transition: "width 0.3s",
                  }}
                />
              </div>
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, textAlign: "right" }}>
                {checkedCount} / {CHECKLIST_ITEMS.length} completed
              </p>
            </div>

            <div className="input-group">
              <label>
                Remarks{" "}
                <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional)</span>
              </label>
              <textarea
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={2}
                placeholder="Any notes about the laptop condition…"
              />
            </div>

            <button
              className="btn btn-danger"
              disabled={returning}
              onClick={confirmReturn}
              style={{ width: "100%", justifyContent: "center" }}
            >
              {returning ? "Returning…" : "Confirm Return"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
