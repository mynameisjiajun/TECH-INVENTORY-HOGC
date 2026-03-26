"use client";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/context/AuthContext";
import Navbar from "@/components/Navbar";
import CartPanel from "@/components/CartPanel";
import Link from "next/link";
import { fmtDatetime, fmtDate } from "@/lib/laptops";

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];
const DAY_NAMES = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

const BAR_COLORS = [
  { bg: "rgba(99,102,241,0.25)",  color: "#818cf8" },
  { bg: "rgba(168,85,247,0.25)",  color: "#c084fc" },
  { bg: "rgba(16,185,129,0.25)",  color: "#34d399" },
  { bg: "rgba(245,158,11,0.25)",  color: "#fcd34d" },
  { bg: "rgba(244,63,94,0.25)",   color: "#fb7185" },
  { bg: "rgba(59,130,246,0.25)",  color: "#60a5fa" },
  { bg: "rgba(20,184,166,0.25)",  color: "#2dd4bf" },
  { bg: "rgba(249,115,22,0.25)",  color: "#fb923c" },
];

const _today = new Date();
const todayStr = _today.toISOString().slice(0, 10);

export default function LaptopLoansCalendar() {
  const { user } = useAuth();
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentYear, setCurrentYear] = useState(_today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(_today.getMonth());
  const [selectedLoan, setSelectedLoan] = useState(null);

  useEffect(() => {
    fetch("/api/laptop-loans")
      .then((r) => r.json())
      .then((data) => { setLoans(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const borrowerColorMap = useMemo(() => {
    const names = [...new Set(loans.map((l) => l.borrower_name))];
    return Object.fromEntries(names.map((n, i) => [n, BAR_COLORS[i % BAR_COLORS.length]]));
  }, [loans]);

  const calendarDays = useMemo(() => {
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    let startOffset = firstDay.getDay() - 1;
    if (startOffset < 0) startOffset = 6;
    const days = [];
    for (let i = 0; i < startOffset; i++) days.push(null);
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = `${currentYear}-${String(currentMonth + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ date, day: d });
    }
    while (days.length % 7 !== 0) days.push(null);
    return days;
  }, [currentYear, currentMonth]);

  const weeks = useMemo(() => {
    const result = [];
    for (let i = 0; i < calendarDays.length; i += 7) result.push(calendarDays.slice(i, i + 7));
    return result;
  }, [calendarDays]);

  // Pre-compute bars per week so eventBarsForWeek isn't called twice per week in JSX
  const weekBars = useMemo(() => weeks.map((week) => {
    const validDates = week.filter(Boolean).map((d) => d.date);
    if (!validDates.length) return [];
    const weekStart = validDates[0];
    const weekEnd = validDates[validDates.length - 1];
    const overlapping = loans.filter(
      (l) => l.status === "active" && l.start_date <= weekEnd && l.end_date >= weekStart
    );
    return overlapping.map((loan) => {
      let startCol = week.findIndex((d) => d?.date === loan.start_date);
      if (startCol === -1) startCol = week.findIndex((d) => d !== null);
      let endCol = week.findIndex((d) => d?.date === loan.end_date);
      if (endCol === -1) endCol = week.reduce((last, d, i) => (d !== null ? i : last), startCol);
      return { loan, startCol, span: endCol - startCol + 1 };
    });
  }), [weeks, loans]);

  function prevMonth() {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear((y) => y - 1); }
    else setCurrentMonth((m) => m - 1);
  }
  function nextMonth() {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear((y) => y + 1); }
    else setCurrentMonth((m) => m + 1);
  }

  return (
    <>
      <Navbar />
      <CartPanel />
      <div className="page-container">
        <div
          className="page-header"
          style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}
        >
          <div>
            <h1>Laptop Loans</h1>
            <p>Calendar view of active laptop loans.</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <Link href="/laptop-loans/request" className="btn btn-primary" style={{ textDecoration: "none" }}>
              + Request Loan
            </Link>
            <Link href="/laptop-loans/my-loans" className="btn btn-outline" style={{ textDecoration: "none" }}>
              My Loans
            </Link>
            <Link href="/laptop-loans/inventory" className="btn btn-outline" style={{ textDecoration: "none" }}>
              Inventory
            </Link>
            {user?.role === "admin" && (
              <Link href="/laptop-loans/admin" className="btn btn-outline" style={{ textDecoration: "none" }}>
                Admin
              </Link>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => { setCurrentMonth(_today.getMonth()); setCurrentYear(_today.getFullYear()); }}
          >
            Today
          </button>
          <button className="btn btn-outline btn-sm btn-icon" onClick={prevMonth} style={{ fontSize: 18 }}>‹</button>
          <span style={{ fontWeight: 600, fontSize: 16, minWidth: 160, textAlign: "center" }}>
            {MONTH_NAMES[currentMonth]} {currentYear}
          </span>
          <button className="btn btn-outline btn-sm btn-icon" onClick={nextMonth} style={{ fontSize: 18 }}>›</button>
        </div>

        <div className="card" style={{ overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--border)" }}>
            {DAY_NAMES.map((d) => (
              <div key={d} style={{ padding: "10px 0", textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {d}
              </div>
            ))}
          </div>

          {loading ? (
            <div style={{ padding: 48, textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>Loading…</div>
          ) : (
            weeks.map((week, wi) => {
              const bars = weekBars[wi];
              return (
                <div key={wi} style={{ borderBottom: wi < weeks.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
                    {week.map((cell, di) => (
                      <div
                        key={di}
                        style={{
                          borderRight: di < 6 ? "1px solid var(--border)" : "none",
                          padding: "8px 8px 4px", display: "flex", justifyContent: "flex-end",
                          background: cell ? "transparent" : "rgba(15,23,42,0.3)", minHeight: 38,
                        }}
                      >
                        {cell && (
                          <span style={{
                            width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center",
                            borderRadius: "50%", fontSize: 13, fontWeight: 500,
                            background: cell.date === todayStr ? "var(--accent)" : "transparent",
                            color: cell.date === todayStr ? "white" : "var(--text-secondary)",
                          }}>
                            {cell.day}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>

                  {bars.length > 0 ? (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", padding: "0 2px 6px" }}>
                      {bars.map(({ loan, startCol, span }) => {
                        const color = borrowerColorMap[loan.borrower_name] ?? BAR_COLORS[0];
                        return (
                          <div
                            key={loan.id}
                            style={{
                              gridColumn: `${startCol + 1} / span ${span}`,
                              margin: "1px 2px", padding: "2px 8px", borderRadius: 4,
                              fontSize: 11, fontWeight: 500, background: color.bg, color: color.color,
                              cursor: "pointer", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
                            }}
                            title={`${loan.borrower_name} · ${loan.laptop_id}`}
                            onClick={() => setSelectedLoan(loan)}
                          >
                            {loan.borrower_name} · {loan.laptop_id}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ height: 8 }} />
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {selectedLoan && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setSelectedLoan(null); }}
        >
          <div className="card" style={{ width: "100%", maxWidth: 400, padding: 24, position: "relative" }}>
            <button
              onClick={() => setSelectedLoan(null)}
              style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 22, lineHeight: 1 }}
            >×</button>
            <h2 style={{ fontWeight: 700, marginBottom: 16, fontSize: 18 }}>Loan Details</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
              {[
                ["Borrower", selectedLoan.borrower_name],
                selectedLoan.ministry ? ["Ministry", selectedLoan.ministry] : null,
                ["Laptop", `${selectedLoan.laptop_id} · ${selectedLoan.laptop_name}`],
                ["From", selectedLoan.start_datetime ? fmtDatetime(selectedLoan.start_datetime) : fmtDate(selectedLoan.start_date)],
                ["To", selectedLoan.end_datetime ? fmtDatetime(selectedLoan.end_datetime) : fmtDate(selectedLoan.end_date)],
                ["Reason", selectedLoan.reason],
              ].filter(Boolean).map(([label, value]) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                  <span style={{ color: "var(--text-muted)", flexShrink: 0 }}>{label}</span>
                  <span style={{ fontWeight: 500, textAlign: "right" }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
