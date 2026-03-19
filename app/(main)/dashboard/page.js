"use client";
import { useAuth } from "@/lib/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useToast } from "@/lib/context/ToastContext";
import { supabaseClient } from '@/lib/db/supabaseClient';
import Navbar from "@/components/Navbar";
import CartPanel from "@/components/CartPanel";
import {
  RiArchiveLine,
  RiHandHeartLine,
  RiAlertLine,
  RiTimeLine,
  RiArrowLeftLine,
  RiArrowRightLine,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiCalendarLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiCheckLine,
  RiArrowGoBackLine,
} from "react-icons/ri";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
} from "recharts";

const COLORS = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981"];

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [charts, setCharts] = useState(null);
  const [showCharts, setShowCharts] = useState(false);
  const [activeLoans, setActiveLoans] = useState([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [dueSoonCount, setDueSoonCount] = useState(0);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [error, setError] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);
  const channelRef = useRef(null);

  // User-only state
  const [myLoans, setMyLoans] = useState([]);
  const [myFetching, setMyFetching] = useState(true);
  const [recentActivity, setRecentActivity] = useState([]);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  // Admin: fetch full dashboard
  const fetchDashboard = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/admin", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setStats(data.stats);
        setActiveLoans(data.activeLoans);
        setOverdueCount(data.overdueCount || 0);
        setDueSoonCount(data.dueSoonCount || 0);
        setCharts(data.charts || null);
        setRecentActivity(data.recentActivity || []);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Failed to load dashboard data (${res.status})`);
      }
    } catch (err) {
      setError("Network error — could not load dashboard data");
    }
  }, []);

  // Normal user: fetch own loans
  const fetchMyLoans = useCallback(async () => {
    setMyFetching(true);
    setError("");
    try {
      const res = await fetch("/api/loans", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        setMyLoans(data.loans || []);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to load your loans");
      }
    } catch {
      setError("Network error — could not load your loans");
    } finally {
      setMyFetching(false);
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    if (user.role === "admin") {
      fetchDashboard();
    } else {
      fetchMyLoans();
    }
  }, [user, fetchDashboard, fetchMyLoans]);

  useEffect(() => {
    if (!user) return;
    if (channelRef.current) supabaseClient.removeChannel(channelRef.current);

    const fetch = user.role === "admin" ? fetchDashboard : fetchMyLoans;
    const filter = user.role === "admin"
      ? undefined
      : `user_id=eq.${user.id}`;

    const channelOpts = filter
      ? { event: "*", schema: "public", table: "loan_requests", filter }
      : { event: "*", schema: "public", table: "loan_requests" };

    let channel;
    try {
      channel = supabaseClient
        .channel(`dashboard-${user.id}`)
        .on("postgres_changes", channelOpts, () => { fetch(); })
        .subscribe((_status, err) => {
          if (err) console.warn('Realtime unavailable, using polling fallback:', err.message);
        });
      channelRef.current = channel;
    } catch (err) {
      console.warn('Realtime not available on this device, using polling fallback:', err.message);
    }
    const fallback = setInterval(fetch, 60000);

    return () => {
      if (channel) supabaseClient.removeChannel(channel);
      channelRef.current = null;
      clearInterval(fallback);
    };
  }, [user, fetchDashboard, fetchMyLoans]);

  const handleDeleteLoan = async (loanId) => {
    if (
      !confirm("Delete this loan? Stock will be restored if it was approved.")
    )
      return;
    setDeleteLoading(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loan_id: loanId, action: "delete" }),
      });
      if (res.ok) {
        setSelectedLoan(null);
        // Optimistically remove from local state so it disappears instantly
        setActiveLoans((prev) => prev.filter((l) => l.id !== loanId));
        setMyLoans((prev) => prev.filter((l) => l.id !== loanId));
        // Also refresh from server for accurate stats
        fetchDashboard();
        toast.success("Loan deleted successfully");
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to delete loan");
      }
    } catch {
      toast.error("Network error — could not delete loan");
    } finally {
      setDeleteLoading(false);
    }
  };

  const isAdmin = user?.role === "admin";

  // Build calendar grid with continuous bars (all users)
  const calendarData = useMemo(() => {
    // Admins see all active loans; normal users see only their own (non-permanent)
    const loansForCalendar = isAdmin
      ? activeLoans.filter((l) => l.loan_type !== "permanent")
      : myLoans.filter(
          (l) =>
            l.loan_type !== "permanent" &&
            ["approved", "pending"].includes(l.status),
        );

    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = firstDay.getDay();
    const totalCells = startOffset + lastDay.getDate();
    const totalWeeks = Math.ceil(totalCells / 7);
    const totalDays = totalWeeks * 7;

    const cells = [];
    for (let i = 0; i < totalDays; i++) {
      const dayNum = i - startOffset + 1;
      if (dayNum >= 1 && dayNum <= lastDay.getDate()) {
        cells.push({ day: dayNum, date: new Date(year, month, dayNum) });
      } else {
        cells.push(null);
      }
    }

    const weeks = [];
    for (let w = 0; w < totalWeeks; w++) {
      weeks.push(cells.slice(w * 7, (w + 1) * 7));
    }

    const loanBars = [];
    loansForCalendar.forEach((loan) => {
      const start = new Date(loan.start_date);
      const end = loan.end_date
        ? new Date(loan.end_date)
        : new Date(year, month + 1, 0);

      const monthStart = firstDay;
      const monthEnd = lastDay;
      const clampedStart = start < monthStart ? monthStart : start;
      const clampedEnd = end > monthEnd ? monthEnd : end;

      if (clampedStart > monthEnd || clampedEnd < monthStart) return;

      const startDay = clampedStart.getDate();
      const endDay = clampedEnd.getDate();
      const startCell = startOffset + startDay - 1;
      const endCell = startOffset + endDay - 1;

      const isOverdue =
        loan.status === "approved" &&
        loan.end_date &&
        new Date(loan.end_date) < new Date();

      const startWeek = Math.floor(startCell / 7);
      const endWeek = Math.floor(endCell / 7);

      for (let w = startWeek; w <= endWeek; w++) {
        const segStart = w === startWeek ? startCell % 7 : 0;
        const segEnd = w === endWeek ? endCell % 7 : 6;

        loanBars.push({
          loanId: loan.id,
          week: w,
          startCol: segStart,
          endCol: segEnd,
          label: loan.requester_name,
          type: loan.loan_type,
          status: loan.status,
          isOverdue,
          loan,
        });
      }
    });

    return { weeks, loanBars, totalWeeks };
  }, [calendarMonth, activeLoans, myLoans, isAdmin]);

  if (loading || !user)
    return (
      <div className="loading-spinner">
        <div className="spinner" />
      </div>
    );

  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const prevMonth = () =>
    setCalendarMonth((p) => new Date(p.getFullYear(), p.getMonth() - 1, 1));
  const nextMonth = () =>
    setCalendarMonth((p) => new Date(p.getFullYear(), p.getMonth() + 1, 1));
  const goToday = () => {
    const now = new Date();
    setCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  const isToday = (cell) => {
    if (!cell) return false;
    const today = new Date();
    return (
      cell.day === today.getDate() &&
      calendarMonth.getMonth() === today.getMonth() &&
      calendarMonth.getFullYear() === today.getFullYear()
    );
  };

  const barColor = (bar) => {
    if (bar.isOverdue)
      return {
        bg: "rgba(239,68,68,0.35)",
        color: "#fca5a5",
        border: "#ef4444",
      };
    if (bar.status === "pending")
      return {
        bg: "rgba(245,158,11,0.3)",
        color: "#fde68a",
        border: "#f59e0b",
      };
    return { bg: "rgba(59,130,246,0.3)", color: "#bfdbfe", border: "#3b82f6" };
  };

  const statusBadge = (status) => {
    const map = {
      pending: { cls: "badge-warning", icon: <RiTimeLine />, text: "Pending" },
      approved: {
        cls: "badge-success",
        icon: <RiCheckLine />,
        text: "Approved",
      },
      rejected: { cls: "badge-error", icon: <RiCloseLine />, text: "Rejected" },
      returned: {
        cls: "badge-info",
        icon: <RiArrowGoBackLine />,
        text: "Returned",
      },
    };
    const s = map[status] || { cls: "", text: status };
    return (
      <span className={`badge ${s.cls}`}>
        {s.icon} {s.text}
      </span>
    );
  };

  // ====== NORMAL USER DASHBOARD ======
  if (!isAdmin) {
    const loanedOut = myLoans.filter((l) => l.status === "approved");
    const pending = myLoans.filter((l) => l.status === "pending");

    return (
      <>
        <Navbar />
        <CartPanel />
        <div className="page-container">
          <div className="page-header">
            <h1>My Dashboard</h1>
            <p>Your active loans and pending requests</p>
          </div>

          {error && (
            <div
              style={{
                padding: "12px 16px",
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 12,
                marginBottom: 16,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span style={{ color: "var(--error)", fontSize: 13 }}>
                {error}
              </span>
              <button
                onClick={() => setError("")}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--error)",
                  cursor: "pointer",
                  fontSize: 16,
                  padding: "0 4px",
                }}
              >
                ✕
              </button>
            </div>
          )}

          {myFetching ? (
            <>
              <div className="stats-grid" style={{ marginBottom: 24 }}>
                {[1,2].map((i) => (
                  <div key={i} className="skeleton skeleton-stat" />
                ))}
              </div>
              {[1,2,3].map((i) => (
                <div key={i} className="skeleton skeleton-row" />
              ))}
            </>
          ) : (
            <>
              {/* Summary cards */}
              <div className="stats-grid" style={{ marginBottom: 24 }}>
                <div className="stat-card">
                  <div
                    className="stat-icon"
                    style={{ color: "var(--warning)" }}
                  >
                    <RiHandHeartLine />
                  </div>
                  <div
                    className="stat-value"
                    style={{ color: "var(--warning)" }}
                  >
                    {loanedOut.length}
                  </div>
                  <div className="stat-label">Items Loaned Out</div>
                </div>
                <div className="stat-card">
                  <div className="stat-icon" style={{ color: "var(--info)" }}>
                    <RiTimeLine />
                  </div>
                  <div className="stat-value" style={{ color: "var(--info)" }}>
                    {pending.length}
                  </div>
                  <div className="stat-label">Pending Requests</div>
                </div>
              </div>

              {/* Loaned Out Section */}
              <div style={{ marginBottom: 32 }}>
                <h2
                  style={{
                    fontSize: 16,
                    marginBottom: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <RiHandHeartLine style={{ color: "var(--warning)" }} /> Items
                  Currently Loaned Out
                </h2>
                {loanedOut.length === 0 ? (
                  <div className="empty-state" style={{ padding: 32 }}>
                    <h3>No active loans</h3>
                    <p>You don&apos;t have any items loaned out right now</p>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    {loanedOut.map((loan) => (
                      <div key={loan.id} className="loan-card">
                        <div className="loan-card-header">
                          <div>
                            <span
                              className={`badge ${loan.loan_type === "permanent" ? "badge-permanent" : "badge-temporary"}`}
                              style={{ fontSize: 11 }}
                            >
                              {loan.loan_type === "permanent"
                                ? "📌 Permanent"
                                : "⏱️ Temporary"}
                            </span>
                            <span
                              style={{
                                fontSize: 12,
                                color: "var(--text-muted)",
                                marginLeft: 8,
                              }}
                            >
                              #{loan.id}
                            </span>
                          </div>
                          {statusBadge(loan.status)}
                        </div>
                        <div className="loan-card-items">
                          {loan.items.map((item) => (
                            <span key={item.id} className="loan-item-chip">
                              {item.item} × {item.quantity}
                            </span>
                          ))}
                        </div>
                        <div className="loan-card-meta">
                          <span>📝 {loan.purpose}</span>
                          <span>
                            📅 {loan.start_date}
                            {loan.end_date
                              ? ` → ${loan.end_date}`
                              : " → Ongoing"}
                          </span>
                        </div>
                        {loan.end_date &&
                          new Date(loan.end_date) < new Date() && (
                            <div
                              style={{
                                marginTop: 8,
                                padding: 8,
                                background: "rgba(239,68,68,0.1)",
                                border: "1px solid rgba(239,68,68,0.3)",
                                borderRadius: 8,
                                textAlign: "center",
                                fontSize: 12,
                              }}
                            >
                              <span
                                style={{
                                  color: "var(--error)",
                                  fontWeight: 700,
                                }}
                              >
                                🚨 OVERDUE — Please return items!
                              </span>
                            </div>
                          )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pending Requests Section */}
              <div style={{ marginBottom: 32 }}>
                <h2
                  style={{
                    fontSize: 16,
                    marginBottom: 12,
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <RiTimeLine style={{ color: "var(--info)" }} /> Pending
                  Requests
                </h2>
                {pending.length === 0 ? (
                  <div className="empty-state" style={{ padding: 32 }}>
                    <h3>No pending requests</h3>
                    <p>All your loan requests have been processed</p>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    {pending.map((loan) => (
                      <div key={loan.id} className="loan-card">
                        <div className="loan-card-header">
                          <div>
                            <span
                              className={`badge ${loan.loan_type === "permanent" ? "badge-permanent" : "badge-temporary"}`}
                              style={{ fontSize: 11 }}
                            >
                              {loan.loan_type === "permanent"
                                ? "📌 Permanent"
                                : "⏱️ Temporary"}
                            </span>
                            <span
                              style={{
                                fontSize: 12,
                                color: "var(--text-muted)",
                                marginLeft: 8,
                              }}
                            >
                              #{loan.id}
                            </span>
                          </div>
                          {statusBadge(loan.status)}
                        </div>
                        <div className="loan-card-items">
                          {loan.items.map((item) => (
                            <span key={item.id} className="loan-item-chip">
                              {item.item} × {item.quantity}
                            </span>
                          ))}
                        </div>
                        <div className="loan-card-meta">
                          <span>📝 {loan.purpose}</span>
                          <span>
                            📅 {loan.start_date}
                            {loan.end_date
                              ? ` → ${loan.end_date}`
                              : " → Permanent"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Loan Calendar (user's own loans) */}
              <div className="gantt-container">
                <div className="gantt-header">
                  <h3>
                    <RiCalendarLine style={{ verticalAlign: "middle" }} /> My
                    Loan Calendar — {monthNames[calendarMonth.getMonth()]}{" "}
                    {calendarMonth.getFullYear()}
                  </h3>
                  <div
                    style={{ display: "flex", gap: 8, alignItems: "center" }}
                  >
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={prevMonth}
                    >
                      <RiArrowLeftLine />
                    </button>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={goToday}
                    >
                      Today
                    </button>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={nextMonth}
                    >
                      <RiArrowRightLine />
                    </button>
                  </div>
                </div>

                <div style={{ overflowX: "auto" }}>
                  <div style={{ minWidth: 700 }}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(7, 1fr)",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      {dayNames.map((d) => (
                        <div
                          key={d}
                          style={{
                            padding: "8px 4px",
                            fontSize: 11,
                            fontWeight: 600,
                            color: "var(--text-secondary)",
                            textAlign: "center",
                          }}
                        >
                          {d}
                        </div>
                      ))}
                    </div>
                    {calendarData.weeks.map((week, wi) => {
                      const barsInWeek = calendarData.loanBars.filter(b => b.week === wi).length;
                      const rowHeight = Math.max(90, 28 + barsInWeek * 24 + 8);
                      return (
                      <div
                        key={wi}
                        style={{ position: "relative", minHeight: rowHeight }}
                      >

                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(7, 1fr)",
                            borderBottom: "1px solid var(--border)",
                          }}
                        >
                          {week.map((cell, ci) => (
                            <div
                              key={ci}
                              style={{
                                padding: "6px 8px",
                                minHeight: 80,
                                borderRight:
                                  ci < 6
                                    ? "1px solid rgba(255,255,255,0.03)"
                                    : "none",
                                background:
                                  cell && isToday(cell)
                                    ? "rgba(99,102,241,0.06)"
                                    : "transparent",
                              }}
                            >
                              {cell && (
                                <div
                                  style={{
                                    fontSize: 12,
                                    fontWeight: isToday(cell) ? 700 : 400,
                                    color: isToday(cell)
                                      ? "var(--accent)"
                                      : "var(--text-muted)",
                                    textAlign: "right",
                                  }}
                                >
                                  {isToday(cell) ? (
                                    <span
                                      style={{
                                        background: "var(--accent)",
                                        color: "white",
                                        borderRadius: "50%",
                                        width: 24,
                                        height: 24,
                                        display: "inline-flex",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        fontSize: 12,
                                      }}
                                    >
                                      {cell.day}
                                    </span>
                                  ) : (
                                    cell.day
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                        {calendarData.loanBars
                          .filter((b) => b.week === wi)
                          .map((bar, bi) => {
                            const c = barColor(bar);
                            const leftPct = (bar.startCol / 7) * 100;
                            const widthPct =
                              ((bar.endCol - bar.startCol + 1) / 7) * 100;
                            return (
                              <div
                                key={`${bar.loanId}-${wi}-${bi}`}
                                style={{
                                  position: "absolute",
                                  top: 28 + bi * 24,
                                  left: `calc(${leftPct}% + 4px)`,
                                  width: `calc(${widthPct}% - 8px)`,
                                  height: 20,
                                  background: c.bg,
                                  borderLeft: `3px solid ${c.border}`,
                                  borderRadius: 4,
                                  display: "flex",
                                  alignItems: "center",
                                  padding: "0 6px",
                                  fontSize: 10,
                                  fontWeight: 600,
                                  color: c.color,
                                  overflow: "hidden",
                                  whiteSpace: "nowrap",
                                  textOverflow: "ellipsis",
                                  zIndex: 2,
                                }}
                                title={`#${bar.loanId} — ${bar.loan.purpose}`}
                              >
                                {bar.isOverdue ? "🚨 " : ""}
                                {bar.loan.purpose}
                              </div>
                            );
                          })}
                      </div>
                    );
                    })}
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 16,
                    padding: "12px 0",
                    flexWrap: "wrap",
                    fontSize: 11,
                    color: "var(--text-secondary)",
                  }}
                >
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 3,
                        background: "rgba(59,130,246,0.3)",
                        borderLeft: "3px solid #3b82f6",
                      }}
                    />{" "}
                    Approved
                  </span>
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 3,
                        background: "rgba(245,158,11,0.3)",
                        borderLeft: "3px solid #f59e0b",
                      }}
                    />{" "}
                    Pending
                  </span>
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: 3,
                        background: "rgba(239,68,68,0.35)",
                        borderLeft: "3px solid #ef4444",
                      }}
                    />{" "}
                    Overdue
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </>
    );
  }

  // ====== ADMIN DASHBOARD ======
  return (
    <>
      <Navbar />
      <CartPanel />
      <div className="page-container">
        <div className="page-header">
          <h1>Dashboard</h1>
          <p>Overview of your tech inventory and active loans</p>
        </div>

        {error && (
          <div
            style={{
              padding: "12px 16px",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 12,
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span style={{ color: "var(--error)", fontSize: 13 }}>{error}</span>
            <button
              onClick={() => setError("")}
              style={{
                background: "none",
                border: "none",
                color: "var(--error)",
                cursor: "pointer",
                fontSize: 16,
                padding: "0 4px",
              }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Overdue/Due Soon Alerts */}
        {overdueCount > 0 && (
          <div
            style={{
              padding: "12px 16px",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 12,
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <RiErrorWarningLine
              style={{ color: "var(--error)", fontSize: 24, flexShrink: 0 }}
            />
            <span style={{ fontWeight: 700, color: "var(--error)" }}>
              🚨 {overdueCount} overdue loan(s)!
            </span>
            <span style={{ color: "var(--text-secondary)", fontSize: 13 }}>
              Items past their return date.
            </span>
          </div>
        )}
        {dueSoonCount > 0 && (
          <div
            style={{
              padding: "12px 16px",
              background: "rgba(245,158,11,0.1)",
              border: "1px solid rgba(245,158,11,0.3)",
              borderRadius: 12,
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}
          >
            <RiTimeLine
              style={{ color: "var(--warning)", fontSize: 24, flexShrink: 0 }}
            />
            <span style={{ fontWeight: 700, color: "var(--warning)" }}>
              ⏰ {dueSoonCount} loan(s) due tomorrow
            </span>
          </div>
        )}

        {/* Stats Cards */}
        {!stats && (
          <div className="stats-grid">
            {[1,2,3,4,5].map((i) => (
              <div key={i} className="skeleton skeleton-stat" />
            ))}
          </div>
        )}
        {stats && (
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon" style={{ color: "var(--accent)" }}>
                <RiArchiveLine />
              </div>
              <div className="stat-value" style={{ color: "var(--accent)" }}>
                {stats.totalCurrent}
              </div>
              <div className="stat-label">Items Available</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ color: "var(--warning)" }}>
                <RiHandHeartLine />
              </div>
              <div className="stat-value" style={{ color: "var(--warning)" }}>
                {stats.totalLoaned}
              </div>
              <div className="stat-label">Items Loaned Out</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ color: "var(--info)" }}>
                <RiTimeLine />
              </div>
              <div className="stat-value" style={{ color: "var(--info)" }}>
                {stats.pendingRequests}
              </div>
              <div className="stat-label">Pending Requests</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ color: "var(--error)" }}>
                <RiAlertLine />
              </div>
              <div className="stat-value" style={{ color: "var(--error)" }}>
                {stats.lowStock}
              </div>
              <div className="stat-label">Low in Stock</div>
            </div>
            <div className="stat-card">
              <div className="stat-icon" style={{ color: "var(--success)" }}>
                <RiCheckboxCircleLine />
              </div>
              <div className="stat-value" style={{ color: "var(--success)" }}>
                {stats.deployedItems}
              </div>
              <div className="stat-label">Deployed Items</div>
            </div>
          </div>
        )}

        {/* Analytics Charts */}
        {charts && (
          <div style={{ marginTop: 24, marginBottom: 32 }}>
            <button
              onClick={() => setShowCharts((p) => !p)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                background: "rgba(99,102,241,0.08)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "8px 16px",
                color: "var(--text-primary)",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "inherit",
                width: "100%",
                justifyContent: "center",
                transition: "var(--transition)",
              }}
            >
              {showCharts ? "▲ Hide Analytics" : "▼ Show Analytics"}
            </button>
            {showCharts && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))",
                  gap: 20,
                  marginTop: 16,
                }}
              >
            <div className="admin-chart-card" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, outline: "none" }}>
              <h3 style={{ fontSize: 16, marginBottom: 16 }}>Top 5 Borrowed Items</h3>
              <div style={{ width: "100%", height: 300 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie
                      data={charts.topItems}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      fill="#8884d8"
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, percent }) =>
                        `${name} ${(percent * 100).toFixed(0)}%`
                      }
                      labelLine={false}
                      fontSize={10}
                    >
                      {charts.topItems.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        background: "var(--bg-card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        color: "white",
                        fontSize: 12,
                        padding: "6px 10px",
                      }}
                      itemStyle={{ color: "white", fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="admin-chart-card" style={{ background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, outline: "none" }}>
              <h3 style={{ fontSize: 16, marginBottom: 16 }}>Storage vs Deployed</h3>
              <div style={{ width: "100%", height: 300 }}>
                <ResponsiveContainer>
                  <BarChart data={charts.inventoryDistribution} margin={{ top: 25, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff1a" />
                    <XAxis
                      dataKey="name"
                      stroke="var(--text-muted)"
                      tick={{ fontSize: 12 }}
                      tickMargin={10}
                    />
                    <YAxis
                      stroke="var(--text-muted)"
                      tick={{ fontSize: 12 }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--bg-card)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        color: "white",
                      }}
                      itemStyle={{ color: "white" }}
                      cursor={{ fill: "rgba(255,255,255,0.05)" }}
                    />
                    <Bar
                      dataKey="value"
                      name="Count"
                      radius={[6, 6, 0, 0]}
                      label={{ fill: "white", fontSize: 13, fontWeight: "bold", position: "top" }}
                    >
                      {charts.inventoryDistribution.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
            )}
          </div>
        )}

        {/* Activity Feed */}
        {recentActivity.length > 0 && (
          <div className="activity-feed">
            <h3 style={{ fontSize: 16, marginBottom: 12 }}>Recent Activity</h3>
            {recentActivity.map((a) => (
              <div
                key={a.id}
                className="activity-item"
                onClick={() => {
                  if (!a.link || a.link.startsWith("http")) return;
                  router.push(a.link);
                }}
                style={a.link && !a.link.startsWith("http") ? { cursor: "pointer" } : undefined}
              >
                <div className={`activity-dot ${a.action}`} />
                <div style={{ flex: 1 }}>
                  <div style={{ color: "var(--text-primary)" }}>
                    {a.description}
                  </div>
                  <div className="activity-time">
                    {new Date(a.created_at).toLocaleString()}
                    {a.link && !a.link.startsWith("http") && <span style={{ marginLeft: 6, opacity: 0.5, fontSize: 10 }}>↗</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Google Calendar-style Grid */}
        <div className="gantt-container">
          <div className="gantt-header">
            <h3>
              <RiCalendarLine style={{ verticalAlign: "middle" }} /> Loan
              Calendar — {monthNames[calendarMonth.getMonth()]}{" "}
              {calendarMonth.getFullYear()}
            </h3>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="btn btn-sm btn-outline" onClick={prevMonth}>
                <RiArrowLeftLine />
              </button>
              <button className="btn btn-sm btn-outline" onClick={goToday}>
                Today
              </button>
              <button className="btn btn-sm btn-outline" onClick={nextMonth}>
                <RiArrowRightLine />
              </button>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 700 }}>
              {/* Day headers */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(7, 1fr)",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                {dayNames.map((d) => (
                  <div
                    key={d}
                    style={{
                      padding: "8px 4px",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--text-secondary)",
                      textAlign: "center",
                    }}
                  >
                    {d}
                  </div>
                ))}
              </div>

              {/* Week rows with loan bars */}
              {calendarData.weeks.map((week, wi) => {
                const barsInWeek = calendarData.loanBars.filter(b => b.week === wi).length;
                const rowHeight = Math.max(90, 28 + barsInWeek * 24 + 8);
                return (
                <div key={wi} style={{ position: "relative", minHeight: rowHeight }}>
                  {/* Date cells */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(7, 1fr)",
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    {week.map((cell, ci) => (
                      <div
                        key={ci}
                        style={{
                          padding: "6px 8px",
                          minHeight: 80,
                          borderRight:
                            ci < 6
                              ? "1px solid rgba(255,255,255,0.03)"
                              : "none",
                          background:
                            cell && isToday(cell)
                              ? "rgba(99,102,241,0.06)"
                              : "transparent",
                        }}
                      >
                        {cell && (
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: isToday(cell) ? 700 : 400,
                              color: isToday(cell)
                                ? "var(--accent)"
                                : "var(--text-muted)",
                              textAlign: "right",
                            }}
                          >
                            {isToday(cell) ? (
                              <span
                                style={{
                                  background: "var(--accent)",
                                  color: "white",
                                  borderRadius: "50%",
                                  width: 24,
                                  height: 24,
                                  display: "inline-flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: 12,
                                }}
                              >
                                {cell.day}
                              </span>
                            ) : (
                              cell.day
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Loan bars overlaid on the week row */}
                  {calendarData.loanBars
                    .filter((b) => b.week === wi)
                    .map((bar, bi) => {
                      const c = barColor(bar);
                      const leftPct = (bar.startCol / 7) * 100;
                      const widthPct =
                        ((bar.endCol - bar.startCol + 1) / 7) * 100;

                      return (
                        <div
                          key={`${bar.loanId}-${wi}-${bi}`}
                          onClick={() => setSelectedLoan(bar.loan)}
                          style={{
                            position: "absolute",
                            top: 28 + bi * 24,
                            left: `calc(${leftPct}% + 4px)`,
                            width: `calc(${widthPct}% - 8px)`,
                            height: 20,
                            background: c.bg,
                            borderLeft: `3px solid ${c.border}`,
                            borderRadius: 4,
                            display: "flex",
                            alignItems: "center",
                            padding: "0 6px",
                            fontSize: 10,
                            fontWeight: 600,
                            color: c.color,
                            cursor: "pointer",
                            overflow: "hidden",
                            whiteSpace: "nowrap",
                            textOverflow: "ellipsis",
                            transition: "opacity 0.15s",
                            zIndex: 2,
                          }}
                          title={`${bar.label} — Click for details`}
                        >
                          {bar.isOverdue ? "🚨 " : ""}
                          {bar.label}
                        </div>
                      );
                    })}
                </div>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div
            style={{
              display: "flex",
              gap: 16,
              padding: "12px 0",
              flexWrap: "wrap",
              fontSize: 11,
              color: "var(--text-secondary)",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: "rgba(59,130,246,0.3)",
                  borderLeft: "3px solid #3b82f6",
                }}
              />{" "}
              Temporary
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: "rgba(245,158,11,0.3)",
                  borderLeft: "3px solid #f59e0b",
                }}
              />{" "}
              Pending
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: 3,
                  background: "rgba(239,68,68,0.35)",
                  borderLeft: "3px solid #ef4444",
                }}
              />{" "}
              Overdue
            </span>
          </div>
        </div>
      </div>

      {/* Loan Detail Modal */}
      {selectedLoan && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            backdropFilter: "blur(4px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: 20,
          }}
          onClick={() => setSelectedLoan(null)}
        >
          <div
            style={{
              background: "var(--bg-card)",
              borderRadius: 16,
              border: "1px solid var(--border)",
              maxWidth: 480,
              width: "100%",
              padding: 28,
              boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 20,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 18 }}>📋 Loan Details</h3>
              <button
                onClick={() => setSelectedLoan(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 20,
                }}
              >
                <RiCloseLine />
              </button>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: 20,
                padding: 16,
                background: "rgba(99,102,241,0.05)",
                borderRadius: 12,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, var(--accent), #818cf8)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  fontWeight: 700,
                  color: "white",
                }}
              >
                {selectedLoan.requester_name[0].toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 16 }}>
                  {selectedLoan.requester_name}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  @{selectedLoan.requester_username}
                </div>
              </div>
              <div style={{ marginLeft: "auto" }}>
                <span
                  className={`badge ${selectedLoan.loan_type === "permanent" ? "badge-permanent" : "badge-temporary"}`}
                  style={{ fontSize: 11 }}
                >
                  {selectedLoan.loan_type === "permanent"
                    ? "📌 Permanent"
                    : "⏱️ Temporary"}
                </span>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text-secondary)",
                  marginBottom: 8,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                Items Borrowed
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {selectedLoan.items.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "8px 12px",
                      background: "rgba(255,255,255,0.03)",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{item.item}</span>
                    <span style={{ color: "var(--accent)", fontWeight: 600 }}>
                      × {item.quantity}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                fontSize: 13,
              }}
            >
              <div>
                <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                  Purpose
                </span>
                <div style={{ fontWeight: 500, marginTop: 2 }}>
                  {selectedLoan.purpose}
                </div>
              </div>
              {selectedLoan.department && (
                <div>
                  <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                    Department
                  </span>
                  <div style={{ fontWeight: 500, marginTop: 2 }}>
                    {selectedLoan.department}
                  </div>
                </div>
              )}
              <div>
                <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                  Start Date
                </span>
                <div style={{ fontWeight: 500, marginTop: 2 }}>
                  {selectedLoan.start_date}
                </div>
              </div>
              <div>
                <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                  End Date
                </span>
                <div style={{ fontWeight: 500, marginTop: 2 }}>
                  {selectedLoan.end_date || "Ongoing"}
                </div>
              </div>
            </div>

            {selectedLoan.status === "approved" &&
              selectedLoan.end_date &&
              new Date(selectedLoan.end_date) < new Date() && (
                <div
                  style={{
                    marginTop: 16,
                    padding: 12,
                    background: "rgba(239,68,68,0.1)",
                    border: "1px solid rgba(239,68,68,0.3)",
                    borderRadius: 8,
                    textAlign: "center",
                  }}
                >
                  <span style={{ color: "var(--error)", fontWeight: 700 }}>
                    🚨 This loan is OVERDUE!
                  </span>
                </div>
              )}

            <div
              style={{
                marginTop: 20,
                paddingTop: 16,
                borderTop: "1px solid var(--border)",
                display: "flex",
                justifyContent: "flex-end",
              }}
            >
              <button
                disabled={deleteLoading}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "8px 16px",
                  background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 8,
                  color: "var(--error)",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                }}
                onClick={() => handleDeleteLoan(selectedLoan.id)}
              >
                <RiDeleteBinLine />{" "}
                {deleteLoading ? "Deleting..." : "Delete Loan"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
