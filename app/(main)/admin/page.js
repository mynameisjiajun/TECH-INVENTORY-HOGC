"use client";
import { useAuth } from "@/lib/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { supabaseClient } from "@/lib/db/supabaseClient";
import { useToast } from "@/lib/context/ToastContext";
import Navbar from "@/components/Navbar";
import CartPanel from "@/components/CartPanel";
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
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingLeft: 34 }}>
        {t.items.map((item) => (
          <span key={item.item_id} className="loan-item-chip">
            {item.item_name} × {item.quantity}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [loans, setLoans] = useState([]);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [fetching, setFetching] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [adminNotes, setAdminNotes] = useState({});
  const [selectedLoans, setSelectedLoans] = useState(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [selectedPendingLoans, setSelectedPendingLoans] = useState(new Set());
  const [bulkApproveLoading, setBulkApproveLoading] = useState(false);
  const [userActionLoading, setUserActionLoading] = useState(null);
  const [inviteCodeLoading, setInviteCodeLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("loans");
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditFetching, setAuditFetching] = useState(false);
  const [users, setUsers] = useState([]);
  const [usersFetching, setUsersFetching] = useState(false);
  const [resetPasswords, setResetPasswords] = useState({});
  const [userMsg, setUserMsg] = useState("");
  const [error, setError] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [inviteCodeInput, setInviteCodeInput] = useState("");
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

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
    if (!loading && user && user.role !== "admin") router.replace("/dashboard");
  }, [user, loading, router]);

  const fetchLoans = useCallback(async () => {
    setFetching(true);
    setError("");
    try {
      const params = new URLSearchParams({ view: "all", status: statusFilter });
      const res = await fetch(`/api/loans?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLoans(data.loans);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Failed to load loans (${res.status})`);
      }
    } catch (err) {
      setError("Network error — could not load loans");
    } finally {
      setFetching(false);
    }
  }, [statusFilter]);

  const fetchAuditLogs = useCallback(async () => {
    setAuditFetching(true);
    try {
      const res = await fetch("/api/audit?limit=100");
      if (res.ok) {
        const data = await res.json();
        setAuditLogs(data.logs);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || `Failed to load audit logs (${res.status})`);
      }
    } catch (err) {
      setError("Network error — could not load audit logs");
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
      const res = await fetch("/api/admin/templates");
      if (res.ok) {
        const data = await res.json();
        // Templates come back ordered correctly from the DB
        setTemplates(data.templates);
      }
    } catch {
      /* silent */
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
    })
  );

  const handleDragEnd = async (event) => {
    const { active, over } = event;

    if (active.id !== over.id) {
      setTemplates((items) => {
        const oldIndex = items.findIndex((t) => t.id === active.id);
        const newIndex = items.findIndex((t) => t.id === over.id);

        const newTemplates = arrayMove(items, oldIndex, newIndex);
        
        // Fire async request to save ordering
        fetch("/api/admin/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "reorder",
            orderedIds: newTemplates.map((t) => t.id),
          }),
        }).catch(() => {});

        return newTemplates;
      });
    }
  };

  const fetchAllItems = async () => {
    try {
      const res = await fetch("/api/items?tab=storage");
      if (res.ok) {
        const data = await res.json();
        setAllItems(data.items || []);
      }
    } catch {
      /* silent */
    }
  };

  useEffect(() => {
    if (user?.role === "admin") {
      if (activeTab === "loans") fetchLoans();
      if (activeTab === "audit") fetchAuditLogs();
      if (activeTab === "users") fetchUsers();
      if (activeTab === "templates") {
        fetchTemplates();
        fetchAllItems();
      }
    }
  }, [user, activeTab, fetchLoans, fetchAuditLogs, fetchUsers]);

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
          () => { fetchLoans(); }
        )
        .subscribe((_status, err) => {
          if (err) console.warn('Realtime unavailable, using polling fallback:', err.message);
        });
    } catch (err) {
      console.warn('Realtime not available on this device, using polling fallback:', err.message);
    }

    // Fallback poll every 60s in case Realtime drops
    const fallback = setInterval(fetchLoans, 60000);

    return () => {
      if (channel) supabaseClient.removeChannel(channel);
      clearInterval(fallback);
    };
  }, [user, activeTab, fetchLoans]);

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
                ? { ...l, status: action === "return" ? "returned" : action + "d" }
                : l
            )
          );
        }
        
        fetchLoans();
        setAdminNotes((p) => ({ ...p, [loanId]: "" }));
        toast.success(
          `Loan ${action === "approve" ? "approved" : action === "reject" ? "rejected" : action === "return" ? "returned" : action + "d"} successfully`
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
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_approve",
          loan_ids: Array.from(selectedPendingLoans),
        }),
      });
      if (res.ok) {
        setSelectedPendingLoans(new Set());
        fetchLoans();
        toast.success(`${selectedPendingLoans.size} loan(s) approved successfully`);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || `Bulk approve failed (${res.status})`);
      }
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
    const ids = loans
      .filter((l) => l.status === "approved" && l.loan_type === "temporary")
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
    const ids = loans.filter((l) => l.status === "pending").map((l) => l.id);
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
        body: JSON.stringify({ action: "reset_password", user_id: userId, new_password: pw }),
      });
      const data = await res.json();
      setUserMsg(data.message || data.error);
      if (res.ok) setResetPasswords((p) => ({ ...p, [userId]: "" }));
    } catch {
      setUserMsg("Network error — could not reset password");
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
        body: JSON.stringify({ action: "change_role", user_id: userId, new_role: newRole }),
      });
      const data = await res.json();
      setUserMsg(data.message || data.error);
      if (res.ok) fetchUsers();
    } catch {
      setUserMsg("Network error — could not change role");
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
      if (res.ok) fetchUsers();
    } catch {
      setUserMsg("Network error — could not delete user");
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
        body: JSON.stringify({ action: "set_invite_code", invite_code: inviteCodeInput.trim() }),
      });
      const data = await res.json();
      setUserMsg(data.message || data.error);
      if (res.ok) setInviteCode(inviteCodeInput.trim());
    } catch {
      setUserMsg("Network error — could not update invite code");
    } finally {
      setInviteCodeLoading(false);
    }
  };

  if (loading || !user)
    return (
      <div className="loading-spinner">
        <div className="spinner" />
      </div>
    );

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
          >
            📋 Loans
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
        </div>

        {error && (
          <div
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
            <div className="tabs" style={{ maxWidth: 600 }}>
              {["pending", "approved", "rejected", "returned", ""].map((s) => (
                <button
                  key={s}
                  className={`tab ${statusFilter === s ? "active" : ""}`}
                  onClick={() => {
                    setStatusFilter(s);
                    setSelectedLoans(new Set());
                  }}
                >
                  {s || "All"}
                </button>
              ))}
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
                <button className="btn btn-sm btn-outline" onClick={selectAllPending}>Select All</button>
                <button className="btn btn-sm btn-outline" onClick={() => setSelectedPendingLoans(new Set())}>Clear</button>
                <span style={{ flex: 1, fontSize: 13, color: "var(--text-secondary)" }}>
                  {selectedPendingLoans.size} selected
                </span>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={handleBulkApprove}
                  disabled={selectedPendingLoans.size === 0 || bulkApproveLoading}
                  style={{ background: "linear-gradient(135deg, #22c55e, #16a34a)" }}
                >
                  {bulkApproveLoading
                    ? <><span className="btn-spinner" /> Approving…</>
                    : <><RiCheckLine /> {`Bulk Approve (${selectedPendingLoans.size})`}</>}
                </button>
              </div>
            )}

            {statusFilter === "approved" &&
              loans.some((l) => l.loan_type === "temporary") && (
                <div
                  style={{
                    display: "flex",
                    gap: 8,
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
                {[1,2,3,4].map((i) => (
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
            ) : (
              loans.map((loan) => (
                <div key={loan.id} className="loan-card">
                  <div className="loan-card-header">
                    <div>
                      <div
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          marginBottom: 6,
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
                        {loan.status === "approved" &&
                          loan.end_date &&
                          new Date(loan.end_date) < new Date() && (
                            <span className="badge badge-error">
                              🚨 OVERDUE
                            </span>
                          )}
                      </div>
                      <p style={{ fontWeight: 600, fontSize: 15 }}>
                        {loan.requester_name}
                        <span
                          style={{
                            fontWeight: 400,
                            color: "var(--text-muted)",
                            marginLeft: 8,
                            fontSize: 12,
                          }}
                        >
                          @{loan.requester_username}
                        </span>
                      </p>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: 8,
                      }}
                    >
                      <span
                        style={{ fontSize: 12, color: "var(--text-muted)" }}
                      >
                        #{loan.id} ·{" "}
                        {new Date(loan.created_at).toLocaleDateString()}
                      </span>
                      {statusFilter === "pending" && (
                        <label
                          style={{ cursor: "pointer", display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)" }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedPendingLoans.has(loan.id)}
                            onChange={() => toggleSelectPending(loan.id)}
                            style={{ width: 18, height: 18, accentColor: "#22c55e", cursor: "pointer" }}
                          />
                          Select
                        </label>
                      )}
                      {statusFilter === "approved" &&
                        loan.loan_type === "temporary" && (
                          <label
                            style={{
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                              fontSize: 12,
                              color: "var(--text-secondary)",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={selectedLoans.has(loan.id)}
                              onChange={() => toggleSelect(loan.id)}
                              style={{
                                width: 18,
                                height: 18,
                                accentColor: "var(--accent)",
                                cursor: "pointer",
                              }}
                            />
                            Select
                          </label>
                        )}
                    </div>
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
                    {loan.department && <span>🏢 {loan.department}</span>}
                    <span>
                      📅 {loan.start_date}
                      {loan.end_date ? ` → ${loan.end_date}` : " → Ongoing"}
                    </span>
                  </div>
                  {loan.status === "pending" && (
                    <div style={{ marginTop: 12 }}>
                      <input
                        type="text"
                        className="admin-notes-input"
                        placeholder="Admin notes (optional)"
                        value={adminNotes[loan.id] || ""}
                        onChange={(e) =>
                          setAdminNotes((p) => ({
                            ...p,
                            [loan.id]: e.target.value,
                          }))
                        }
                      />
                      <div className="admin-actions">
                        <button
                          className="btn btn-success btn-sm"
                          onClick={() => handleAction(loan.id, "approve")}
                          disabled={actionLoading === loan.id}
                        >
                          {actionLoading === loan.id ? <span className="btn-spinner" /> : <><RiCheckLine /> Approve</>}
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => handleAction(loan.id, "reject")}
                          disabled={actionLoading === loan.id}
                        >
                          {actionLoading === loan.id ? <span className="btn-spinner" /> : <><RiCloseLine /> Reject</>}
                        </button>
                      </div>
                    </div>
                  )}
                  {loan.status === "approved" &&
                    loan.loan_type === "temporary" && (
                      <div style={{ marginTop: 12 }}>
                        <button
                          className="btn btn-outline btn-sm"
                          onClick={() => handleAction(loan.id, "return")}
                          disabled={actionLoading === loan.id}
                        >
                          {actionLoading === loan.id ? <><span className="btn-spinner" /> Returning…</> : <><RiArrowGoBackLine /> Mark as Returned</>}
                        </button>
                      </div>
                    )}
                  {loan.admin_notes && loan.status !== "pending" && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: 10,
                        background: "rgba(99,102,241,0.05)",
                        borderRadius: 8,
                        fontSize: 12,
                        color: "var(--text-secondary)",
                      }}
                    >
                      <strong>Admin notes:</strong> {loan.admin_notes}
                    </div>
                  )}
                  {loan.status === 'returned' && loan.return_photo_url && (
                    <div style={{ marginTop: 12, fontSize: 13 }}>
                      <a href={loan.return_photo_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <RiCameraLine /> View Proof of Return
                      </a>
                    </div>
                  )}
                  <div
                    style={{
                      marginTop: 8,
                      display: "flex",
                      justifyContent: "flex-end",
                    }}
                  >
                    <button
                      className="btn btn-sm"
                      disabled={actionLoading === loan.id}
                      style={{
                        color: "var(--error)",
                        background: "none",
                        border: "1px solid rgba(239,68,68,0.3)",
                        fontSize: 11,
                        padding: "4px 10px",
                      }}
                      onClick={() => {
                        if (
                          confirm(
                            `Delete loan #${loan.id}?${loan.status === "approved" ? " Stock will be restored." : ""}`,
                          )
                        ) {
                          handleAction(loan.id, "delete");
                        }
                      }}
                    >
                      <RiDeleteBinLine /> Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {/* ====== USERS TAB ====== */}
        {activeTab === "users" && (
          <>
            {userMsg && (
              <div
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
                  value={inviteCodeInput}
                  onChange={(e) => setInviteCodeInput(e.target.value)}
                  placeholder="Enter invite code"
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
                  disabled={inviteCodeInput.trim() === inviteCode || inviteCodeLoading}
                >
                  {inviteCodeLoading ? <><span className="btn-spinner" /> Saving…</> : "Update"}
                </button>
              </div>
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
                            <span style={{ fontSize: 12 }}>
                              {u.display_name}
                            </span>
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
                        <td style={{ fontSize: 11, color: "var(--text-secondary)", lineHeight: 1.4 }}>
                          {u.email ? (
                            <div>
                              <span title="Email">📧 {u.email}</span>
                            </div>
                          ) : null}
                          {u.telegram_chat_id ? (
                            <div>
                              <span title="Telegram Handle" style={{ color: "#3b82f6" }}>
                                💬 @{u.telegram_chat_id}
                              </span>
                            </div>
                          ) : null}
                          {!u.email && !u.telegram_chat_id && (
                            <span style={{ color: "var(--text-muted)" }}>-</span>
                          )}
                        </td>
                        <td>
                          <button
                            onClick={() =>
                              u.id !== user.id &&
                              handleChangeRole(
                                u.id,
                                u.role === "admin" ? "user" : "admin",
                              )
                            }
                            disabled={u.id === user.id}
                            title={
                              u.id === user.id
                                ? "Cannot change own role"
                                : `Change to ${u.role === "admin" ? "user" : "admin"}`
                            }
                            style={{
                              background:
                                u.role === "admin"
                                  ? "rgba(245,158,11,0.15)"
                                  : "rgba(99,102,241,0.1)",
                              border:
                                "1px solid " +
                                (u.role === "admin"
                                  ? "rgba(245,158,11,0.3)"
                                  : "var(--border)"),
                              borderRadius: 6,
                              padding: "4px 8px",
                              fontSize: 16,
                              cursor:
                                u.id === user.id ? "not-allowed" : "pointer",
                              opacity: u.id === user.id ? 0.5 : 1,
                              lineHeight: 1,
                              minWidth: 32,
                              textAlign: "center",
                            }}
                          >
                            {u.role === "admin" ? "🛡️" : "👤"}
                            <span
                              className="hide-mobile"
                              style={{
                                marginLeft: 4,
                                fontSize: 13,
                                color: "#fff",
                              }}
                            >
                              {u.role === "admin" ? "Admin" : "User"}
                            </span>
                          </button>
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
                              onClick={() => handleResetPassword(u.id)}
                              disabled={userActionLoading === `reset-${u.id}`}
                              title="Reset password"
                            >
                              {userActionLoading === `reset-${u.id}` ? <span className="btn-spinner" /> : <RiLockLine />}
                            </button>
                          </div>
                        </td>
                        <td>
                          {u.id !== user.id && (
                            <button
                              className="btn btn-sm btn-danger"
                              onClick={() => handleDeleteUser(u.id, u.username)}
                              disabled={userActionLoading === `delete-${u.id}`}
                              title="Delete user"
                            >
                              {userActionLoading === `delete-${u.id}` ? <span className="btn-spinner" /> : <RiDeleteBinLine />}
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
            {auditFetching ? (
              <div className="loading-spinner">
                <div className="spinner" />
              </div>
            ) : auditLogs.length === 0 ? (
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
                    padding: "9px 12px",
                    background: "var(--bg-secondary)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    color: "var(--text-primary)",
                    fontSize: 13,
                  }}
                >
                  <option value="temporary">⏱️ Temporary</option>
                  <option value="permanent">📌 Permanent</option>
                </select>
              </div>
              <input
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
                  value={templateItemSearch}
                  onChange={(e) => setTemplateItemSearch(e.target.value)}
                  placeholder="Search items to add..."
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
                      // Optimistically update the UI
                      if (editingTemplate) {
                        setTemplates(prev => prev.map(t => t.id === editingTemplate ? { ...t, ...templateForm } : t));
                      } else {
                        // Use a temporary ID for the optimistic new template until fetchTemplates completes
                        setTemplates(prev => [...prev, { id: "temp-" + Date.now(), ...templateForm }]);
                      }
                      
                      setTemplateForm({
                        name: "",
                        description: "",
                        loan_type: "temporary",
                        items: [],
                      });
                      setEditingTemplate(null);
                      fetchTemplates();
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
                    style={{ display: "flex", flexDirection: "column", gap: 12 }}
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
                          setTemplates(prev => prev.filter(x => x.id !== t.id));
                          
                          await fetch("/api/admin/templates", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                              action: "delete",
                              id: t.id,
                            }),
                          });
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
      </div>
    </>
  );
}
