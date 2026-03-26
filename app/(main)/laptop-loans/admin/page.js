"use client";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/context/AuthContext";
import { useRouter } from "next/navigation";
import Navbar from "@/components/Navbar";
import CartPanel from "@/components/CartPanel";
import { displayPeriod } from "@/lib/laptops";

const TH_STYLE = {
  padding: "12px 16px", textAlign: "left",
  fontWeight: 600, color: "var(--text-muted)", fontSize: 12,
};

export default function LaptopLoansAdmin() {
  const today = new Date().toISOString().slice(0, 10);
  const { user } = useAuth();
  const router = useRouter();
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [returningLoan, setReturningLoan] = useState(null);
  const [returning, setReturning] = useState(false);
  const [historySearch, setHistorySearch] = useState("");

  useEffect(() => {
    if (user && user.role !== "admin") router.replace("/laptop-loans");
  }, [user, router]);

  async function fetchLoans() {
    try {
      const res = await fetch("/api/laptop-loans");
      const data = await res.json();
      setLoans(Array.isArray(data) ? data : []);
    } catch {}
    setLoading(false);
  }

  useEffect(() => { fetchLoans(); }, []);

  const activeLoans = useMemo(() =>
    loans.filter((l) => l.status === "active").sort((a, b) => a.end_date.localeCompare(b.end_date)),
    [loans]
  );

  const pastLoans = useMemo(() =>
    loans.filter((l) => l.status === "returned").sort((a, b) => b.end_date.localeCompare(a.end_date)),
    [loans]
  );

  const overdueCount = useMemo(() =>
    activeLoans.filter((l) => l.end_date < today).length,
    [activeLoans]
  );

  const filteredPast = useMemo(() => {
    if (!historySearch) return pastLoans;
    const q = historySearch.toLowerCase();
    return pastLoans.filter((l) =>
      l.borrower_name.toLowerCase().includes(q) ||
      l.laptop_id.toLowerCase().includes(q) ||
      (l.ministry || "").toLowerCase().includes(q)
    );
  }, [pastLoans, historySearch]);

  async function confirmReturn() {
    if (!returningLoan) return;
    setReturning(true);
    try {
      await fetch(`/api/laptop-loans/${returningLoan.id}/return`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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
      <div className="page-container">
        <div className="page-header">
          <h1>Laptop Loans Admin</h1>
          <p>Manage all laptop loans.</p>
        </div>

        <div style={{ display: "flex", gap: 16, marginBottom: 32 }}>
          <div className="card card-body" style={{ padding: 20, minWidth: 120 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Active Loans</p>
            <p style={{ fontSize: 32, fontWeight: 800 }}>{activeLoans.length}</p>
          </div>
          <div className="card card-body" style={{ padding: 20, minWidth: 120 }}>
            <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Overdue</p>
            <p style={{ fontSize: 32, fontWeight: 800, color: overdueCount ? "var(--error)" : "var(--text-primary)" }}>{overdueCount}</p>
          </div>
        </div>

        <div style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>Active Loans</h2>
          <div className="card" style={{ overflow: "hidden" }}>
            {loading ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>Loading…</div>
            ) : !activeLoans.length ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>No active loans.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)", background: "rgba(15,23,42,0.5)" }}>
                      {["Borrower", "Ministry", "Laptop", "Period", "Status", ""].map((h) => (
                        <th key={h} style={TH_STYLE}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {activeLoans.map((loan, i) => {
                      const isOverdue = loan.end_date < today;
                      return (
                        <tr key={loan.id} style={{ borderBottom: i < activeLoans.length - 1 ? "1px solid var(--border)" : "none" }}>
                          <td style={{ padding: "14px 16px", fontWeight: 600 }}>{loan.borrower_name}</td>
                          <td style={{ padding: "14px 16px", color: "var(--text-secondary)" }}>{loan.ministry || "—"}</td>
                          <td style={{ padding: "14px 16px", fontWeight: 600 }}>{loan.laptop_id}</td>
                          <td style={{ padding: "14px 16px", color: "var(--text-secondary)", fontSize: 12 }}>{displayPeriod(loan)}</td>
                          <td style={{ padding: "14px 16px" }}>
                            <span style={{
                              display: "inline-flex", alignItems: "center", gap: 6,
                              padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                              background: isOverdue ? "var(--error-bg)" : "var(--success-bg)",
                              color: isOverdue ? "var(--error)" : "var(--success)",
                            }}>
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: isOverdue ? "var(--error)" : "var(--success)" }} />
                              {isOverdue ? "Overdue" : "Active"}
                            </span>
                          </td>
                          <td style={{ padding: "14px 16px" }}>
                            <button className="btn btn-danger btn-sm" onClick={() => setReturningLoan(loan)}>Return</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <h2 style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Loan History</h2>
            <input
              type="text"
              placeholder="Search borrower, laptop, ministry…"
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              style={{ width: 260 }}
            />
          </div>
          <div className="card" style={{ overflow: "hidden" }}>
            {!filteredPast.length ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>No past loans.</div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)", background: "rgba(15,23,42,0.5)" }}>
                      {["Borrower", "Ministry", "Laptop", "Period", "Reason"].map((h) => (
                        <th key={h} style={TH_STYLE}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPast.map((loan, i) => (
                      <tr key={loan.id} style={{ borderBottom: i < filteredPast.length - 1 ? "1px solid var(--border)" : "none" }}>
                        <td style={{ padding: "14px 16px", fontWeight: 600 }}>{loan.borrower_name}</td>
                        <td style={{ padding: "14px 16px", color: "var(--text-secondary)" }}>{loan.ministry || "—"}</td>
                        <td style={{ padding: "14px 16px", fontWeight: 600 }}>{loan.laptop_id}</td>
                        <td style={{ padding: "14px 16px", color: "var(--text-secondary)", fontSize: 12 }}>{displayPeriod(loan)}</td>
                        <td style={{ padding: "14px 16px", color: "var(--text-secondary)", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{loan.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {returningLoan && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setReturningLoan(null); }}
        >
          <div className="card card-body" style={{ width: "100%", maxWidth: 380 }}>
            <h2 style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Confirm Return</h2>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", marginBottom: 24 }}>
              Mark <strong>{returningLoan.laptop_id}</strong> loaned to <strong>{returningLoan.borrower_name}</strong> as returned?
            </p>
            <div style={{ display: "flex", gap: 12 }}>
              <button className="btn btn-outline" style={{ flex: 1, justifyContent: "center" }} onClick={() => setReturningLoan(null)}>Cancel</button>
              <button className="btn btn-danger" style={{ flex: 1, justifyContent: "center" }} disabled={returning} onClick={confirmReturn}>
                {returning ? "Returning…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
