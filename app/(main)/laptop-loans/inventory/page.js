"use client";
import { useState, useEffect, useMemo } from "react";
import Navbar from "@/components/Navbar";
import CartPanel from "@/components/CartPanel";
import { LAPTOPS, TIER_LABELS, fmtDatetime, fmtDate } from "@/lib/laptops";

const CONDITION_COLORS = {
  Excellent: { bg: "var(--success-bg)", color: "var(--success)" },
  Good:      { bg: "var(--info-bg)",    color: "var(--info)" },
  Fair:      { bg: "var(--warning-bg)", color: "var(--warning)" },
};

const TIERS = ["tier1", "tier2", "permanent"];

export default function LaptopInventory() {
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/laptop-loans")
      .then((r) => r.json())
      .then((data) => { setLoans(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // O(1) lookup: laptop_id → active loan for today
  const activeLoanByLaptop = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const map = new Map();
    for (const l of loans) {
      if (l.status === "active" && l.start_date <= today && l.end_date >= today) {
        map.set(l.laptop_id, l);
      }
    }
    return map;
  }, [loans]);

  return (
    <>
      <Navbar />
      <CartPanel />
      <div className="page-container">
        <div className="page-header">
          <h1>Laptop Inventory</h1>
          <p>Current status of all laptops across tiers.</p>
        </div>

        {loading ? (
          <div className="card card-body" style={{ textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>Loading…</div>
        ) : (
          TIERS.map((tier) => {
            const tierLaptops = LAPTOPS.filter((l) => l.tier === tier);
            return (
              <div key={tier} style={{ marginBottom: 32 }}>
                <h2 style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
                  {TIER_LABELS[tier]}
                </h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
                  {tierLaptops.map((laptop) => {
                    const activeLoan = tier !== "permanent" ? activeLoanByLaptop.get(laptop.id) : null;
                    const condColor = CONDITION_COLORS[laptop.condition] || CONDITION_COLORS.Good;

                    return (
                      <div key={laptop.id} className="card card-body" style={{ padding: 16 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                          <div>
                            <p style={{ fontWeight: 700, fontSize: 15 }}>{laptop.id}</p>
                            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{laptop.specs}</p>
                          </div>
                          <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: condColor.bg, color: condColor.color }}>
                            {laptop.condition}
                          </span>
                        </div>

                        {tier === "permanent" ? (
                          <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: "var(--permanent-bg)", color: "var(--permanent)" }}>
                            Deployed
                          </span>
                        ) : activeLoan ? (
                          <div>
                            <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, marginBottom: 6, background: "var(--warning-bg)", color: "var(--warning)" }}>
                              On Loan
                            </span>
                            <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                              {activeLoan.borrower_name}{activeLoan.ministry ? ` · ${activeLoan.ministry}` : ""}
                            </p>
                            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                              Until {activeLoan.end_datetime ? fmtDatetime(activeLoan.end_datetime) : fmtDate(activeLoan.end_date)}
                            </p>
                          </div>
                        ) : (
                          <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: "var(--success-bg)", color: "var(--success)" }}>
                            Available
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
