"use client";
import { useAuth } from "@/lib/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback, useMemo } from "react";
import { supabaseClient } from "@/lib/db/supabaseClient";
import { useToast } from "@/lib/context/ToastContext";
import Navbar from "@/components/Navbar";
import CartPanel from "@/components/CartPanel";
import AppShellLoading from "@/components/AppShellLoading";
import {
  RiCheckLine,
  RiCloseLine,
  RiArrowGoBackLine,
  RiShieldUserLine,
  RiHistoryLine,
  RiUserSettingsLine,
  RiLockLine,
  RiDeleteBinLine,
  RiKeyLine,
  RiTimeLine,
  RiBookmarkLine,
  RiAddLine,
  RiDragMove2Fill,
  RiCameraLine,
} from "react-icons/ri";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const ADMIN_TABS = ["loans", "users", "audit", "templates", "laptops"];
const LOAN_SOURCES = ["all", "tech", "laptop"];
const LOAN_STATUSES = [
  "",
  "pending",
  "approved",
  "overdue",
  "rejected",
  "returned",
];

function parseStateValue(value, allowedValues, fallback) {
  return allowedValues.includes(value) ? value : fallback;
}

function readAdminQueryState() {
  if (typeof window === "undefined") {
    return {
      tab: "loans",
      status: "pending",
      source: "all",
      q: "",
    };
  }

  const params = new URLSearchParams(window.location.search);
  return {
    tab: parseStateValue(params.get("tab") || "loans", ADMIN_TABS, "loans"),
    status: parseStateValue(
      params.get("status") || "pending",
      LOAN_STATUSES,
      "pending",
    ),
    source: parseStateValue(params.get("source") || "all", LOAN_SOURCES, "all"),
    q: params.get("q") || "",
  };
}

async function readApiResponse(res) {
  const contentType = res.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return res.json().catch(() => ({}));
  }

  const text = await res.text().catch(() => "");
  return text ? { error: text.slice(0, 200) } : {};
}

async function fetchJson(url, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Accept", "application/json");

  const res = await fetch(url, {
    ...init,
    cache: "no-store",
    headers,
  });

  const data = await readApiResponse(res);
  if (!res.ok) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }

  return data;
}

function SortableTemplateItem({ t, onEdit, onDelete }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: t.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: 16,
    opacity: isDragging ? 0.5 : 1,
    boxShadow: isDragging ? "0 5px 15px rgba(0,0,0,0.15)" : "none",
    position: "relative",
    zIndex: isDragging ? 10 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 8,
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div
            {...attributes}
            {...listeners}
            style={{
              cursor: "grab",
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
              padding: "4px",
            }}
          >
            <RiDragMove2Fill size={18} />
          </div>
          <div>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{t.name}</span>
            <span
              className={`badge ${t.loan_type === "permanent" ? "badge-permanent" : "badge-temporary"}`}
              style={{ fontSize: 10, marginLeft: 8 }}
            >
              {t.loan_type === "permanent" ? "📌 Permanent" : "⏱️ Temporary"}
            </span>
            {t.description && (
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                }}
              >
                {t.description}
              </p>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn btn-sm btn-outline" onClick={() => onEdit(t)}>
            Edit
          </button>
          <button
            className="btn btn-sm"
            aria-label={`Delete template ${t.name}`}
            style={{
              color: "var(--error)",
              background: "none",
              border: "1px solid rgba(239,68,68,0.3)",
              fontSize: 11,
            }}
            onClick={() => onDelete(t)}
          >
            <RiDeleteBinLine />
          </button>
        </div>
      </div>
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingLeft: 34 }}
      >
        {t.items.map((item) => (
          <span key={item.item_id} className="loan-item-chip">
            {item.item_name} × {item.quantity}
          </span>
        ))}
      </div>
    </div>
  );
}

function AdminPageContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const initialQueryState = readAdminQueryState();
  const [loans, setLoans] = useState([]);
  const [statusFilter, setStatusFilter] = useState(
    () => initialQueryState.status,
  );
  const [fetching, setFetching] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [adminNotes, setAdminNotes] = useState({});
  const [selectedLoans, setSelectedLoans] = useState(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [selectedPendingLoans, setSelectedPendingLoans] = useState(new Set());
  const [bulkApproveLoading, setBulkApproveLoading] = useState(false);
  const [userActionLoading, setUserActionLoading] = useState(null);
  const [inviteCodeLoading, setInviteCodeLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(() => initialQueryState.tab);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditFetching, setAuditFetching] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [users, setUsers] = useState([]);
  const [usersFetching, setUsersFetching] = useState(false);
  const [resetPasswords, setResetPasswords] = useState({});
  const [userMsg, setUserMsg] = useState("");
  const [error, setError] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteCodeInput, setInviteCodeInput] = useState("");
  const [reminderTimes, setReminderTimes] = useState({
    weekday: "09:00",
    saturday: "10:00",
    sunday: "14:00",
  });
  const [reminderTimesInput, setReminderTimesInput] = useState({
    weekday: "09:00",
    saturday: "10:00",
    sunday: "14:00",
  });
  const [reminderTimesLoading, setReminderTimesLoading] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templatesFetching, setTemplatesFetching] = useState(false);
  const [templateForm, setTemplateForm] = useState({
    name: "",
    description: "",
    loan_type: "temporary",
    items: [],
  });
  const [templateItemSearch, setTemplateItemSearch] = useState("");
  const [allItems, setAllItems] = useState([]);
  const [templateMsg, setTemplateMsg] = useState("");
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [clockMs, setClockMs] = useState(Date.now());
  const [loanSource, setLoanSource] = useState(() => initialQueryState.source); // 'all' | 'tech' | 'laptop'
  const [pendingCount, setPendingCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState(() => initialQueryState.q);

  const filteredLoans = useMemo(() => {
    if (!searchQuery.trim()) return loans;
    const q = searchQuery.toLowerCase();
    return loans.filter((loan) => {
      const nameMatch = (loan.requester_name || loan.requester_username || "")
        .toLowerCase()
        .includes(q);
      const deptMatch = (loan.department || "").toLowerCase().includes(q);
      const itemMatch =
        loan._source === "laptop"
          ? (loan.laptops || []).some((i) =>
              (i.laptops?.name || "").toLowerCase().includes(q),
            )
          : (loan.items || []).some((i) =>
              (i.item || "").toLowerCase().includes(q),
            );
      return nameMatch || deptMatch || itemMatch;
    });
  }, [loans, searchQuery]);

  // Laptops tab state
  const [laptopsData, setLaptopsData] = useState([]); // tiers with laptops
  const [laptopsFetching, setLaptopsFetching] = useState(false);
  const [laptopForm, setLaptopForm] = useState({
    name: "",
    screen_size: "",
    cpu: "",
    ram: "",
    storage: "",
    condition: "Good",
    tier_id: "",
  });
  const [editingLaptop, setEditingLaptop] = useState(null);
  const [permLoanModal, setPermLoanModal] = useState(null);
  const [tierInput, setTierInput] = useState("");
  const [editingTier, setEditingTier] = useState(null);
  const [laptopActionLoading, setLaptopActionLoading] = useState(null);
  const [currentlyOut, setCurrentlyOut] = useState([]);
  const [currentlyOutFetching, setCurrentlyOutFetching] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
    if (!loading && user && user.role !== "admin") router.replace("/dashboard");
  }, [user, loading, router]);

  useEffect(() => {
    const syncFromLocation = () => {
      const nextState = readAdminQueryState();
      setActiveTab((prev) => (prev === nextState.tab ? prev : nextState.tab));
      setStatusFilter((prev) =>
        prev === nextState.status ? prev : nextState.status,
      );
      setLoanSource((prev) =>
        prev === nextState.source ? prev : nextState.source,
      );
      setSearchQuery((prev) => (prev === nextState.q ? prev : nextState.q));
    };

    syncFromLocation();
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const nextState = {
      tab: activeTab === "loans" ? "" : activeTab,
      status: statusFilter === "pending" ? "" : statusFilter,
      source: loanSource === "all" ? "" : loanSource,
      q: searchQuery.trim(),
    };

    Object.entries(nextState).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });

    const nextQueryString = params.toString();
    const currentQueryString = window.location.search.replace(/^\?/, "");
    if (nextQueryString !== currentQueryString) {
      const nextUrl = nextQueryString
        ? `${window.location.pathname}?${nextQueryString}`
        : window.location.pathname;
      window.history.replaceState(window.history.state, "", nextUrl);
    }
  }, [activeTab, statusFilter, loanSource, searchQuery]);

  const fetchLoans = useCallback(async () => {
    setFetching(true);
    setError("");
    // "overdue" is a client-side pseudo-filter; fetch approved loans from API
    const apiStatus = statusFilter === "overdue" ? "approved" : statusFilter;
    const today = new Date().toISOString().split("T")[0];
    try {
      let techLoans = [];
      let laptopLoansArr = [];

      if (loanSource !== "laptop") {
        const params = new URLSearchParams({ view: "all", status: apiStatus });
        const res = await fetch(`/api/loans?${params}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || `Failed to load loans (${res.status})`);
          return;
        }
        const data = await res.json();
        techLoans = (data.loans || []).map((l) => ({ ...l, _source: "tech" }));
      }

      if (loanSource !== "tech") {
        const params = new URLSearchParams({ view: "all", status: apiStatus });
        const res = await fetch(`/api/laptop-loans?${params}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || `Failed to load laptop loans (${res.status})`);
          return;
        }
        const data = await res.json();
        laptopLoansArr = data.loans || [];
      }

      let merged = [...techLoans, ...laptopLoansArr].sort(
        (a, b) => new Date(b.created_at) - new Date(a.created_at),
      );

      // Client-side filter for overdue: approved + temporary + end_date < today
      if (statusFilter === "overdue") {
        merged = merged.filter(
          (l) =>
            l.loan_type === "temporary" && l.end_date && l.end_date < today,
        );
      }

      setLoans(merged);
    } catch (err) {
      setError("Network error — could not load loans");
    } finally {
      setFetching(false);
    }
  }, [statusFilter, loanSource]);

  const fetchAuditLogs = useCallback(async () => {
    setAuditFetching(true);
    setAuditError("");
    try {
      const data = await fetchJson("/api/audit?limit=100");
      setAuditLogs(Array.isArray(data.logs) ? data.logs : []);
    } catch (err) {
      setAuditError(err.message || "Could not load audit logs");
    } finally {
      setAuditFetching(false);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    setUsersFetching(true);
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        setUsers(data.users);
        if (data.invite_code) {
          setInviteCode(data.invite_code);
          setInviteCodeInput(data.invite_code);
        }
        if (data.reminder_times) {
          setReminderTimes(data.reminder_times);
          setReminderTimesInput(data.reminder_times);
        }
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Failed to load users (${res.status})`);
      }
    } catch (err) {
      setError("Network error — could not load users");
    } finally {
      setUsersFetching(false);
    }
  }, []);

  const fetchTemplates = async () => {
    setTemplatesFetching(true);
    try {
      const data = await fetchJson("/api/admin/templates");
      setTemplateMsg("");
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch (err) {
      setTemplateMsg(err.message || "Could not load templates");
    } finally {
      setTemplatesFetching(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = async (event) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = templates.findIndex((t) => t.id === active.id);
    const newIndex = templates.findIndex((t) => t.id === over.id);
    const newTemplates = arrayMove(templates, oldIndex, newIndex);
    setTemplates(newTemplates);

    // Save new ordering to the server
    fetch("/api/admin/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reorder",
        orderedIds: newTemplates.map((t) => t.id),
      }),
    }).catch(() => {
      toast.error("Could not save template order — please try again");
    });
  };

  const fetchAllItems = async () => {
    try {
      const data = await fetchJson("/api/items?tab=storage");
      setAllItems(Array.isArray(data.items) ? data.items : []);
    } catch (err) {
      setTemplateMsg(err.message || "Could not load inventory");
      setAllItems([]);
    }
  };

  const fetchLaptopsData = useCallback(async () => {
    setLaptopsFetching(true);
    try {
      const res = await fetch("/api/laptops");
      if (res.ok) {
        const data = await res.json();
        setLaptopsData(data.tiers || []);
      }
    } catch {
      /* silent */
    } finally {
      setLaptopsFetching(false);
    }
  }, []);

  const fetchCurrentlyOut = useCallback(async () => {
    setCurrentlyOutFetching(true);
    try {
      const res = await fetch("/api/laptop-loans?view=all&status=approved");
      if (res.ok) {
        const data = await res.json();
        setCurrentlyOut(data.loans || []);
      }
    } catch {
      /* silent */
    } finally {
      setCurrentlyOutFetching(false);
    }
  }, []);

  const fetchPendingCount = useCallback(async () => {
    try {
      const [r1, r2] = await Promise.all([
        fetch("/api/loans?view=all&status=pending&count_only=true"),
        fetch("/api/laptop-loans?view=all&status=pending&count_only=true"),
      ]);
      const d1 = r1.ok ? await r1.json() : {};
      const d2 = r2.ok ? await r2.json() : {};
      setPendingCount((d1.count || 0) + (d2.count || 0));
    } catch {
      /* silent */
    }
  }, []);

  const refreshLoansTab = useCallback(() => {
    fetchLoans();
    fetchPendingCount();
  }, [fetchLoans, fetchPendingCount]);

  const handleLaptopLoanAction = async (loanId, action) => {
    setActionLoading(loanId);
    setError("");
    try {
      const res = await fetch(`/api/laptop-loans/${loanId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, admin_notes: adminNotes[loanId] || "" }),
      });
      if (res.ok) {
        fetchLoans();
        fetchPendingCount();
        setAdminNotes((p) => ({ ...p, [loanId]: "" }));
        toast.success(
          `Loan ${action === "approve" ? "approved" : action === "reject" ? "rejected" : "returned"} successfully`,
        );
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || `Action failed (${res.status})`);
      }
    } catch {
      toast.error("Network error — action could not be completed");
    } finally {
      setActionLoading(null);
    }
  };

  useEffect(() => {
    if (user?.role === "admin") {
      fetchPendingCount();
      if (activeTab === "loans") fetchLoans();
      if (activeTab === "audit") fetchAuditLogs();
      if (activeTab === "users") fetchUsers();
      if (activeTab === "templates") {
        fetchTemplates();
        fetchAllItems();
      }
      if (activeTab === "laptops") {
        fetchLaptopsData();
        fetchCurrentlyOut();
      }
    }
  }, [
    user,
    activeTab,
    fetchLoans,
    fetchAuditLogs,
    fetchUsers,
    fetchLaptopsData,
    fetchCurrentlyOut,
    fetchPendingCount,
  ]);

  useEffect(() => {
    setError("");
    if (activeTab !== "audit") setAuditError("");
    if (activeTab !== "templates") setTemplateMsg("");
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "loans") return;
    const interval = setInterval(() => setClockMs(Date.now()), 60000);
    return () => clearInterval(interval);
  }, [activeTab]);

  // Realtime subscription — refetch loans on any loan_requests change
  useEffect(() => {
    if (user?.role !== "admin" || activeTab !== "loans") return;

    let channel;
    try {
      channel = supabaseClient
        .channel("admin-loan-requests")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "loan_requests" },
          () => {
            refreshLoansTab();
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "laptop_loan_requests" },
          () => {
            refreshLoansTab();
          },
        )
        .subscribe((_status, err) => {
          if (err)
            console.warn(
              "Realtime unavailable, using polling fallback:",
              err.message,
            );
        });
    } catch (err) {
      console.warn(
        "Realtime not available on this device, using polling fallback:",
        err.message,
      );
    }

    // Fallback poll every 60s in case Realtime drops
    const fallback = setInterval(refreshLoansTab, 60000);

    return () => {
      if (channel) supabaseClient.removeChannel(channel);
      clearInterval(fallback);
    };
  }, [user, activeTab, refreshLoansTab]);

  const handleAction = async (loanId, action) => {
    setActionLoading(loanId);
    setError("");
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loan_id: loanId,
          action,
          admin_notes: adminNotes[loanId] || "",
        }),
      });
      if (res.ok) {
        // Optimistically update the UI to prevent stale data
        if (action === "delete") {
          setLoans((prev) => prev.filter((l) => l.id !== loanId));
        } else {
          setLoans((prev) =>
            prev.map((l) =>
              l.id === loanId
                ? {
                    ...l,
                    status: action === "return" ? "returned" : action + "d",
                  }
                : l,
            ),
          );
        }

        fetchLoans();
        fetchPendingCount();
        setAdminNotes((p) => ({ ...p, [loanId]: "" }));
        toast.success(
          `Loan ${action === "approve" ? "approved" : action === "reject" ? "rejected" : action === "return" ? "returned" : action + "d"} successfully`,
        );
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || `Action failed (${res.status})`);
      }
    } catch (err) {
      toast.error("Network error — action could not be completed");
    } finally {
      setActionLoading(null);
    }
  };

  const handleBulkApprove = async () => {
    if (selectedPendingLoans.size === 0) return;
    setBulkApproveLoading(true);
    setError("");
    try {
      const selectedIds = Array.from(selectedPendingLoans);
      const techIds = selectedIds.filter(
        (id) => loans.find((l) => l.id === id)?._source !== "laptop",
      );
      const laptopIds = selectedIds.filter(
        (id) => loans.find((l) => l.id === id)?._source === "laptop",
      );

      const tasks = [];
      if (techIds.length > 0) {
        tasks.push(
          fetch("/api/admin", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "bulk_approve", loan_ids: techIds }),
          }).then(async (res) => ({
            ok: res.ok,
            ids: techIds,
            body: await res.json().catch(() => ({})),
          })),
        );
      }
      for (const lid of laptopIds) {
        tasks.push(
          fetch(`/api/laptop-loans/${lid}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "approve" }),
          }).then(async (res) => ({
            ok: res.ok,
            ids: [lid],
            body: await res.json().catch(() => ({})),
          })),
        );
      }

      const results = await Promise.all(tasks);
      const failedIds = results
        .filter((result) => !result.ok)
        .flatMap((result) => result.ids);
      const succeededCount = selectedIds.length - failedIds.length;

      if (failedIds.length === 0) {
        setSelectedPendingLoans(new Set());
        toast.success(`${selectedIds.length} loan(s) approved successfully`);
      } else {
        setSelectedPendingLoans(new Set(failedIds));
        const firstError = results.find((result) => !result.ok)?.body?.error;
        toast.error(
          firstError ||
            `${failedIds.length} approval(s) failed. Failed requests stayed selected.`,
        );
        if (succeededCount > 0) {
          toast.success(`${succeededCount} loan(s) approved successfully`);
        }
      }

      refreshLoansTab();
    } catch {
      toast.error("Network error — bulk approve could not be completed");
    } finally {
      setBulkApproveLoading(false);
    }
  };

  const handleBulkReturn = async () => {
    if (selectedLoans.size === 0) return;
    setBulkLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_return",
          loan_ids: Array.from(selectedLoans),
        }),
      });
      if (res.ok) {
        setSelectedLoans(new Set());
        fetchLoans();
        toast.success(`${selectedLoans.size} loan(s) returned successfully`);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || `Bulk return failed (${res.status})`);
      }
    } catch (err) {
      toast.error("Network error — bulk return could not be completed");
    } finally {
      setBulkLoading(false);
    }
  };

  const toggleSelect = (id) => {
    setSelectedLoans((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const ids = filteredLoans
      .filter(
        (l) =>
          l.status === "approved" &&
          l.loan_type === "temporary" &&
          l._source !== "laptop",
      )
      .map((l) => l.id);
    setSelectedLoans(new Set(ids));
  };

  const toggleSelectPending = (id) => {
    setSelectedPendingLoans((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllPending = () => {
    const ids = filteredLoans
      .filter((l) => l.status === "pending")
      .map((l) => l.id);
    setSelectedPendingLoans(new Set(ids));
  };

  const handleResetPassword = async (userId) => {
    const pw = resetPasswords[userId];
    if (!pw || pw.length < 6) {
      setUserMsg("Password must be at least 6 characters");
      return;
    }
    setUserActionLoading(`reset-${userId}`);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "reset_password",
          user_id: userId,
          new_password: pw,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setResetPasswords((p) => ({ ...p, [userId]: "" }));
        toast.success(data.message || "Password changed successfully");
      } else {
        toast.error(data.error || "Failed to reset password");
      }
    } catch {
      toast.error("Network error — could not reset password");
    } finally {
      setUserActionLoading(null);
    }
  };

  const handleChangeRole = async (userId, newRole) => {
    setUserActionLoading(`role-${userId}`);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "change_role",
          user_id: userId,
          new_role: newRole,
        }),
      });
      const data = await res.json();
      setUserMsg(data.message || data.error);
      if (res.ok) {
        toast.success(data.message || "Role updated");
        fetchUsers();
      } else {
        toast.error(data.error || "Failed to change role");
      }
    } catch {
      const msg = "Network error — could not change role";
      setUserMsg(msg);
      toast.error(msg);
    } finally {
      setUserActionLoading(null);
    }
  };

  const handleDeleteUser = async (userId, username) => {
    if (!confirm(`Delete user @${username}? This cannot be undone.`)) return;
    setUserActionLoading(`delete-${userId}`);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_user", user_id: userId }),
      });
      const data = await res.json();
      setUserMsg(data.message || data.error);
      if (res.ok) {
        toast.success(data.message || "User deleted");
        fetchUsers();
      } else {
        toast.error(data.error || "Failed to delete user");
      }
    } catch {
      const msg = "Network error — could not delete user";
      setUserMsg(msg);
      toast.error(msg);
    } finally {
      setUserActionLoading(null);
    }
  };

  const handleUpdateInviteCode = async () => {
    if (!inviteCodeInput || inviteCodeInput.trim().length < 3) {
      setUserMsg("Invite code must be at least 3 characters");
      return;
    }
    setInviteCodeLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_invite_code",
          invite_code: inviteCodeInput.trim(),
        }),
      });
      const data = await res.json();
      setUserMsg(data.message || data.error);
      if (res.ok) {
        toast.success(data.message || "Invite code updated");
        setInviteCode(inviteCodeInput.trim());
      } else {
        toast.error(data.error || "Failed to update invite code");
      }
    } catch {
      const msg = "Network error — could not update invite code";
      setUserMsg(msg);
      toast.error(msg);
    } finally {
      setInviteCodeLoading(false);
    }
  };

  const handleUpdateReminderTimes = async () => {
    setReminderTimesLoading(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_reminder_times",
          reminder_times: reminderTimesInput,
        }),
      });
      const data = await res.json();
      setUserMsg(data.message || data.error);
      if (res.ok) {
        toast.success(data.message || "Reminder times updated");
        setReminderTimes(reminderTimesInput);
      } else {
        toast.error(data.error || "Failed to update reminder times");
      }
    } catch {
      const msg = "Network error — could not update reminder times";
      setUserMsg(msg);
      toast.error(msg);
    } finally {
      setReminderTimesLoading(false);
    }
  };

  if (loading) return <AppShellLoading />;

  if (!user) return null;

  const statusBadge = (status) => {
    const map = {
      pending: { cls: "badge-warning", text: "⏳ Pending" },
      approved: { cls: "badge-success", text: "✅ Approved" },
      rejected: { cls: "badge-error", text: "❌ Rejected" },
      returned: { cls: "badge-info", text: "↩️ Returned" },
    };
    const s = map[status] || { cls: "", text: status };
    return <span className={`badge ${s.cls}`}>{s.text}</span>;
  };

  const actionBadge = (action) => {
    const colors = {
      approve: { bg: "rgba(34,197,94,0.15)", color: "#4ade80" },
      reject: { bg: "rgba(239,68,68,0.15)", color: "#f87171" },
      return: { bg: "rgba(59,130,246,0.15)", color: "#60a5fa" },
      bulk_return: { bg: "rgba(168,85,247,0.15)", color: "#c084fc" },
      reset_password: { bg: "rgba(245,158,11,0.15)", color: "#fbbf24" },
      change_role: { bg: "rgba(6,182,212,0.15)", color: "#22d3ee" },
      delete_user: { bg: "rgba(239,68,68,0.15)", color: "#f87171" },
    };
    const c = colors[action] || {
      bg: "rgba(161,161,170,0.1)",
      color: "#a1a1aa",
    };
    return (
      <span
        style={{
          display: "inline-block",
          padding: "2px 8px",
          borderRadius: 12,
          fontSize: 10,
          fontWeight: 600,
          background: c.bg,
          color: c.color,
        }}
      >
        {action.replace(/_/g, " ").toUpperCase()}
      </span>
    );
  };

  const timeAgo = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return (
      d.toLocaleDateString() +
      " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  };

  const formatDueTimer = (endDate) => {
    if (!endDate) return null;
    const target = new Date(`${endDate}T23:59:59`);
    if (Number.isNaN(target.getTime())) return null;

    const diff = target.getTime() - clockMs;
    const absHours = Math.floor(Math.abs(diff) / (1000 * 60 * 60));
    const days = Math.floor(absHours / 24);
    const hours = absHours % 24;
    const amount = days > 0 ? `${days}d ${hours}h` : `${hours}h`;

    return diff >= 0 ? `⏳ Due in ${amount}` : `🚨 Overdue by ${amount}`;
  };

  return (
    <>
      <Navbar />
      <CartPanel />
      <div className="page-container">
        <div className="page-header">
          <h1>
            <RiShieldUserLine style={{ verticalAlign: "middle" }} /> Admin
          </h1>
          <p>Manage loans, users & audit trail</p>
        </div>

        {/* Main Tabs */}
        <div className="tabs" style={{ marginBottom: 16 }}>
          <button
            className={`tab ${activeTab === "loans" ? "active" : ""}`}
            onClick={() => setActiveTab("loans")}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            📋 Loans
            {pendingCount > 0 && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 18,
                  height: 18,
                  padding: "0 5px",
                  borderRadius: 10,
                  background: "#f59e0b",
                  color: "white",
                  fontSize: 11,
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                {pendingCount}
              </span>
            )}
          </button>
          <button
            className={`tab ${activeTab === "users" ? "active" : ""}`}
            onClick={() => setActiveTab("users")}
          >
            <RiUserSettingsLine
              style={{ verticalAlign: "middle", marginRight: 4 }}
            />{" "}
            Users
          </button>
          <button
            className={`tab ${activeTab === "audit" ? "active" : ""}`}
            onClick={() => setActiveTab("audit")}
          >
            <RiHistoryLine
              style={{ verticalAlign: "middle", marginRight: 4 }}
            />{" "}
            Audit Log
          </button>
          <button
            className={`tab ${activeTab === "templates" ? "active" : ""}`}
            onClick={() => setActiveTab("templates")}
          >
            <RiBookmarkLine
              style={{ verticalAlign: "middle", marginRight: 4 }}
            />{" "}
            Templates
          </button>
          <button
            className={`tab ${activeTab === "laptops" ? "active" : ""}`}
            onClick={() => setActiveTab("laptops")}
          >
            💻 Laptops
          </button>
        </div>

        {error && (
          <div
            aria-live="polite"
            style={{
              padding: "10px 16px",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 13,
              color: "var(--error)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>{error}</span>
            <button
              aria-label="Dismiss error message"
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

        {/* ====== LOANS TAB ====== */}
        {activeTab === "loans" && (
          <>
            {/* Unified filter bar */}
            <div
              className="filter-shell"
              style={{
                marginBottom: 16,
              }}
            >
              <div className="filter-toolbar-header">
                <span className="filter-kicker">Loan Source</span>
                <div className="filter-segment">
                  {[
                    { key: "all", label: "All" },
                    { key: "tech", label: "📦 Tech" },
                    { key: "laptop", label: "💻 Laptop" },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      className={`filter-segment-button ${loanSource === key ? "active" : ""}`}
                      onClick={() => {
                        setLoanSource(key);
                        setSelectedLoans(new Set());
                        setSelectedPendingLoans(new Set());
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <input
                  className="filter-search-input"
                  type="text"
                  aria-label="Search loans"
                  name="loan_search"
                  autoComplete="off"
                  spellCheck={false}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, department, or item…"
                  style={{
                    width: "100%",
                  }}
                />
              </div>
              <div className="filter-chip-row">
                {[
                  { value: "", label: "All" },
                  { value: "pending", label: "Pending" },
                  { value: "approved", label: "Approved" },
                  { value: "overdue", label: "⚠️ Overdue" },
                  { value: "rejected", label: "Rejected" },
                  { value: "returned", label: "Returned" },
                ].map(({ value, label }) => {
                  const isActive = statusFilter === value;
                  const isOverdueTab = value === "overdue";
                  return (
                    <button
                      key={value}
                      className={`filter-chip ${isActive ? "active" : ""} ${isOverdueTab ? "filter-chip-alert" : ""}`}
                      onClick={() => {
                        setStatusFilter(value);
                        setSelectedLoans(new Set());
                        setSelectedPendingLoans(new Set());
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {statusFilter === "pending" && loans.length > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  padding: "12px 16px",
                  background: "rgba(34,197,94,0.05)",
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                  marginBottom: 16,
                }}
              >
                <button
                  className="btn btn-sm btn-outline"
                  onClick={selectAllPending}
                >
                  Select All
                </button>
                <button
                  className="btn btn-sm btn-outline"
                  onClick={() => setSelectedPendingLoans(new Set())}
                >
                  Clear
                </button>
                <span
                  style={{
                    flex: 1,
                    fontSize: 13,
                    color: "var(--text-secondary)",
                  }}
                >
                  {selectedPendingLoans.size} selected
                </span>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleBulkApprove}
                  disabled={
                    selectedPendingLoans.size === 0 || bulkApproveLoading
                  }
                  style={{
                    background: "linear-gradient(135deg, #22c55e, #16a34a)",
                  }}
                >
                  {bulkApproveLoading ? (
                    <>
                      <span className="btn-spinner" /> Approving…
                    </>
                  ) : (
                    <>
                      <RiCheckLine />{" "}
                      {`Bulk Approve (${selectedPendingLoans.size})`}
                    </>
                  )}
                </button>
              </div>
            )}

            {statusFilter === "approved" &&
              loans.some(
                (l) => l.loan_type === "temporary" && l._source !== "laptop",
              ) && (
                <div
                  className="admin-bulk-bar"
                  style={{
                    display: "flex",
                    gap: 8,
                    rowGap: 8,
                    flexWrap: "wrap",
                    alignItems: "center",
                    padding: "12px 16px",
                    background: "rgba(99,102,241,0.05)",
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    marginBottom: 16,
                  }}
                >
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={selectAll}
                  >
                    Select All
                  </button>
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => setSelectedLoans(new Set())}
                  >
                    Clear
                  </button>
                  <span
                    style={{
                      flex: 1,
                      fontSize: 13,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {selectedLoans.size} selected
                  </span>
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={handleBulkReturn}
                    disabled={selectedLoans.size === 0 || bulkLoading}
                    style={{
                      background:
                        "linear-gradient(135deg, var(--accent), #818cf8)",
                    }}
                  >
                    <RiArrowGoBackLine />{" "}
                    {bulkLoading
                      ? "Returning..."
                      : `Bulk Return (${selectedLoans.size})`}
                  </button>
                </div>
              )}

            {fetching ? (
              <div>
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="skeleton skeleton-row" />
                ))}
              </div>
            ) : loans.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">✨</div>
                <h3>No {statusFilter || ""} requests</h3>
                <p>
                  {statusFilter === "pending"
                    ? "All caught up!"
                    : "No loan requests found."}
                </p>
              </div>
            ) : filteredLoans.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🔍</div>
                <h3>No results for &quot;{searchQuery}&quot;</h3>
                <p>Try a different name or item.</p>
              </div>
            ) : (
              filteredLoans.map((loan) => {
                const todayStr = new Date().toISOString().split("T")[0];
                const isOverdue =
                  loan.status === "approved" &&
                  loan.loan_type === "temporary" &&
                  loan.end_date &&
                  loan.end_date < todayStr;
                const accentColor = isOverdue
                  ? "#ef4444"
                  : loan.status === "pending"
                    ? "#f59e0b"
                    : loan.status === "approved"
                      ? "#10b981"
                      : loan.status === "rejected"
                        ? "#6b7280"
                        : "#6366f1";
                const hasFooter =
                  (loan.admin_notes && loan.status !== "pending") ||
                  (loan.status === "returned" && loan.return_photo_url) ||
                  loan._source !== "laptop";

                return (
                  <div
                    key={loan.id}
                    className="admin-loan-card"
                    style={{
                      background: "var(--bg-card)",
                      border: "1px solid var(--border)",
                      borderLeft: `4px solid ${accentColor}`,
                      borderRadius: 14,
                      marginBottom: 12,
                      overflow: "hidden",
                    }}
                  >
                    {/* Header */}
                    <div
                      className="admin-loan-card-header"
                      style={{
                        padding: "14px 18px 10px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 12,
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: "flex",
                            gap: 5,
                            alignItems: "center",
                            marginBottom: 7,
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            className={`badge ${loan.loan_type === "permanent" ? "badge-permanent" : "badge-temporary"}`}
                          >
                            {loan.loan_type === "permanent"
                              ? "📌 Permanent"
                              : "⏱️ Temporary"}
                          </span>
                          {statusBadge(loan.status)}
                          {loan._source === "laptop" && (
                            <span
                              className="badge"
                              style={{
                                background: "rgba(16,185,129,0.15)",
                                color: "#10b981",
                                border: "1px solid rgba(16,185,129,0.3)",
                              }}
                            >
                              💻 Laptop
                            </span>
                          )}
                          {isOverdue && (
                            <span className="badge badge-error">
                              🚨 Overdue
                            </span>
                          )}
                        </div>
                        <div
                          className="admin-loan-card-name"
                          style={{ fontWeight: 700, fontSize: 15 }}
                        >
                          {loan.requester_name}
                          <span
                            className="admin-loan-card-username"
                            style={{
                              fontWeight: 400,
                              color: "var(--text-muted)",
                              marginLeft: 8,
                              fontSize: 12,
                            }}
                          >
                            @{loan.requester_username}
                          </span>
                        </div>
                      </div>
                      <div
                        className="admin-loan-card-header-right"
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "flex-end",
                          gap: 8,
                          flexShrink: 0,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 11,
                            color: "var(--text-muted)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          #{loan.id} · {timeAgo(loan.created_at)}
                        </span>
                        {statusFilter === "pending" && (
                          <button
                            type="button"
                            aria-label={`Select loan ${loan.id} for bulk approval`}
                            aria-pressed={selectedPendingLoans.has(loan.id)}
                            style={{
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: 5,
                              fontSize: 12,
                              color: "var(--text-secondary)",
                              fontWeight: 500,
                              background: "none",
                              border: "none",
                              padding: 0,
                            }}
                            onClick={() => toggleSelectPending(loan.id)}
                          >
                            <div
                              style={{
                                width: 18,
                                height: 18,
                                borderRadius: 5,
                                border: selectedPendingLoans.has(loan.id)
                                  ? "none"
                                  : "1.5px solid var(--border)",
                                background: selectedPendingLoans.has(loan.id)
                                  ? "#10b981"
                                  : "transparent",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                transition: "all 0.15s",
                              }}
                            >
                              {selectedPendingLoans.has(loan.id) && (
                                <RiCheckLine color="white" size={13} />
                              )}
                            </div>
                            Select
                          </button>
                        )}
                        {statusFilter === "approved" &&
                          loan.loan_type === "temporary" &&
                          loan._source !== "laptop" && (
                            <button
                              type="button"
                              aria-label={`Select loan ${loan.id} for bulk return`}
                              aria-pressed={selectedLoans.has(loan.id)}
                              style={{
                                cursor: "pointer",
                                display: "flex",
                                alignItems: "center",
                                gap: 5,
                                fontSize: 12,
                                color: "var(--text-secondary)",
                                fontWeight: 500,
                                background: "none",
                                border: "none",
                                padding: 0,
                              }}
                              onClick={() => toggleSelect(loan.id)}
                            >
                              <div
                                style={{
                                  width: 18,
                                  height: 18,
                                  borderRadius: 5,
                                  border: selectedLoans.has(loan.id)
                                    ? "none"
                                    : "1.5px solid var(--border)",
                                  background: selectedLoans.has(loan.id)
                                    ? "var(--accent)"
                                    : "transparent",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  transition: "all 0.15s",
                                  boxShadow: selectedLoans.has(loan.id)
                                    ? "0 2px 6px rgba(99,102,241,0.25)"
                                    : "none",
                                }}
                              >
                                {selectedLoans.has(loan.id) && (
                                  <RiCheckLine color="white" size={13} />
                                )}
                              </div>
                              Select
                            </button>
                          )}
                      </div>
                    </div>

                    {/* Items */}
                    <div
                      className="admin-loan-card-items"
                      style={{
                        padding: "0 18px 12px",
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 6,
                      }}
                    >
                      {loan._source === "laptop"
                        ? (loan.laptops || []).map((item) => (
                            <span key={item.id} className="loan-item-chip">
                              💻{" "}
                              {item.laptops?.name ||
                                `Laptop #${item.laptop_id}`}
                            </span>
                          ))
                        : (loan.items || []).map((item) => (
                            <span key={item.id} className="loan-item-chip">
                              {item.item} × {item.quantity}
                            </span>
                          ))}
                    </div>

                    {/* Meta row */}
                    <div
                      className="admin-loan-card-meta"
                      style={{
                        padding: "10px 18px",
                        borderTop: "1px solid var(--border)",
                        background: "rgba(255,255,255,0.015)",
                        display: "flex",
                        gap: 14,
                        fontSize: 12,
                        color: "var(--text-muted)",
                        flexWrap: "wrap",
                        alignItems: "center",
                      }}
                    >
                      {loan.purpose && <span>📝 {loan.purpose}</span>}
                      {loan.department && <span>🏢 {loan.department}</span>}
                      <span>
                        📅 {loan.start_date}
                        {loan.end_date ? ` → ${loan.end_date}` : " → Ongoing"}
                      </span>
                      {loan.status === "approved" &&
                        loan.loan_type === "temporary" &&
                        loan.end_date && (
                          <span
                            style={{
                              fontWeight: 600,
                              color: isOverdue
                                ? "#ef4444"
                                : "var(--text-secondary)",
                            }}
                          >
                            {formatDueTimer(loan.end_date)}
                          </span>
                        )}
                    </div>

                    {/* Pending: notes + approve/reject */}
                    {loan.status === "pending" && (
                      <div
                        className="admin-loan-card-pending"
                        style={{
                          padding: "14px 18px",
                          borderTop: "1px solid var(--border)",
                        }}
                      >
                        <input
                          type="text"
                          aria-label={`Admin notes for loan ${loan.id}`}
                          name={`admin_notes_${loan.id}`}
                          autoComplete="off"
                          className="admin-notes-input"
                          placeholder="Admin notes (optional — sent to requester)"
                          value={adminNotes[loan.id] || ""}
                          onChange={(e) =>
                            setAdminNotes((p) => ({
                              ...p,
                              [loan.id]: e.target.value,
                            }))
                          }
                        />
                        <div
                          className="admin-loan-card-actions"
                          style={{ display: "flex", gap: 8, marginTop: 10 }}
                        >
                          <button
                            disabled={actionLoading === loan.id}
                            onClick={() =>
                              loan._source === "laptop"
                                ? handleLaptopLoanAction(loan.id, "approve")
                                : handleAction(loan.id, "approve")
                            }
                            style={{
                              flex: 1,
                              padding: "10px 0",
                              borderRadius: 10,
                              border: "none",
                              fontWeight: 700,
                              fontSize: 13,
                              cursor:
                                actionLoading === loan.id
                                  ? "not-allowed"
                                  : "pointer",
                              background:
                                "linear-gradient(135deg, #10b981, #059669)",
                              color: "white",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 6,
                              opacity: actionLoading === loan.id ? 0.7 : 1,
                              boxShadow: "0 2px 8px rgba(16,185,129,0.25)",
                            }}
                          >
                            {actionLoading === loan.id ? (
                              <span className="btn-spinner" />
                            ) : (
                              <RiCheckLine />
                            )}{" "}
                            Approve
                          </button>
                          <button
                            disabled={actionLoading === loan.id}
                            onClick={() =>
                              loan._source === "laptop"
                                ? handleLaptopLoanAction(loan.id, "reject")
                                : handleAction(loan.id, "reject")
                            }
                            style={{
                              flex: 1,
                              padding: "10px 0",
                              borderRadius: 10,
                              fontWeight: 700,
                              fontSize: 13,
                              cursor:
                                actionLoading === loan.id
                                  ? "not-allowed"
                                  : "pointer",
                              background: "rgba(239,68,68,0.08)",
                              color: "#ef4444",
                              border: "1.5px solid rgba(239,68,68,0.3)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 6,
                              opacity: actionLoading === loan.id ? 0.7 : 1,
                            }}
                          >
                            {actionLoading === loan.id ? (
                              <span className="btn-spinner" />
                            ) : (
                              <RiCloseLine />
                            )}{" "}
                            Reject
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Approved: return button */}
                    {loan.status === "approved" &&
                      (loan.loan_type === "temporary" ||
                        loan._source === "laptop") && (
                        <div
                          className="admin-loan-card-return"
                          style={{
                            padding: "12px 18px",
                            borderTop: "1px solid var(--border)",
                          }}
                        >
                          <button
                            disabled={actionLoading === loan.id}
                            onClick={() =>
                              loan._source === "laptop"
                                ? handleLaptopLoanAction(loan.id, "return")
                                : handleAction(loan.id, "return")
                            }
                            className="admin-loan-return-btn"
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "8px 18px",
                              borderRadius: 10,
                              fontWeight: 700,
                              fontSize: 13,
                              cursor:
                                actionLoading === loan.id
                                  ? "not-allowed"
                                  : "pointer",
                              border: "none",
                              background: isOverdue
                                ? "linear-gradient(135deg, #ef4444, #dc2626)"
                                : "linear-gradient(135deg, #10b981, #059669)",
                              color: "white",
                              opacity: actionLoading === loan.id ? 0.7 : 1,
                              boxShadow: isOverdue
                                ? "0 2px 8px rgba(239,68,68,0.35)"
                                : "0 2px 8px rgba(16,185,129,0.3)",
                            }}
                          >
                            {actionLoading === loan.id ? (
                              <>
                                <span className="btn-spinner" /> Returning…
                              </>
                            ) : (
                              <>
                                <RiArrowGoBackLine />{" "}
                                {isOverdue
                                  ? "⚠ Mark as Returned"
                                  : "Mark as Returned"}
                              </>
                            )}
                          </button>
                        </div>
                      )}

                    {/* Footer: notes, photo, delete */}
                    {hasFooter && (
                      <div
                        className="admin-loan-card-footer"
                        style={{
                          padding: "10px 18px",
                          borderTop: "1px solid var(--border)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 8,
                          flexWrap: "wrap",
                          background: "rgba(255,255,255,0.01)",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                            flex: 1,
                          }}
                        >
                          {loan.admin_notes && loan.status !== "pending" && (
                            <div
                              className="admin-loan-card-note"
                              style={{
                                fontSize: 12,
                                color: "var(--text-secondary)",
                              }}
                            >
                              <strong>Notes:</strong> {loan.admin_notes}
                            </div>
                          )}
                          {loan.status === "returned" &&
                            loan.return_photo_url && (
                              <a
                                className="admin-loan-card-proof"
                                href={loan.return_photo_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  fontSize: 12,
                                  color: "var(--accent)",
                                  textDecoration: "none",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                }}
                              >
                                <RiCameraLine /> View Proof of Return
                              </a>
                            )}
                        </div>
                        {loan._source !== "laptop" && (
                          <button
                            className="admin-loan-card-delete"
                            disabled={actionLoading === loan.id}
                            aria-label={`Delete loan ${loan.id}`}
                            style={{
                              color: "var(--error)",
                              background: "none",
                              border: "1px solid rgba(239,68,68,0.25)",
                              borderRadius: 8,
                              fontSize: 11,
                              padding: "5px 10px",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: 4,
                            }}
                            onClick={() => {
                              if (
                                confirm(
                                  `Delete loan #${loan.id}?${loan.status === "approved" ? " Stock will be restored." : ""}`,
                                )
                              )
                                handleAction(loan.id, "delete");
                            }}
                          >
                            <RiDeleteBinLine /> Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {/* ====== USERS TAB ====== */}
        {activeTab === "users" && (
          <>
            {userMsg && (
              <div
                aria-live="polite"
                style={{
                  padding: "10px 16px",
                  background: "rgba(99,102,241,0.08)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  marginBottom: 16,
                  fontSize: 13,
                  color: "var(--text-primary)",
                }}
              >
                {userMsg}
                <button
                  aria-label="Dismiss admin message"
                  onClick={() => setUserMsg("")}
                  style={{
                    float: "right",
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            {/* Invite Code Management */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 16,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 4,
                  color: "var(--text-primary)",
                }}
              >
                <RiKeyLine
                  style={{ verticalAlign: "middle", marginRight: 6 }}
                />
                Invite Code
              </div>
              <p
                style={{
                  fontSize: 11,
                  color: "var(--text-secondary)",
                  marginBottom: 8,
                }}
              >
                Required for new registrations.
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="text"
                  aria-label="Registration invite code"
                  name="invite_code"
                  autoComplete="off"
                  value={inviteCodeInput}
                  onChange={(e) => setInviteCodeInput(e.target.value)}
                  placeholder="Enter invite code…"
                  style={{
                    flex: 1,
                    padding: "7px 10px",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontSize: 13,
                  }}
                />
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleUpdateInviteCode}
                  disabled={
                    inviteCodeInput.trim() === inviteCode || inviteCodeLoading
                  }
                >
                  {inviteCodeLoading ? (
                    <>
                      <span className="btn-spinner" /> Saving…
                    </>
                  ) : (
                    "Update"
                  )}
                </button>
              </div>
            </div>

            {/* Reminder Times */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 16,
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 4,
                  color: "var(--text-primary)",
                }}
              >
                <RiTimeLine
                  style={{ verticalAlign: "middle", marginRight: 6 }}
                />
                Due-Soon Reminder Times
              </div>
              <p
                style={{
                  fontSize: 11,
                  color: "var(--text-secondary)",
                  marginBottom: 12,
                }}
              >
                Set the time (SGT) to send due-tomorrow reminders. Overdue
                alerts fire regardless of this setting. The cron job should run
                hourly.
              </p>
              <div className="reminder-times-grid" style={{ marginBottom: 12 }}>
                {[
                  { key: "weekday", label: "Weekdays (Mon–Fri)" },
                  { key: "saturday", label: "Saturday" },
                  { key: "sunday", label: "Sunday" },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label
                      style={{
                        display: "block",
                        fontSize: 10,
                        color: "var(--text-secondary)",
                        marginBottom: 3,
                      }}
                    >
                      {label}
                    </label>
                    <input
                      type="time"
                      value={reminderTimesInput[key]}
                      onChange={(e) =>
                        setReminderTimesInput((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      style={{
                        width: "100%",
                        padding: "5px 4px",
                        background: "var(--bg-secondary)",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        color: "var(--text-primary)",
                        fontSize: 16,
                        boxSizing: "border-box",
                        colorScheme: "dark",
                        minWidth: 0,
                      }}
                    />
                  </div>
                ))}
              </div>
              <button
                className="btn btn-sm btn-primary"
                onClick={handleUpdateReminderTimes}
                disabled={
                  reminderTimesLoading ||
                  (reminderTimesInput.weekday === reminderTimes.weekday &&
                    reminderTimesInput.saturday === reminderTimes.saturday &&
                    reminderTimesInput.sunday === reminderTimes.sunday)
                }
              >
                {reminderTimesLoading ? (
                  <>
                    <span className="btn-spinner" /> Saving…
                  </>
                ) : (
                  "Save Times"
                )}
              </button>
            </div>

            {usersFetching ? (
              <div className="loading-spinner">
                <div className="spinner" />
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>User</th>
                      <th className="hide-mobile">Username</th>
                      <th>Contact Info</th>
                      <th>Role</th>
                      <th>Joined</th>
                      <th>Reset Pass</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.id}>
                        <td style={{ fontWeight: 500 }}>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                            }}
                          >
                            <div
                              style={{
                                width: 26,
                                height: 26,
                                borderRadius: "50%",
                                background:
                                  u.role === "admin"
                                    ? "linear-gradient(135deg, #f59e0b, #ef4444)"
                                    : u.role === "tech"
                                      ? "linear-gradient(135deg, #10b981, #059669)"
                                      : "linear-gradient(135deg, var(--accent), #818cf8)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: 11,
                                fontWeight: 700,
                                color: "white",
                                flexShrink: 0,
                              }}
                            >
                              {u.display_name[0].toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontSize: 12 }}>
                                {u.display_name}
                              </div>
                              <div
                                style={{
                                  fontSize: 11,
                                  color: "var(--text-secondary)",
                                  marginTop: 1,
                                }}
                              >
                                @{u.username}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td
                          className="hide-mobile"
                          style={{
                            color: "var(--text-secondary)",
                            fontSize: 12,
                          }}
                        >
                          @{u.username}
                        </td>
                        <td
                          style={{
                            fontSize: 11,
                            color: "var(--text-secondary)",
                            lineHeight: 1.4,
                          }}
                        >
                          {u.email ? (
                            <div>
                              <span title="Email">📧 {u.email}</span>
                            </div>
                          ) : null}
                          {u.telegram_chat_id ? (
                            <div>
                              <span
                                title="Telegram linked"
                                style={{ color: "#3b82f6" }}
                              >
                                💬 Telegram linked
                              </span>
                            </div>
                          ) : null}
                          {!u.email && !u.telegram_chat_id && (
                            <span style={{ color: "var(--text-muted)" }}>
                              -
                            </span>
                          )}
                        </td>
                        <td>
                          <select
                            value={u.role}
                            disabled={
                              u.id === user.id ||
                              userActionLoading === `role-${u.id}`
                            }
                            onChange={(e) =>
                              handleChangeRole(u.id, e.target.value)
                            }
                            style={{
                              /* paddingRight must accommodate the custom SVG arrow */
                              padding: "5px 28px 5px 8px",
                              /* 16px: prevents iOS zoom on focus */
                              fontSize: 16,
                              fontWeight: 600,
                              borderRadius: 7,
                              border: "1px solid var(--border)",
                              /* Suppress native arrow so only our arrow shows */
                              WebkitAppearance: "none",
                              appearance: "none",
                              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2364748b' stroke-width='1.5' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
                              backgroundRepeat: "no-repeat",
                              backgroundPosition: "right 8px center",
                              backgroundColor:
                                u.role === "admin"
                                  ? "rgba(245,158,11,0.12)"
                                  : u.role === "tech"
                                    ? "rgba(16,185,129,0.12)"
                                    : "rgba(99,102,241,0.08)",
                              color:
                                u.role === "admin"
                                  ? "#f59e0b"
                                  : u.role === "tech"
                                    ? "#10b981"
                                    : "var(--text-secondary)",
                              cursor:
                                u.id === user.id ? "not-allowed" : "pointer",
                              opacity: u.id === user.id ? 0.5 : 1,
                              fontFamily: "inherit",
                              touchAction: "manipulation",
                              /* Override global width:100% so narrow table cell doesn't collapse text */
                              width: "auto",
                              minWidth: 88,
                            }}
                          >
                            {/* No emojis — they render broken in styled <select> on iOS */}
                            <option value="admin">Admin</option>
                            <option value="tech">Tech</option>
                            <option value="user">User</option>
                          </select>
                        </td>
                        <td
                          style={{ fontSize: 12, color: "var(--text-muted)" }}
                        >
                          {new Date(u.created_at).toLocaleDateString()}
                        </td>
                        <td>
                          <div
                            style={{
                              display: "flex",
                              gap: 4,
                              alignItems: "center",
                            }}
                          >
                            <input
                              type="password"
                              aria-label={`New password for ${u.display_name}`}
                              name={`reset_password_${u.id}`}
                              autoComplete="new-password"
                              placeholder="New pass"
                              value={resetPasswords[u.id] || ""}
                              onChange={(e) =>
                                setResetPasswords((p) => ({
                                  ...p,
                                  [u.id]: e.target.value,
                                }))
                              }
                              style={{
                                background: "var(--bg-card)",
                                border: "1px solid var(--border)",
                                borderRadius: 6,
                                padding: "3px 6px",
                                fontSize: 11,
                                color: "var(--text-primary)",
                                width: 90,
                              }}
                            />
                            <button
                              className="btn btn-sm btn-outline"
                              aria-label={`Reset password for ${u.display_name}`}
                              onClick={() => handleResetPassword(u.id)}
                              disabled={userActionLoading === `reset-${u.id}`}
                              title="Reset password"
                            >
                              {userActionLoading === `reset-${u.id}` ? (
                                <span className="btn-spinner" />
                              ) : (
                                <RiLockLine />
                              )}
                            </button>
                          </div>
                        </td>
                        <td>
                          {u.id !== user.id && (
                            <button
                              className="btn btn-sm btn-danger"
                              aria-label={`Delete user ${u.display_name}`}
                              onClick={() => handleDeleteUser(u.id, u.username)}
                              disabled={userActionLoading === `delete-${u.id}`}
                              title="Delete user"
                            >
                              {userActionLoading === `delete-${u.id}` ? (
                                <span className="btn-spinner" />
                              ) : (
                                <RiDeleteBinLine />
                              )}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* ====== AUDIT LOG TAB ====== */}
        {activeTab === "audit" && (
          <>
            {auditError && (
              <div
                aria-live="polite"
                style={{
                  padding: "10px 16px",
                  background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 8,
                  marginBottom: 16,
                  fontSize: 13,
                  color: "var(--error)",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                {auditError}
                <button
                  aria-label="Dismiss audit error message"
                  onClick={() => setAuditError("")}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--error)",
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>
            )}
            {auditFetching ? (
              <div className="loading-spinner">
                <div className="spinner" />
              </div>
            ) : !auditError && auditLogs.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📋</div>
                <h3>No audit logs yet</h3>
                <p>Admin actions will be recorded here</p>
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Admin</th>
                      <th>Action</th>
                      <th>Target</th>
                      <th>Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td
                          style={{
                            fontSize: 12,
                            color: "var(--text-secondary)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {timeAgo(log.created_at)}
                        </td>
                        <td style={{ fontWeight: 500 }}>{log.user_name}</td>
                        <td>{actionBadge(log.action)}</td>
                        <td style={{ fontSize: 12 }}>
                          {log.target_type} #{log.target_id}
                        </td>
                        <td
                          style={{
                            fontSize: 12,
                            color: "var(--text-secondary)",
                            maxWidth: 300,
                          }}
                        >
                          {log.details}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {/* ====== TEMPLATES TAB ====== */}
        {activeTab === "templates" && (
          <>
            {templateMsg && (
              <div
                aria-live="polite"
                style={{
                  padding: "10px 16px",
                  background: "rgba(99,102,241,0.08)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  marginBottom: 16,
                  fontSize: 13,
                  color: "var(--text-primary)",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                {templateMsg}
                <button
                  aria-label="Dismiss template message"
                  onClick={() => setTemplateMsg("")}
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                  }}
                >
                  ✕
                </button>
              </div>
            )}

            {/* Create / Edit form */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 20,
                marginBottom: 24,
              }}
            >
              <h3
                style={{
                  margin: "0 0 16px 0",
                  fontSize: 15,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <RiBookmarkLine />{" "}
                {editingTemplate ? "Edit Template" : "New Template"}
              </h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 12,
                }}
              >
                <input
                  aria-label="Template name"
                  name="template_name"
                  autoComplete="off"
                  value={templateForm.name}
                  onChange={(e) =>
                    setTemplateForm((p) => ({ ...p, name: e.target.value }))
                  }
                  placeholder="Template name (e.g. Sunday Setup Kit)"
                  style={{
                    padding: "9px 12px",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontSize: 13,
                  }}
                />
                <select
                  value={templateForm.loan_type}
                  onChange={(e) =>
                    setTemplateForm((p) => ({
                      ...p,
                      loan_type: e.target.value,
                    }))
                  }
                  style={{
                    padding: "9px 36px 9px 12px",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontSize: 16,
                  }}
                >
                  <option value="temporary">Temporary</option>
                  <option value="permanent">Permanent</option>
                </select>
              </div>
              <input
                aria-label="Template description"
                name="template_description"
                autoComplete="off"
                value={templateForm.description}
                onChange={(e) =>
                  setTemplateForm((p) => ({
                    ...p,
                    description: e.target.value,
                  }))
                }
                placeholder="Description (optional)"
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--text-primary)",
                  fontSize: 13,
                  marginBottom: 12,
                  boxSizing: "border-box",
                }}
              />

              {/* Item picker */}
              <div style={{ marginBottom: 10 }}>
                <input
                  aria-label="Search inventory items for template"
                  name="template_item_search"
                  autoComplete="off"
                  value={templateItemSearch}
                  onChange={(e) => setTemplateItemSearch(e.target.value)}
                  placeholder="Search items to add…"
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontSize: 13,
                    boxSizing: "border-box",
                  }}
                />
              </div>
              {templateItemSearch && (
                <div
                  style={{
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    maxHeight: 160,
                    overflowY: "auto",
                    marginBottom: 10,
                  }}
                >
                  {allItems
                    .filter(
                      (i) =>
                        i.item
                          .toLowerCase()
                          .includes(templateItemSearch.toLowerCase()) &&
                        !templateForm.items.find((ti) => ti.item_id === i.id),
                    )
                    .slice(0, 8)
                    .map((i) => (
                      <div
                        key={i.id}
                        onClick={() => {
                          setTemplateForm((p) => ({
                            ...p,
                            items: [
                              ...p.items,
                              { item_id: i.id, item_name: i.item, quantity: 1 },
                            ],
                          }));
                          setTemplateItemSearch("");
                        }}
                        style={{
                          padding: "8px 12px",
                          cursor: "pointer",
                          fontSize: 13,
                          borderBottom: "1px solid var(--border)",
                        }}
                        onMouseEnter={(e) =>
                          (e.currentTarget.style.background =
                            "rgba(99,102,241,0.08)")
                        }
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = "transparent")
                        }
                      >
                        {i.item}{" "}
                        <span
                          style={{ color: "var(--text-muted)", fontSize: 11 }}
                        >
                          ({i.type})
                        </span>
                      </div>
                    ))}
                </div>
              )}

              {/* Selected items */}
              {templateForm.items.length > 0 && (
                <div
                  style={{
                    marginBottom: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  {templateForm.items.map((ti, idx) => (
                    <div
                      key={ti.item_id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 10px",
                        background: "rgba(99,102,241,0.06)",
                        borderRadius: 8,
                        fontSize: 13,
                      }}
                    >
                      <span style={{ flex: 1 }}>{ti.item_name}</span>
                      <input
                        type="number"
                        min={1}
                        value={ti.quantity}
                        onChange={(e) =>
                          setTemplateForm((p) => ({
                            ...p,
                            items: p.items.map((x, i) =>
                              i === idx
                                ? {
                                    ...x,
                                    quantity: parseInt(e.target.value) || 1,
                                  }
                                : x,
                            ),
                          }))
                        }
                        style={{
                          width: 60,
                          padding: "4px 8px",
                          background: "var(--bg-card)",
                          border: "1px solid var(--border)",
                          borderRadius: 6,
                          color: "var(--text-primary)",
                          fontSize: 12,
                          textAlign: "center",
                        }}
                      />
                      <button
                        aria-label={`Remove ${ti.item_name} from template`}
                        onClick={() =>
                          setTemplateForm((p) => ({
                            ...p,
                            items: p.items.filter((_, i) => i !== idx),
                          }))
                        }
                        style={{
                          background: "none",
                          border: "none",
                          color: "var(--error)",
                          cursor: "pointer",
                          fontSize: 14,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={async () => {
                    if (
                      !templateForm.name.trim() ||
                      templateForm.items.length === 0
                    ) {
                      setTemplateMsg("Name and at least one item are required");
                      return;
                    }
                    const res = await fetch("/api/admin/templates", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        action: editingTemplate ? "update" : "create",
                        id: editingTemplate,
                        ...templateForm,
                      }),
                    });
                    const data = await res.json();
                    setTemplateMsg(data.message || data.error);
                    if (res.ok) {
                      toast.success(
                        editingTemplate ? "Template saved" : "Template created",
                      );
                      // Optimistically update the UI
                      if (editingTemplate) {
                        setTemplates((prev) =>
                          prev.map((t) =>
                            t.id === editingTemplate
                              ? { ...t, ...templateForm }
                              : t,
                          ),
                        );
                      } else {
                        // Use a temporary ID for the optimistic new template until fetchTemplates completes
                        setTemplates((prev) => [
                          ...prev,
                          { id: "temp-" + Date.now(), ...templateForm },
                        ]);
                      }

                      setTemplateForm({
                        name: "",
                        description: "",
                        loan_type: "temporary",
                        items: [],
                      });
                      setEditingTemplate(null);
                      fetchTemplates();
                    } else {
                      toast.error(data.error || "Failed to save template");
                    }
                  }}
                >
                  <RiAddLine />{" "}
                  {editingTemplate ? "Save Changes" : "Create Template"}
                </button>
                {editingTemplate && (
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => {
                      setEditingTemplate(null);
                      setTemplateForm({
                        name: "",
                        description: "",
                        loan_type: "temporary",
                        items: [],
                      });
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>

            {/* Template list */}
            {templatesFetching ? (
              <div className="loading-spinner">
                <div className="spinner" />
              </div>
            ) : templates.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">📋</div>
                <h3>No templates yet</h3>
                <p>Create preset item bundles users can request in one click</p>
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={templates.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 12,
                    }}
                  >
                    {templates.map((t) => (
                      <SortableTemplateItem
                        key={t.id}
                        t={t}
                        onEdit={(t) => {
                          setEditingTemplate(t.id);
                          setTemplateForm({
                            name: t.name,
                            description: t.description,
                            loan_type: t.loan_type,
                            items: t.items,
                          });
                        }}
                        onDelete={async (t) => {
                          if (!confirm(`Delete template "${t.name}"?`)) return;

                          // Optimistically remove the template
                          setTemplates((prev) =>
                            prev.filter((x) => x.id !== t.id),
                          );

                          const res = await fetch("/api/admin/templates", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              action: "delete",
                              id: t.id,
                            }),
                          });
                          if (res.ok) {
                            toast.success(`Template "${t.name}" deleted`);
                          } else {
                            toast.error("Failed to delete template");
                          }
                          fetchTemplates();
                        }}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}
          </>
        )}
        {/* ====== LAPTOPS TAB ====== */}
        {activeTab === "laptops" && (
          <>
            {/* Perm Loan Modal */}
            {permLoanModal && (
              <div
                style={{
                  position: "fixed",
                  inset: 0,
                  background: "rgba(0,0,0,0.6)",
                  zIndex: 1000,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 16,
                }}
                onClick={(e) =>
                  e.target === e.currentTarget && setPermLoanModal(null)
                }
              >
                <div
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    borderRadius: 16,
                    padding: 24,
                    width: "100%",
                    maxWidth: 420,
                  }}
                >
                  <h3 style={{ margin: "0 0 16px", fontSize: 16 }}>
                    {permLoanModal.is_perm_loaned
                      ? "Remove Perm Loan"
                      : "Mark as Perm Loaned"}
                    : {permLoanModal.name}
                  </h3>
                  {!permLoanModal.is_perm_loaned && (
                    <>
                      <input
                        placeholder="Person's name (optional)"
                        value={permLoanModal.perm_loan_person || ""}
                        onChange={(e) =>
                          setPermLoanModal((p) => ({
                            ...p,
                            perm_loan_person: e.target.value,
                          }))
                        }
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          background: "var(--bg-secondary)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          color: "var(--text-primary)",
                          fontSize: 13,
                          marginBottom: 8,
                          boxSizing: "border-box",
                        }}
                      />
                      <input
                        placeholder="Reason / ministry (optional)"
                        value={permLoanModal.perm_loan_reason || ""}
                        onChange={(e) =>
                          setPermLoanModal((p) => ({
                            ...p,
                            perm_loan_reason: e.target.value,
                          }))
                        }
                        style={{
                          width: "100%",
                          padding: "8px 12px",
                          background: "var(--bg-secondary)",
                          border: "1px solid var(--border)",
                          borderRadius: 8,
                          color: "var(--text-primary)",
                          fontSize: 13,
                          marginBottom: 16,
                          boxSizing: "border-box",
                        }}
                      />
                    </>
                  )}
                  {permLoanModal.is_perm_loaned && (
                    <p
                      style={{
                        fontSize: 13,
                        color: "var(--text-secondary)",
                        marginBottom: 16,
                      }}
                    >
                      This will mark the laptop as available again.
                    </p>
                  )}
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      justifyContent: "flex-end",
                    }}
                  >
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => setPermLoanModal(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn-sm btn-primary"
                      disabled={
                        laptopActionLoading === `perm-${permLoanModal.id}`
                      }
                      style={{
                        background: permLoanModal.is_perm_loaned
                          ? "linear-gradient(135deg, #10b981, #059669)"
                          : "linear-gradient(135deg, #f59e0b, #d97706)",
                      }}
                      onClick={async () => {
                        setLaptopActionLoading(`perm-${permLoanModal.id}`);
                        const newPermState = !permLoanModal.is_perm_loaned;
                        try {
                          const res = await fetch(
                            `/api/laptops/${permLoanModal.id}`,
                            {
                              method: "PUT",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                is_perm_loaned: newPermState,
                                perm_loan_person: newPermState
                                  ? permLoanModal.perm_loan_person || null
                                  : null,
                                perm_loan_reason: newPermState
                                  ? permLoanModal.perm_loan_reason || null
                                  : null,
                              }),
                            },
                          );
                          if (res.ok) {
                            toast.success(
                              newPermState
                                ? "Marked as permanently loaned"
                                : "Perm loan removed",
                            );
                            setPermLoanModal(null);
                            fetchLaptopsData();
                          } else {
                            const d = await res.json().catch(() => ({}));
                            toast.error(d.error || "Failed to update");
                          }
                        } catch {
                          toast.error("Network error");
                        } finally {
                          setLaptopActionLoading(null);
                        }
                      }}
                    >
                      {laptopActionLoading === `perm-${permLoanModal.id}` ? (
                        <span className="btn-spinner" />
                      ) : permLoanModal.is_perm_loaned ? (
                        "Remove Perm Loan"
                      ) : (
                        "Confirm Perm Loan"
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Currently Out */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: 20,
                marginBottom: 24,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 16,
                }}
              >
                <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
                  💻 Currently Out
                </h3>
                <button
                  className="btn btn-sm btn-outline"
                  onClick={fetchCurrentlyOut}
                >
                  Refresh
                </button>
              </div>
              {currentlyOutFetching ? (
                <div className="loading-spinner">
                  <div className="spinner" />
                </div>
              ) : currentlyOut.length === 0 ? (
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text-muted)",
                    margin: 0,
                  }}
                >
                  All laptops are currently in.
                </p>
              ) : (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 0,
                    borderRadius: 10,
                    overflow: "hidden",
                    border: "1px solid var(--border)",
                  }}
                >
                  {(() => {
                    const today = new Date().toISOString().split("T")[0];
                    const in3Days = new Date();
                    in3Days.setDate(in3Days.getDate() + 3);
                    const in3DaysStr = in3Days.toISOString().split("T")[0];
                    return currentlyOut.map((loan, i) => {
                      const laptopNames = (loan.laptops || [])
                        .map(
                          (item) =>
                            item.laptops?.name || `Laptop #${item.laptop_id}`,
                        )
                        .join(", ");
                      const isOverdue =
                        loan.loan_type === "temporary" &&
                        loan.end_date &&
                        loan.end_date < today;
                      const isDueSoon =
                        !isOverdue &&
                        loan.loan_type === "temporary" &&
                        loan.end_date &&
                        loan.end_date >= today &&
                        loan.end_date <= in3DaysStr;
                      const isPerm = loan.loan_type === "permanent";
                      return (
                        <div
                          key={loan.id}
                          style={{
                            padding: "12px 14px",
                            borderBottom:
                              i < currentlyOut.length - 1
                                ? "1px solid var(--border)"
                                : "none",
                            background: isOverdue
                              ? "rgba(239,68,68,0.05)"
                              : isDueSoon
                                ? "rgba(245,158,11,0.04)"
                                : "transparent",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "flex-start",
                              justifyContent: "space-between",
                              gap: 8,
                            }}
                          >
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div
                                style={{
                                  fontSize: 13,
                                  fontWeight: 600,
                                  marginBottom: 2,
                                }}
                              >
                                {laptopNames || "—"}
                              </div>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: "var(--text-secondary)",
                                }}
                              >
                                {loan.requester_name || "—"}
                                {loan.department ? (
                                  <span style={{ color: "var(--text-muted)" }}>
                                    {" "}
                                    · {loan.department}
                                  </span>
                                ) : null}
                              </div>
                              {loan.purpose && (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: "var(--text-muted)",
                                    marginTop: 2,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                >
                                  {loan.purpose}
                                </div>
                              )}
                            </div>
                            <div
                              style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "flex-end",
                                gap: 4,
                                flexShrink: 0,
                              }}
                            >
                              {isOverdue ? (
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    padding: "3px 8px",
                                    borderRadius: 20,
                                    background: "rgba(239,68,68,0.15)",
                                    color: "#ef4444",
                                    border: "1px solid rgba(239,68,68,0.3)",
                                  }}
                                >
                                  ⚠ Overdue
                                </span>
                              ) : isDueSoon ? (
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    padding: "3px 8px",
                                    borderRadius: 20,
                                    background: "rgba(245,158,11,0.15)",
                                    color: "#f59e0b",
                                    border: "1px solid rgba(245,158,11,0.3)",
                                  }}
                                >
                                  ⏰ Due Soon
                                </span>
                              ) : isPerm ? (
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    padding: "3px 8px",
                                    borderRadius: 20,
                                    background: "rgba(139,92,246,0.12)",
                                    color: "#8b5cf6",
                                    border: "1px solid rgba(139,92,246,0.25)",
                                  }}
                                >
                                  Permanent
                                </span>
                              ) : (
                                <span
                                  style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    padding: "3px 8px",
                                    borderRadius: 20,
                                    background: "rgba(16,185,129,0.12)",
                                    color: "#10b981",
                                    border: "1px solid rgba(16,185,129,0.25)",
                                  }}
                                >
                                  Out
                                </span>
                              )}
                              <span
                                style={{
                                  fontSize: 11,
                                  color: isOverdue
                                    ? "#ef4444"
                                    : "var(--text-muted)",
                                  fontWeight: isOverdue ? 700 : 400,
                                }}
                              >
                                {isPerm
                                  ? "No return date"
                                  : loan.end_date || "—"}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    });
                  })()}
                </div>
              )}
            </div>

            {/* Tier Management */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 16,
                marginBottom: 20,
              }}
            >
              <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>Tiers</h3>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                {laptopsData.map((tier) => (
                  <div
                    key={tier.id}
                    style={{ display: "flex", alignItems: "center", gap: 8 }}
                  >
                    {editingTier?.id === tier.id ? (
                      <>
                        <input
                          value={editingTier.name}
                          onChange={(e) =>
                            setEditingTier((p) => ({
                              ...p,
                              name: e.target.value,
                            }))
                          }
                          style={{
                            flex: 1,
                            padding: "6px 10px",
                            background: "var(--bg-secondary)",
                            border: "1px solid var(--accent)",
                            borderRadius: 8,
                            color: "var(--text-primary)",
                            fontSize: 13,
                          }}
                        />
                        <button
                          className="btn btn-sm btn-primary"
                          disabled={laptopActionLoading === `tier-${tier.id}`}
                          onClick={async () => {
                            setLaptopActionLoading(`tier-${tier.id}`);
                            try {
                              const res = await fetch(
                                `/api/laptops/tiers/${tier.id}`,
                                {
                                  method: "PUT",
                                  headers: {
                                    "Content-Type": "application/json",
                                  },
                                  body: JSON.stringify({
                                    name: editingTier.name,
                                  }),
                                },
                              );
                              if (res.ok) {
                                toast.success("Tier renamed");
                                setEditingTier(null);
                                fetchLaptopsData();
                              } else {
                                const d = await res.json().catch(() => ({}));
                                toast.error(d.error || "Failed");
                              }
                            } catch {
                              toast.error("Network error");
                            } finally {
                              setLaptopActionLoading(null);
                            }
                          }}
                        >
                          {laptopActionLoading === `tier-${tier.id}` ? (
                            <span className="btn-spinner" />
                          ) : (
                            "Save"
                          )}
                        </button>
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => setEditingTier(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <span
                          style={{ flex: 1, fontSize: 13, fontWeight: 500 }}
                        >
                          {tier.name}
                        </span>
                        <span
                          style={{ fontSize: 11, color: "var(--text-muted)" }}
                        >
                          {tier.laptops?.length || 0} laptops
                        </span>
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() =>
                            setEditingTier({ id: tier.id, name: tier.name })
                          }
                        >
                          Rename
                        </button>
                        <button
                          className="btn btn-sm"
                          style={{
                            color: "var(--error)",
                            background: "none",
                            border: "1px solid rgba(239,68,68,0.3)",
                            fontSize: 11,
                          }}
                          onClick={async () => {
                            if (
                              !confirm(
                                `Delete tier "${tier.name}"? Laptops will become untiered.`,
                              )
                            )
                              return;
                            setLaptopActionLoading(`tier-del-${tier.id}`);
                            try {
                              const res = await fetch(
                                `/api/laptops/tiers/${tier.id}`,
                                { method: "DELETE" },
                              );
                              if (res.ok) {
                                toast.success("Tier deleted");
                                fetchLaptopsData();
                              } else {
                                const d = await res.json().catch(() => ({}));
                                toast.error(d.error || "Failed");
                              }
                            } catch {
                              toast.error("Network error");
                            } finally {
                              setLaptopActionLoading(null);
                            }
                          }}
                        >
                          <RiDeleteBinLine />
                        </button>
                      </>
                    )}
                  </div>
                ))}
                {laptopsData.length === 0 && (
                  <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                    No tiers yet. Add one below.
                  </p>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={tierInput}
                  onChange={(e) => setTierInput(e.target.value)}
                  placeholder="New tier name (e.g. MacBook Pro)"
                  style={{
                    flex: 1,
                    padding: "7px 10px",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontSize: 13,
                  }}
                />
                <button
                  className="btn btn-sm btn-primary"
                  disabled={
                    !tierInput.trim() || laptopActionLoading === "tier-new"
                  }
                  onClick={async () => {
                    setLaptopActionLoading("tier-new");
                    try {
                      const res = await fetch("/api/laptops/tiers", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name: tierInput.trim() }),
                      });
                      if (res.ok) {
                        toast.success("Tier created");
                        setTierInput("");
                        fetchLaptopsData();
                      } else {
                        const d = await res.json().catch(() => ({}));
                        toast.error(d.error || "Failed");
                      }
                    } catch {
                      toast.error("Network error");
                    } finally {
                      setLaptopActionLoading(null);
                    }
                  }}
                >
                  <RiAddLine /> Add Tier
                </button>
              </div>
            </div>

            {/* Add / Edit Laptop Form */}
            <div
              style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 20,
                marginBottom: 24,
              }}
            >
              <h3 style={{ margin: "0 0 16px", fontSize: 15 }}>
                {editingLaptop ? "Edit Laptop" : "Add Laptop"}
              </h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                  marginBottom: 10,
                }}
              >
                <input
                  placeholder='Name (e.g. MacBook Pro 16")'
                  value={laptopForm.name}
                  onChange={(e) =>
                    setLaptopForm((p) => ({ ...p, name: e.target.value }))
                  }
                  style={{
                    padding: "8px 12px",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontSize: 13,
                  }}
                />
                <select
                  value={laptopForm.tier_id}
                  onChange={(e) =>
                    setLaptopForm((p) => ({ ...p, tier_id: e.target.value }))
                  }
                  style={{
                    padding: "8px 12px",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontSize: 13,
                  }}
                >
                  <option value="">No tier</option>
                  {laptopsData.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <input
                  placeholder="Screen size (e.g. 14-inch)"
                  value={laptopForm.screen_size}
                  onChange={(e) =>
                    setLaptopForm((p) => ({
                      ...p,
                      screen_size: e.target.value,
                    }))
                  }
                  style={{
                    padding: "8px 12px",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontSize: 13,
                  }}
                />
                <input
                  placeholder="CPU (e.g. M3 Pro)"
                  value={laptopForm.cpu}
                  onChange={(e) =>
                    setLaptopForm((p) => ({ ...p, cpu: e.target.value }))
                  }
                  style={{
                    padding: "8px 12px",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontSize: 13,
                  }}
                />
                <input
                  placeholder="RAM (e.g. 16GB)"
                  value={laptopForm.ram}
                  onChange={(e) =>
                    setLaptopForm((p) => ({ ...p, ram: e.target.value }))
                  }
                  style={{
                    padding: "8px 12px",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontSize: 13,
                  }}
                />
                <input
                  placeholder="Storage (e.g. 512GB SSD)"
                  value={laptopForm.storage}
                  onChange={(e) =>
                    setLaptopForm((p) => ({ ...p, storage: e.target.value }))
                  }
                  style={{
                    padding: "8px 12px",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontSize: 13,
                  }}
                />
                <select
                  value={laptopForm.condition}
                  onChange={(e) =>
                    setLaptopForm((p) => ({ ...p, condition: e.target.value }))
                  }
                  style={{
                    padding: "8px 12px",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontSize: 13,
                  }}
                >
                  <option value="Excellent">Excellent</option>
                  <option value="Good">Good</option>
                  <option value="Fair">Fair</option>
                </select>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={
                    !laptopForm.name.trim() ||
                    laptopActionLoading === "laptop-save"
                  }
                  onClick={async () => {
                    setLaptopActionLoading("laptop-save");
                    try {
                      const url = editingLaptop
                        ? `/api/laptops/${editingLaptop}`
                        : "/api/laptops";
                      const method = editingLaptop ? "PUT" : "POST";
                      const res = await fetch(url, {
                        method,
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          ...laptopForm,
                          tier_id: laptopForm.tier_id || null,
                        }),
                      });
                      if (res.ok) {
                        toast.success(
                          editingLaptop ? "Laptop updated" : "Laptop added",
                        );
                        setLaptopForm({
                          name: "",
                          screen_size: "",
                          cpu: "",
                          ram: "",
                          storage: "",
                          condition: "Good",
                          tier_id: "",
                        });
                        setEditingLaptop(null);
                        fetchLaptopsData();
                      } else {
                        const d = await res.json().catch(() => ({}));
                        toast.error(d.error || "Failed to save");
                      }
                    } catch {
                      toast.error("Network error");
                    } finally {
                      setLaptopActionLoading(null);
                    }
                  }}
                >
                  <RiAddLine /> {editingLaptop ? "Save Changes" : "Add Laptop"}
                </button>
                {editingLaptop && (
                  <button
                    className="btn btn-sm btn-outline"
                    onClick={() => {
                      setEditingLaptop(null);
                      setLaptopForm({
                        name: "",
                        screen_size: "",
                        cpu: "",
                        ram: "",
                        storage: "",
                        condition: "Good",
                        tier_id: "",
                      });
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>

            {/* Laptops List by Tier */}
            {laptopsFetching ? (
              <div>
                {[1, 2, 3].map((i) => (
                  <div key={i} className="skeleton skeleton-row" />
                ))}
              </div>
            ) : laptopsData.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">💻</div>
                <h3>No laptops yet</h3>
                <p>Add tiers and laptops above to get started</p>
              </div>
            ) : (
              laptopsData.map((tier) => (
                <div key={tier.id} style={{ marginBottom: 24 }}>
                  <h3
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--text-secondary)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      marginBottom: 10,
                    }}
                  >
                    {tier.name}{" "}
                    <span style={{ fontWeight: 400, fontSize: 12 }}>
                      ({tier.laptops?.length || 0})
                    </span>
                  </h3>
                  {!tier.laptops || tier.laptops.length === 0 ? (
                    <p
                      style={{
                        fontSize: 13,
                        color: "var(--text-muted)",
                        padding: "8px 0",
                      }}
                    >
                      No laptops in this tier
                    </p>
                  ) : (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {tier.laptops.map((laptop) => (
                        <div
                          key={laptop.id}
                          style={{
                            background: "var(--bg-card)",
                            border: "1px solid var(--border)",
                            borderRadius: 12,
                            padding: 14,
                            display: "flex",
                            gap: 12,
                            alignItems: "flex-start",
                            flexWrap: "wrap",
                          }}
                        >
                          <div style={{ flex: 1, minWidth: 180 }}>
                            <div
                              style={{
                                fontWeight: 600,
                                fontSize: 14,
                                marginBottom: 4,
                              }}
                            >
                              {laptop.name}
                              {laptop.is_perm_loaned && (
                                <span
                                  className="badge"
                                  style={{
                                    marginLeft: 8,
                                    background: "rgba(239,68,68,0.15)",
                                    color: "#f87171",
                                    fontSize: 10,
                                  }}
                                >
                                  📌 Perm Loaned
                                </span>
                              )}
                            </div>
                            <div
                              style={{
                                fontSize: 12,
                                color: "var(--text-secondary)",
                                display: "flex",
                                flexWrap: "wrap",
                                gap: "4px 12px",
                              }}
                            >
                              {laptop.screen_size && (
                                <span>{laptop.screen_size}</span>
                              )}
                              {laptop.cpu && <span>{laptop.cpu}</span>}
                              {laptop.ram && <span>{laptop.ram}</span>}
                              {laptop.storage && <span>{laptop.storage}</span>}
                              {laptop.condition && (
                                <span
                                  style={{
                                    color:
                                      laptop.condition === "Excellent"
                                        ? "#10b981"
                                        : laptop.condition === "Good"
                                          ? "#6366f1"
                                          : "#f59e0b",
                                  }}
                                >
                                  {laptop.condition}
                                </span>
                              )}
                            </div>
                            {laptop.is_perm_loaned &&
                              laptop.perm_loan_person && (
                                <div
                                  style={{
                                    fontSize: 11,
                                    color: "var(--text-muted)",
                                    marginTop: 4,
                                  }}
                                >
                                  → {laptop.perm_loan_person}
                                  {laptop.perm_loan_reason
                                    ? ` · ${laptop.perm_loan_reason}`
                                    : ""}
                                </div>
                              )}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              gap: 6,
                              flexWrap: "wrap",
                              alignItems: "center",
                            }}
                          >
                            <button
                              className="btn btn-sm btn-outline"
                              style={{ fontSize: 11 }}
                              onClick={() =>
                                setPermLoanModal({
                                  id: laptop.id,
                                  name: laptop.name,
                                  is_perm_loaned: laptop.is_perm_loaned,
                                  perm_loan_person:
                                    laptop.perm_loan_person || "",
                                  perm_loan_reason:
                                    laptop.perm_loan_reason || "",
                                })
                              }
                            >
                              {laptop.is_perm_loaned
                                ? "↩ Unmark Perm"
                                : "📌 Perm Loan"}
                            </button>
                            <button
                              className="btn btn-sm btn-outline"
                              style={{ fontSize: 11 }}
                              onClick={() => {
                                setEditingLaptop(laptop.id);
                                setLaptopForm({
                                  name: laptop.name,
                                  screen_size: laptop.screen_size || "",
                                  cpu: laptop.cpu || "",
                                  ram: laptop.ram || "",
                                  storage: laptop.storage || "",
                                  condition: laptop.condition || "Good",
                                  tier_id: laptop.tier_id
                                    ? String(laptop.tier_id)
                                    : "",
                                });
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }}
                            >
                              Edit
                            </button>
                            <button
                              className="btn btn-sm"
                              style={{
                                color: "var(--error)",
                                background: "none",
                                border: "1px solid rgba(239,68,68,0.3)",
                                fontSize: 11,
                              }}
                              disabled={
                                laptopActionLoading === `del-${laptop.id}`
                              }
                              onClick={async () => {
                                if (
                                  !confirm(
                                    `Delete laptop "${laptop.name}"? This cannot be undone.`,
                                  )
                                )
                                  return;
                                setLaptopActionLoading(`del-${laptop.id}`);
                                try {
                                  const res = await fetch(
                                    `/api/laptops/${laptop.id}`,
                                    { method: "DELETE" },
                                  );
                                  if (res.ok) {
                                    toast.success("Laptop deleted");
                                    fetchLaptopsData();
                                  } else {
                                    const d = await res
                                      .json()
                                      .catch(() => ({}));
                                    toast.error(d.error || "Failed");
                                  }
                                } catch {
                                  toast.error("Network error");
                                } finally {
                                  setLaptopActionLoading(null);
                                }
                              }}
                            >
                              <RiDeleteBinLine />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </>
        )}
      </div>
    </>
  );
}

export default function AdminPage() {
  return <AdminPageContent />;
}
