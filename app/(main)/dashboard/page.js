"use client";
import { useAuth } from "@/lib/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState, useMemo, useRef, useCallback } from "react";
import { useToast } from "@/lib/context/ToastContext";
import { supabaseClient } from "@/lib/db/supabaseClient";
import Navbar from "@/components/Navbar";
import CartPanel from "@/components/CartPanel";
import AppShellLoading from "@/components/AppShellLoading";
import LoanCalendar from "@/components/LoanCalendar";
import {
  RiArchiveLine,
  RiHandHeartLine,
  RiAlertLine,
  RiTimeLine,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiCheckLine,
  RiArrowGoBackLine,
} from "react-icons/ri";
import {} from // recharts is loaded dynamically below — no static import
"recharts";

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
  const [showClearActivityConfirm, setShowClearActivityConfirm] =
    useState(false);
  const [clearActivityLoading, setClearActivityLoading] = useState(false);
  const [rc, setRc] = useState(null);
  const channelRef = useRef(null);

  // User-only state
  const [myLoans, setMyLoans] = useState([]);
  const [myFetching, setMyFetching] = useState(true);
  const [recentActivity, setRecentActivity] = useState([]);
  const [allActiveLoans, setAllActiveLoans] = useState([]);
  const [calendarTypeFilter, setCalendarTypeFilter] = useState("my"); // 'my' | 'all' | 'tech' | 'laptop'
  const [isMobile, setIsMobile] = useState(false);

  // Mobile detection for compact calendar layout
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    setIsMobile(mq.matches);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Defer recharts (~400 KB) — load after mount so it doesn't block initial render
  useEffect(() => {
    import("recharts").then(setRc);
  }, []);

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

  // Normal user: fetch all active loans (team visibility) — tech + laptop
  const fetchAllActiveLoans = useCallback(async () => {
    try {
      const [techRes, laptopRes] = await Promise.all([
        fetch("/api/loans?view=active", { cache: "no-store" }),
        fetch("/api/laptop-loans?view=active", { cache: "no-store" }),
      ]);
      const techData = techRes.ok ? await techRes.json() : { loans: [] };
      const laptopData = laptopRes.ok ? await laptopRes.json() : { loans: [] };

      const techLoans = (techData.loans || []).map((l) => ({
        ...l,
        _loanKind: "tech",
      }));
      const laptopLoans = (laptopData.loans || []).map((l) => ({
        ...l,
        _loanKind: "laptop",
        items: (l.laptops || []).map((item) => ({
          id: item.id,
          item: item.laptops?.name || "Unknown laptop",
          quantity: 1,
        })),
      }));

      setAllActiveLoans([...techLoans, ...laptopLoans]);
    } catch {
      /* silent */
    }
  }, []);

  // Normal user: fetch own loans (tech + laptop merged)
  const fetchMyLoans = useCallback(async () => {
    setMyFetching(true);
    setError("");
    try {
      const [techRes, laptopRes] = await Promise.all([
        fetch("/api/loans", { cache: "no-store" }),
        fetch("/api/laptop-loans?view=my", { cache: "no-store" }),
      ]);
      const techData = techRes.ok ? await techRes.json() : { loans: [] };
      const laptopData = laptopRes.ok ? await laptopRes.json() : { loans: [] };

      const techLoans = (techData.loans || []).map((l) => ({
        ...l,
        _loanKind: "tech",
      }));
      const laptopLoans = (laptopData.loans || []).map((l) => ({
        ...l,
        _loanKind: "laptop",
        items: (l.laptops || []).map((item) => ({
          id: item.id,
          item: item.laptops?.name || "Unknown laptop",
          quantity: 1,
        })),
      }));

      const merged = [...techLoans, ...laptopLoans].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
      );
      setMyLoans(merged);

      if (!techRes.ok) {
        const d = await techRes.json().catch(() => ({}));
        setError(d.error || "Failed to load your loans");
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
      fetchAllActiveLoans();
    }
  }, [user, fetchDashboard, fetchMyLoans, fetchAllActiveLoans]);

  useEffect(() => {
    if (!user) return;
    if (channelRef.current) supabaseClient.removeChannel(channelRef.current);

    const fetch =
      user.role === "admin"
        ? fetchDashboard
        : () => {
            fetchMyLoans();
            fetchAllActiveLoans();
          };
    const filter = user.role === "admin" ? undefined : `user_id=eq.${user.id}`;

    const channelOpts = filter
      ? { event: "*", schema: "public", table: "loan_requests", filter }
      : { event: "*", schema: "public", table: "loan_requests" };

    let channel;
    try {
      channel = supabaseClient
        .channel(`dashboard-${user.id}`)
        .on("postgres_changes", channelOpts, () => {
          fetch();
        })
        .subscribe((_status, err) => {
          if (err)
            console.warn(
              "Realtime unavailable, using polling fallback:",
              err.message,
            );
        });
      channelRef.current = channel;
    } catch (err) {
      console.warn(
        "Realtime not available on this device, using polling fallback:",
        err.message,
      );
    }
    const fallback = setInterval(fetch, 60000);

    return () => {
      if (channel) supabaseClient.removeChannel(channel);
      channelRef.current = null;
      clearInterval(fallback);
    };
  }, [user, fetchDashboard, fetchMyLoans, fetchAllActiveLoans]);

  const handleClearActivity = async () => {
    setClearActivityLoading(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear_activity" }),
      });
      if (res.ok) {
        setRecentActivity([]);
        setShowClearActivityConfirm(false);
        toast.success("Activity log cleared");
      } else {
        toast.error("Failed to clear activity log");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setClearActivityLoading(false);
    }
  };

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
    // Admins see all active loans; normal users see based on toggle
    const loansForCalendar = isAdmin
      ? activeLoans.filter((l) => {
          if (l.loan_type === "permanent") return false;
          if (calendarTypeFilter === "my") return l.user_id === user?.id;
          if (calendarTypeFilter === "tech") return l._loanKind !== "laptop";
          if (calendarTypeFilter === "laptop") return l._loanKind === "laptop";
          return true; // "all"
        })
      : allActiveLoans.filter((l) => {
          if (l.loan_type === "permanent") return false;
          const isOwn = l.user_id === user?.id;
          if (calendarTypeFilter === "my") return isOwn;
          if (calendarTypeFilter === "tech") return l._loanKind !== "laptop";
          if (calendarTypeFilter === "laptop") return l._loanKind === "laptop";
          // "all": own loans (all statuses) + others' approved non-overdue only
          if (isOwn) return true;
          const isOverdue =
            l.status === "approved" &&
            l.end_date &&
            new Date(l.end_date) < new Date();
          return l.status === "approved" && !isOverdue;
        });

    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = (firstDay.getDay() + 6) % 7;
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
          isOwn: !isAdmin && loan.user_id === user?.id,
          loan,
        });
      }
    });

    return { weeks, loanBars, totalWeeks };
  }, [
    calendarMonth,
    activeLoans,
    allActiveLoans,
    isAdmin,
    user,
    calendarTypeFilter,
  ]);

  if (loading || !user) return <AppShellLoading />;

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
    // For non-admin: green = own loan, indigo = others' loan
    if (bar.isOwn)
      return {
        bg: "rgba(16,185,129,0.3)",
        color: "#6ee7b7",
        border: "#10b981",
      };
    if (!isAdmin)
      return {
        bg: "rgba(59,130,246,0.3)",
        color: "#93c5fd",
        border: "#3b82f6",
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
    const today = new Date().toISOString().split("T")[0];
    const in3Days = new Date();
    in3Days.setDate(in3Days.getDate() + 3);
    const in3DaysStr = in3Days.toISOString().split("T")[0];
    const loanedOut = myLoans.filter((l) => l.status === "approved");
    const pending = myLoans.filter((l) => l.status === "pending");
    const overdueMyLoans = myLoans.filter(
      (l) =>
        l.status === "approved" &&
        l.loan_type === "temporary" &&
        l.end_date &&
        l.end_date < today,
    );
    const dueSoonMyLoans = myLoans.filter(
      (l) =>
        l.status === "approved" &&
        l.loan_type === "temporary" &&
        l.end_date &&
        l.end_date >= today &&
        l.end_date <= in3DaysStr,
    );
    const userCalendarLegend = [
      {
        label: "My Loans",
        background: "rgba(16,185,129,0.3)",
        border: "#10b981",
      },
      ...(calendarTypeFilter !== "my"
        ? [
            {
              label: "Others",
              background: "rgba(59,130,246,0.3)",
              border: "#3b82f6",
            },
          ]
        : []),
      {
        label: "Pending",
        background: "rgba(245,158,11,0.3)",
        border: "#f59e0b",
      },
      {
        label: "Overdue",
        background: "rgba(239,68,68,0.35)",
        border: "#ef4444",
      },
    ];

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

          {overdueMyLoans.length > 0 && (
            <div
              style={{
                marginBottom: 20,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {overdueMyLoans.map((loan) => {
                const laptopNames =
                  loan._loanKind === "laptop"
                    ? (loan.items || []).map((i) => i.item).join(", ")
                    : (loan.items || [])
                        .map((i) => `${i.item} ×${i.quantity}`)
                        .join(", ");
                return (
                  <div
                    key={`overdue-${loan._loanKind}-${loan.id}`}
                    style={{
                      padding: "12px 16px",
                      background: "rgba(239,68,68,0.1)",
                      border: "1.5px solid rgba(239,68,68,0.4)",
                      borderRadius: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10 }}
                    >
                      <RiAlertLine
                        style={{
                          color: "#ef4444",
                          fontSize: 20,
                          flexShrink: 0,
                        }}
                      />
                      <div>
                        <div
                          style={{
                            fontWeight: 700,
                            fontSize: 13,
                            color: "#ef4444",
                          }}
                        >
                          Overdue —{" "}
                          {loan._loanKind === "laptop"
                            ? "Laptop Loan"
                            : "Tech Loan"}{" "}
                          #{loan.id}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: "var(--text-secondary)",
                            marginTop: 2,
                          }}
                        >
                          Was due <strong>{loan.end_date}</strong>
                          {laptopNames && <span> · {laptopNames}</span>}
                        </div>
                      </div>
                    </div>
                    <button
                      className="btn btn-sm"
                      onClick={() => router.push("/loans")}
                      style={{
                        background: "rgba(239,68,68,0.2)",
                        border: "1px solid rgba(239,68,68,0.4)",
                        color: "#ef4444",
                        flexShrink: 0,
                      }}
                    >
                      Return Now
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {myFetching ? (
            <>
              <div
                className="stats-grid dashboard-stats-grid"
                style={{ marginBottom: 24 }}
              >
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton skeleton-stat" />
                ))}
              </div>
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton skeleton-row" />
              ))}
            </>
          ) : (
            <>
              {/* Stats row */}
              <div
                className="stats-grid dashboard-stats-grid"
                style={{ marginBottom: 24 }}
              >
                <div className="stat-card dashboard-stat-card">
                  <div className="stat-icon" style={{ color: "#10b981" }}>
                    <RiHandHeartLine />
                  </div>
                  <div className="stat-value" style={{ color: "#10b981" }}>
                    {loanedOut.length}
                  </div>
                  <div className="stat-label">My Current Loans</div>
                </div>
                <div className="stat-card dashboard-stat-card">
                  <div className="stat-icon" style={{ color: "var(--info)" }}>
                    <RiTimeLine />
                  </div>
                  <div className="stat-value" style={{ color: "var(--info)" }}>
                    {pending.length}
                  </div>
                  <div className="stat-label">My Pending Requests</div>
                </div>
                <div className="stat-card dashboard-stat-card">
                  <div className="stat-icon" style={{ color: "var(--error)" }}>
                    <RiAlertLine />
                  </div>
                  <div className="stat-value" style={{ color: "var(--error)" }}>
                    {overdueMyLoans.length}
                  </div>
                  <div className="stat-label">My Overdues</div>
                </div>
                {dueSoonMyLoans.length > 0 && (
                  <div className="stat-card dashboard-stat-card">
                    <div
                      className="stat-icon"
                      style={{ color: "var(--warning)" }}
                    >
                      <RiTimeLine />
                    </div>
                    <div
                      className="stat-value"
                      style={{ color: "var(--warning)" }}
                    >
                      {dueSoonMyLoans.length}
                    </div>
                    <div className="stat-label">Due in 3 Days</div>
                  </div>
                )}
              </div>

              {/* Unified My Loans list */}
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
                  <RiHandHeartLine style={{ color: "#10b981" }} /> My Loans
                </h2>
                {[...loanedOut, ...pending].length === 0 ? (
                  <div className="empty-state" style={{ padding: 32 }}>
                    <h3>No active loans</h3>
                    <p>You don&apos;t have any loans right now</p>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    {[...loanedOut, ...pending]
                      .sort(
                        (a, b) =>
                          new Date(b.created_at) - new Date(a.created_at),
                      )
                      .map((loan) => {
                        const isOverdue =
                          loan.status === "approved" &&
                          loan.loan_type === "temporary" &&
                          loan.end_date &&
                          loan.end_date < today;
                        const accentColor = isOverdue
                          ? "#ef4444"
                          : loan.status === "pending"
                            ? "#f59e0b"
                            : "#10b981";
                        return (
                          <div
                            key={`${loan._loanKind}-${loan.id}`}
                            style={{
                              background: "var(--bg-card)",
                              border: "1px solid var(--border)",
                              borderLeft: `4px solid ${accentColor}`,
                              borderRadius: 14,
                              overflow: "hidden",
                            }}
                          >
                            <div
                              style={{
                                padding: "12px 16px 10px",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "flex-start",
                                gap: 8,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 5,
                                  alignItems: "center",
                                }}
                              >
                                <span
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 3,
                                    fontSize: 10,
                                    fontWeight: 700,
                                    padding: "2px 7px",
                                    borderRadius: 5,
                                    background:
                                      loan._loanKind === "laptop"
                                        ? "rgba(99,102,241,0.12)"
                                        : "rgba(100,116,139,0.12)",
                                    color:
                                      loan._loanKind === "laptop"
                                        ? "var(--accent)"
                                        : "var(--text-secondary)",
                                    border: `1px solid ${loan._loanKind === "laptop" ? "rgba(99,102,241,0.3)" : "rgba(100,116,139,0.2)"}`,
                                    textTransform: "uppercase",
                                    letterSpacing: 0.5,
                                  }}
                                >
                                  {loan._loanKind === "laptop"
                                    ? "💻 Laptop"
                                    : "📦 Tech"}
                                </span>
                                <span
                                  className={`badge ${loan.loan_type === "permanent" ? "badge-permanent" : "badge-temporary"}`}
                                  style={{ fontSize: 11 }}
                                >
                                  {loan.loan_type === "permanent"
                                    ? "📌 Permanent"
                                    : "⏱️ Temporary"}
                                </span>
                                {isOverdue && (
                                  <span
                                    className="badge badge-error"
                                    style={{ fontSize: 10 }}
                                  >
                                    🚨 Overdue
                                  </span>
                                )}
                              </div>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  flexShrink: 0,
                                }}
                              >
                                {statusBadge(loan.status)}
                                <span
                                  style={{
                                    fontSize: 11,
                                    color: "var(--text-muted)",
                                  }}
                                >
                                  #{loan.id}
                                </span>
                              </div>
                            </div>
                            <div
                              style={{
                                padding: "0 16px 10px",
                                display: "flex",
                                flexWrap: "wrap",
                                gap: 6,
                              }}
                            >
                              {loan.items.map((item) => (
                                <span key={item.id} className="loan-item-chip">
                                  {item.item}
                                  {loan._loanKind !== "laptop"
                                    ? ` × ${item.quantity}`
                                    : ""}
                                </span>
                              ))}
                            </div>
                            <div
                              style={{
                                padding: "8px 16px",
                                borderTop: "1px solid var(--border)",
                                background: "rgba(255,255,255,0.015)",
                                display: "flex",
                                gap: 14,
                                fontSize: 12,
                                color: "var(--text-muted)",
                                flexWrap: "wrap",
                              }}
                            >
                              {loan.purpose && <span>📝 {loan.purpose}</span>}
                              {loan.department && (
                                <span>🏢 {loan.department}</span>
                              )}
                              <span>
                                📅 {loan.start_date}
                                {loan.end_date
                                  ? ` → ${loan.end_date}`
                                  : " → Ongoing"}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              <LoanCalendar
                isMobile={isMobile}
                calendarMonth={calendarMonth}
                typeFilter={calendarTypeFilter}
                onTypeFilterChange={setCalendarTypeFilter}
                prevMonth={prevMonth}
                nextMonth={nextMonth}
                goToday={goToday}
                calendarData={calendarData}
                isToday={isToday}
                barColor={barColor}
                onSelectLoan={setSelectedLoan}
                legendItems={userCalendarLegend}
              />
            </>
          )}
        </div>

        {/* Loan detail modal — shown when a calendar bar is clicked */}
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
                    background:
                      "linear-gradient(135deg, var(--accent), #818cf8)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                    fontWeight: 700,
                    color: "white",
                  }}
                >
                  {(selectedLoan.requester_name ||
                    selectedLoan.requester_username ||
                    "?")[0].toUpperCase()}
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
                <div
                  style={{ display: "flex", flexDirection: "column", gap: 6 }}
                >
                  {(selectedLoan.items || []).map((item) => (
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
                    {selectedLoan.purpose || "—"}
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
            </div>
          </div>
        )}
      </>
    );
  }

  // ====== ADMIN DASHBOARD ======
  // Destructure recharts components from the lazily loaded module (null until loaded)
  const {
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Tooltip,
    BarChart,
    CartesianGrid,
    XAxis,
    YAxis,
    Bar,
  } = rc || {};

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
          <div className="stats-grid dashboard-stats-grid">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="skeleton skeleton-stat" />
            ))}
          </div>
        )}
        {stats && (
          <div className="stats-grid dashboard-stats-grid">
            <div className="stat-card dashboard-stat-card">
              <div className="stat-icon" style={{ color: "var(--accent)" }}>
                <RiArchiveLine />
              </div>
              <div className="stat-value" style={{ color: "var(--accent)" }}>
                {stats.totalCurrent}
              </div>
              <div className="stat-label">Items Available</div>
            </div>
            <div className="stat-card dashboard-stat-card">
              <div className="stat-icon" style={{ color: "var(--warning)" }}>
                <RiHandHeartLine />
              </div>
              <div className="stat-value" style={{ color: "var(--warning)" }}>
                {stats.totalLoaned}
              </div>
              <div className="stat-label">Items Loaned Out</div>
            </div>
            <div className="stat-card dashboard-stat-card">
              <div className="stat-icon" style={{ color: "var(--info)" }}>
                <RiTimeLine />
              </div>
              <div className="stat-value" style={{ color: "var(--info)" }}>
                {stats.pendingRequests}
              </div>
              <div className="stat-label">Pending Requests</div>
            </div>
            <div className="stat-card dashboard-stat-card">
              <div className="stat-icon" style={{ color: "var(--error)" }}>
                <RiAlertLine />
              </div>
              <div className="stat-value" style={{ color: "var(--error)" }}>
                {stats.lowStock}
              </div>
              <div className="stat-label">Low in Stock</div>
            </div>
            <div className="stat-card dashboard-stat-card">
              <div className="stat-icon" style={{ color: "var(--success)" }}>
                <RiCheckboxCircleLine />
              </div>
              <div className="stat-value" style={{ color: "var(--success)" }}>
                {stats.deployedItems}
              </div>
              <div className="stat-label">Deployed Items</div>
            </div>
            {stats.laptopActive > 0 || stats.laptopPending > 0 ? (
              <div className="stat-card dashboard-stat-card">
                <div className="stat-icon" style={{ color: "#10b981" }}>
                  💻
                </div>
                <div className="stat-value" style={{ color: "#10b981" }}>
                  {stats.laptopActive}
                </div>
                <div className="stat-label">Active Laptop Loans</div>
                {stats.laptopPending > 0 && (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--warning)",
                      marginTop: 4,
                    }}
                  >
                    {stats.laptopPending} pending
                  </div>
                )}
              </div>
            ) : null}
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
            {showCharts && rc && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))",
                  gap: 20,
                  marginTop: 16,
                }}
              >
                <div
                  className="admin-chart-card"
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 20,
                    outline: "none",
                  }}
                >
                  <h3 style={{ fontSize: 16, marginBottom: 16 }}>
                    Top 5 Borrowed Items
                  </h3>
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

                <div
                  className="admin-chart-card"
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: 20,
                    outline: "none",
                  }}
                >
                  <h3 style={{ fontSize: 16, marginBottom: 16 }}>
                    Storage vs Deployed
                  </h3>
                  <div style={{ width: "100%", height: 300 }}>
                    <ResponsiveContainer>
                      <BarChart
                        data={charts.inventoryDistribution}
                        margin={{ top: 25, right: 10, left: 10, bottom: 5 }}
                      >
                        <CartesianGrid
                          strokeDasharray="3 3"
                          stroke="#ffffff1a"
                        />
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
                          label={{
                            fill: "white",
                            fontSize: 13,
                            fontWeight: "bold",
                            position: "top",
                          }}
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

        {/* Clear Activity Confirmation Modal */}
        {showClearActivityConfirm && (
          <div className="modal-overlay">
            <div className="modal" style={{ maxWidth: 420 }}>
              <div className="modal-body">
                <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 18 }}>
                  Clear Activity Log?
                </h3>
                <p
                  style={{
                    color: "var(--text-muted)",
                    fontSize: 14,
                    marginBottom: 0,
                  }}
                >
                  This will permanently delete all activity records for
                  everyone. This cannot be undone.
                </p>
              </div>
              <div className="modal-footer">
                <button
                  className="btn btn-outline"
                  onClick={() => setShowClearActivityConfirm(false)}
                  disabled={clearActivityLoading}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-danger"
                  onClick={handleClearActivity}
                  disabled={clearActivityLoading}
                >
                  {clearActivityLoading ? (
                    <>
                      <span className="btn-spinner" /> Clearing…
                    </>
                  ) : (
                    "Yes, clear all"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Activity Feed */}
        {recentActivity.length > 0 && (
          <div className="activity-feed" style={{ marginBottom: 24 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
                gap: 8,
              }}
            >
              <h3 style={{ fontSize: 16, margin: 0 }}>Recent Activity</h3>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => setShowClearActivityConfirm(true)}
                style={{
                  color: "var(--error)",
                  borderColor: "var(--error)",
                  border: "1px solid var(--error)",
                  fontSize: 12,
                  padding: "4px 10px",
                  flexShrink: 0,
                }}
              >
                Clear all
              </button>
            </div>
            {recentActivity.map((a) => (
              <div
                key={a.id}
                className="activity-item"
                onClick={() => {
                  if (!a.link || a.link.startsWith("http")) return;
                  router.push(a.link);
                }}
                style={
                  a.link && !a.link.startsWith("http")
                    ? { cursor: "pointer" }
                    : undefined
                }
              >
                <div className={`activity-dot ${a.action}`} />
                <div style={{ flex: 1 }}>
                  <div style={{ color: "var(--text-primary)" }}>
                    {a.description}
                  </div>
                  <div className="activity-time">
                    {new Date(a.created_at).toLocaleString()}
                    {a.link && !a.link.startsWith("http") && (
                      <span
                        style={{ marginLeft: 6, opacity: 0.5, fontSize: 10 }}
                      >
                        ↗
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <LoanCalendar
          isMobile={isMobile}
          calendarMonth={calendarMonth}
          typeFilter={calendarTypeFilter}
          onTypeFilterChange={setCalendarTypeFilter}
          prevMonth={prevMonth}
          nextMonth={nextMonth}
          goToday={goToday}
          calendarData={calendarData}
          isToday={isToday}
          barColor={barColor}
          onSelectLoan={setSelectedLoan}
          legendItems={[
            {
              label: "Temporary",
              background: "rgba(59,130,246,0.3)",
              border: "#3b82f6",
            },
            {
              label: "Pending",
              background: "rgba(245,158,11,0.3)",
              border: "#f59e0b",
            },
            {
              label: "Overdue",
              background: "rgba(239,68,68,0.35)",
              border: "#ef4444",
            },
          ]}
        />
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
                {(selectedLoan.requester_name ||
                  selectedLoan.requester_username ||
                  "?")[0].toUpperCase()}
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

            {isAdmin && (
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
            )}
          </div>
        </div>
      )}
    </>
  );
}
