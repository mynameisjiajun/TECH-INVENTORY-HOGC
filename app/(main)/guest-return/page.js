"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/lib/context/ToastContext";
import {
  RiSearch2Line,
  RiArrowLeftLine,
  RiUploadCloud2Line,
  RiArrowGoBackLine,
  RiShoppingCart2Line,
  RiUser3Line,
  RiCalendarLine,
  RiCheckboxCircleLine,
  RiBox3Line,
} from "react-icons/ri";

const C = {
  textPrimary:   "#f0f4fc",
  textSecondary: "#94a3b8",
  textMuted:     "#60708a",
  accent:        "#7266ff",
  border:        "rgba(120,110,255,0.2)",
  bgCard:        "#111b32",
  bgSecondary:   "#0c1322",
};

const STATUS = {
  pending:  { label: "Pending",  color: "#f59e0b", bg: "rgba(245,158,11,0.12)"  },
  reviewed: { label: "Reviewed", color: "#7266ff", bg: "rgba(114,102,255,0.12)" },
  approved: { label: "Approved", color: "#10b981", bg: "rgba(16,185,129,0.12)"  },
};

export default function GuestReturnPage() {
  const [activeTab, setActiveTab]           = useState("return");
  const [searchQuery, setSearchQuery]       = useState("");
  const [hasSearched, setHasSearched]       = useState(false);
  const [loans, setLoans]                   = useState([]);
  const [loading, setLoading]               = useState(false);
  const [returnModalLoan, setReturnModalLoan] = useState(null);
  const [returnPhoto, setReturnPhoto]       = useState(null);
  const [returnRemarks, setReturnRemarks]   = useState("");
  const [returnLoading, setReturnLoading]   = useState(false);
  const fileInputRef = useRef(null);
  const router = useRouter();
  const toast  = useToast();

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      toast.error("Please enter at least 2 characters");
      return;
    }
    setLoading(true);
    setHasSearched(true);
    try {
      const res  = await fetch(`/api/guest/search?q=${encodeURIComponent(searchQuery.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setLoans(data.loans || []);
    } catch {
      toast.error("Could not load loans — please try again");
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image"); return; }
    if (file.size > 10 * 1024 * 1024)   { toast.error("Image must be under 10 MB"); return; }
    const reader = new FileReader();
    reader.onload = (ev) => setReturnPhoto(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleReturnSubmit = async () => {
    if (!returnPhoto) { toast.error("Please upload a photo first"); return; }
    setReturnLoading(true);
    try {
      const res  = await fetch("/api/guest/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loan_id: returnModalLoan.id, imageBase64: returnPhoto, remarks: returnRemarks.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit return");
      toast.success("Return submitted! Thank you.");
      setLoans((prev) => prev.filter((l) => l.id !== returnModalLoan.id));
      setReturnModalLoan(null);
      setReturnPhoto(null);
      setReturnRemarks("");
    } catch (err) {
      toast.error(err.message || "Failed to submit return");
    } finally {
      setReturnLoading(false);
    }
  };

  const sInfo = (s) => STATUS[s] || { label: s, color: C.textMuted, bg: "rgba(255,255,255,0.06)" };

  return (
    <>
      <style>{`
        body { background: #060a14; }

        @keyframes shimmer {
          0%   { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
        .gr-shimmer {
          background: linear-gradient(90deg,rgba(255,255,255,0.03) 25%,rgba(255,255,255,0.07) 50%,rgba(255,255,255,0.03) 75%);
          background-size: 200% 100%;
          animation: shimmer 1.4s infinite;
        }
      `}</style>

      <div style={{ padding: "40px 20px 80px", minHeight: "100vh", position: "relative", zIndex: 1 }}>

        {/* Back button */}
        <div style={{ maxWidth: 640, margin: "0 auto 28px" }}>
          <button
            onClick={() => router.push("/login")}
            style={{
              display: "inline-flex", alignItems: "center", gap: 8,
              background: C.bgCard, border: `1px solid ${C.border}`,
              color: C.textSecondary, padding: "8px 16px",
              borderRadius: 12, fontSize: 14, cursor: "pointer",
            }}
          >
            <RiArrowLeftLine /> Back to Login
          </button>
        </div>

        {/* Card */}
        <div style={{
          maxWidth: 640, margin: "0 auto",
          background: C.bgCard,
          border: `1px solid ${C.border}`,
          borderRadius: 24,
          padding: "28px 24px",
          boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
          color: C.textPrimary,
        }}>

          {/* Tab strip */}
          <div style={{
            display: "flex", background: "rgba(255,255,255,0.04)",
            borderRadius: 14, padding: 4, gap: 4, marginBottom: 28,
          }}>
            {[
              { key: "borrow", label: "Borrow", icon: <RiShoppingCart2Line style={{ fontSize: 16 }} />, action: () => router.push("/home") },
              { key: "return", label: "Return", icon: <RiArrowGoBackLine style={{ fontSize: 16 }} />,   action: () => setActiveTab("return") },
            ].map(({ key, label, icon, action }) => (
              <button key={key} onClick={action} style={{
                flex: 1, padding: "10px 0", borderRadius: 10, border: "none",
                fontWeight: 600, fontSize: 14, cursor: "pointer",
                background: activeTab === key ? "linear-gradient(135deg,#7266ff,#a78bfa)" : "transparent",
                color: activeTab === key ? "#fff" : C.textSecondary,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                transition: "all 0.15s",
              }}>
                {icon} {label}
              </button>
            ))}
          </div>

          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 14, margin: "0 auto 14px",
              background: "rgba(114,102,255,0.15)", border: "1px solid rgba(114,102,255,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, color: C.accent,
            }}>
              <RiArrowGoBackLine />
            </div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary, marginBottom: 8 }}>
              Return Items
            </h1>
            <p style={{ color: C.textSecondary, fontSize: 14, lineHeight: 1.6, margin: 0 }}>
              Search by your name or Instagram handle to find your active loans.
            </p>
          </div>

          {/* Search */}
          <form onSubmit={handleSearch} style={{ display: "flex", gap: 10, marginBottom: 24 }}>
            <div style={{ position: "relative", flex: 1 }}>
              <RiSearch2Line style={{
                position: "absolute", left: 14, top: "50%",
                transform: "translateY(-50%)", color: C.textMuted,
                fontSize: 18, pointerEvents: "none",
              }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Your name or @instagramhandle"
                className="input"
                style={{ paddingLeft: 42, height: 50, fontSize: 15, borderRadius: 14 }}
              />
            </div>
            <button
              type="submit" className="btn btn-primary" disabled={loading}
              style={{ height: 50, padding: "0 20px", borderRadius: 14, flexShrink: 0, fontWeight: 600 }}
            >
              {loading ? "..." : "Search"}
            </button>
          </form>

          {/* Body states */}
          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[1, 2].map((i) => (
                <div key={i} className="gr-shimmer" style={{ height: 110, borderRadius: 16, border: `1px solid ${C.border}` }} />
              ))}
            </div>

          ) : !hasSearched ? (
            <div style={{
              textAlign: "center", padding: "36px 20px",
              background: "rgba(255,255,255,0.02)",
              border: `1.5px dashed ${C.border}`, borderRadius: 18,
            }}>
              <div style={{ fontSize: 36, marginBottom: 14 }}>🔍</div>
              <p style={{ color: C.textSecondary, fontSize: 14, lineHeight: 1.7, marginBottom: 18 }}>
                Enter the name or Instagram handle<br />you used when borrowing
              </p>
              {[
                { icon: <RiUser3Line />, text: "Search by your full name" },
                { icon: <RiBox3Line />,  text: "Search by @instagram handle" },
              ].map(({ icon, text }, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 14px", borderRadius: 10, marginBottom: 8,
                  background: "rgba(114,102,255,0.06)", border: `1px solid ${C.border}`,
                  color: C.textSecondary, fontSize: 13, maxWidth: 280, margin: "0 auto 8px",
                }}>
                  <span style={{ color: C.accent, fontSize: 16 }}>{icon}</span> {text}
                </div>
              ))}
            </div>

          ) : loans.length === 0 ? (
            <div style={{
              textAlign: "center", padding: "36px 20px",
              background: "rgba(255,255,255,0.02)",
              border: `1.5px dashed ${C.border}`, borderRadius: 18,
            }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
              <p style={{ color: C.textPrimary, fontWeight: 600, marginBottom: 6, fontSize: 15 }}>
                No active loans found
              </p>
              <p style={{ color: C.textSecondary, fontSize: 13, lineHeight: 1.6 }}>
                No results for &ldquo;{searchQuery}&rdquo;.<br />
                Try a different name or handle.
              </p>
            </div>

          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <p style={{ fontSize: 12, color: C.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>
                {loans.length} active loan{loans.length !== 1 ? "s" : ""} found
              </p>

              {loans.map((loan) => {
                const s = sInfo(loan.status);
                const total = loan.items.reduce((sum, i) => sum + i.quantity, 0);
                return (
                  <div key={loan.id} style={{
                    background: "#0d1526",
                    border: `1px solid ${C.border}`,
                    borderRadius: 18, overflow: "hidden",
                  }}>
                    {/* Header row */}
                    <div style={{
                      padding: "14px 18px",
                      borderBottom: `1px solid ${C.border}`,
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
                    }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{
                          width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                          background: "rgba(114,102,255,0.12)", border: "1px solid rgba(114,102,255,0.2)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          color: C.accent, fontSize: 17,
                        }}>
                          <RiUser3Line />
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15, color: C.textPrimary }}>
                            {loan.requester_name || "Guest"}
                          </div>
                          {loan.requester_telegram && (
                            <div style={{ fontSize: 12, color: C.textMuted }}>
                              @{loan.requester_telegram.replace(/^@/, "")}
                            </div>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                        <span style={{
                          padding: "3px 9px", borderRadius: 7, fontSize: 11, fontWeight: 700,
                          background: s.bg, color: s.color,
                        }}>{s.label}</span>
                        <span style={{
                          padding: "3px 9px", borderRadius: 7, fontSize: 11, fontWeight: 700,
                          background: loan._loanKind === "laptop" ? "rgba(16,185,129,0.12)" : "rgba(114,102,255,0.12)",
                          color: loan._loanKind === "laptop" ? "#10b981" : C.accent,
                        }}>{loan._loanKind === "laptop" ? "Laptop" : "Tech"}</span>
                      </div>
                    </div>

                    {/* Items */}
                    <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.border}` }}>
                      <p style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 }}>
                        {total} item{total !== 1 ? "s" : ""} borrowed
                      </p>
                      {loan.items.map((it, idx) => (
                        <div key={idx} style={{
                          display: "flex", alignItems: "center", gap: 10,
                          padding: "8px 12px", borderRadius: 10, marginBottom: 6,
                          background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`,
                        }}>
                          <RiBox3Line style={{ color: C.textMuted, fontSize: 15, flexShrink: 0 }} />
                          <span style={{ fontSize: 14, color: C.textPrimary, flex: 1 }}>{it.item}</span>
                          <span style={{
                            fontSize: 12, fontWeight: 700, color: C.accent,
                            background: "rgba(114,102,255,0.12)", padding: "2px 8px", borderRadius: 6,
                          }}>×{it.quantity}</span>
                        </div>
                      ))}
                    </div>

                    {/* Dates */}
                    <div style={{ padding: "10px 18px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.textSecondary, marginBottom: loan.purpose ? 6 : 0 }}>
                        <RiCalendarLine style={{ color: C.textMuted, fontSize: 14 }} />
                        {loan.start_date}{loan.end_date ? ` → ${loan.end_date}` : ""}
                      </div>
                      {loan.purpose && (
                        <div style={{ fontSize: 13, color: C.textSecondary }}>
                          <span style={{ color: C.textMuted }}>Purpose: </span>{loan.purpose}
                        </div>
                      )}
                    </div>

                    {/* Return button */}
                    <div style={{ padding: "0 14px 14px" }}>
                      {loan.status === "approved" ? (
                        <button
                          onClick={() => setReturnModalLoan(loan)}
                          className="btn btn-primary"
                          style={{ width: "100%", padding: "12px 0", fontSize: 14, fontWeight: 600, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                        >
                          <RiCheckboxCircleLine style={{ fontSize: 17 }} /> Return These Items
                        </button>
                      ) : (
                        <div style={{
                          width: "100%", padding: "12px 0", fontSize: 13, fontWeight: 600,
                          borderRadius: 12, textAlign: "center",
                          background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)",
                          color: "#f59e0b",
                        }}>
                          Awaiting Approval — not yet ready to return
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Return Modal */}
      {returnModalLoan && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.8)", backdropFilter: "blur(6px)",
          zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }}>
          <div style={{
            background: C.bgCard, border: `1px solid ${C.border}`,
            borderRadius: 24, padding: 28, maxWidth: 440, width: "100%",
            boxShadow: "0 24px 60px rgba(0,0,0,0.6)",
            color: C.textPrimary,
          }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6, color: C.textPrimary }}>Return Items</h2>
            <p style={{ color: C.textSecondary, fontSize: 13, lineHeight: 1.5, marginBottom: 18 }}>
              Returning {returnModalLoan.items.reduce((s, i) => s + i.quantity, 0)} item
              {returnModalLoan.items.reduce((s, i) => s + i.quantity, 0) !== 1 ? "s" : ""} for{" "}
              <strong style={{ color: C.textPrimary }}>{returnModalLoan.requester_name}</strong>.
              Please upload a clear photo of the equipment.
            </p>

            {/* Item summary */}
            <div style={{
              background: "rgba(255,255,255,0.03)", border: `1px solid ${C.border}`,
              borderRadius: 12, padding: "10px 14px", marginBottom: 18,
            }}>
              {returnModalLoan.items.map((it, idx) => (
                <div key={idx} style={{
                  display: "flex", justifyContent: "space-between",
                  fontSize: 13, color: C.textSecondary,
                  paddingBottom: idx < returnModalLoan.items.length - 1 ? 6 : 0,
                  marginBottom: idx < returnModalLoan.items.length - 1 ? 6 : 0,
                  borderBottom: idx < returnModalLoan.items.length - 1 ? `1px solid ${C.border}` : "none",
                }}>
                  <span>{it.item}</span>
                  <span style={{ color: C.accent, fontWeight: 600 }}>×{it.quantity}</span>
                </div>
              ))}
            </div>

            {/* Photo upload */}
            {returnPhoto ? (
              <div style={{ position: "relative", marginBottom: 16, borderRadius: 14, overflow: "hidden", border: `1px solid ${C.border}` }}>
                <img src={returnPhoto} alt="Return preview" style={{ width: "100%", height: 175, objectFit: "cover", display: "block" }} />
                <button
                  onClick={() => setReturnPhoto(null)}
                  style={{
                    position: "absolute", top: 10, right: 10,
                    background: "rgba(0,0,0,0.65)", color: "#fff",
                    padding: "5px 12px", borderRadius: 8, fontSize: 12,
                    border: "none", cursor: "pointer",
                  }}
                >Retake</button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${C.border}`, borderRadius: 14, height: 130,
                  display: "flex", flexDirection: "column", alignItems: "center",
                  justifyContent: "center", gap: 8,
                  background: "rgba(114,102,255,0.03)", cursor: "pointer", marginBottom: 16,
                  transition: "all 0.2s",
                }}
              >
                <RiUploadCloud2Line style={{ fontSize: 28, color: C.accent }} />
                <p style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, margin: 0 }}>Upload proof photo</p>
                <p style={{ fontSize: 12, color: C.textMuted, margin: 0 }}>Tap to choose from camera or gallery</p>
                <input type="file" accept="image/*" capture="environment" ref={fileInputRef} onChange={handlePhotoSelect} style={{ display: "none" }} />
              </div>
            )}

            <div className="input-group" style={{ marginBottom: 18 }}>
              <label style={{ color: C.textSecondary }}>Remarks (optional)</label>
              <textarea
                value={returnRemarks}
                onChange={(e) => setReturnRemarks(e.target.value)}
                placeholder="E.g. left it on the second shelf..."
                rows={2}
                style={{ resize: "none" }}
              />
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => { setReturnModalLoan(null); setReturnPhoto(null); setReturnRemarks(""); }}
                className="btn btn-outline"
                style={{ flex: 1, padding: "12px 0" }}
                disabled={returnLoading}
              >Cancel</button>
              <button
                onClick={handleReturnSubmit}
                className="btn btn-primary"
                style={{ flex: 1, padding: "12px 0", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}
                disabled={returnLoading || !returnPhoto}
              >
                {returnLoading ? "Submitting..." : <><RiCheckboxCircleLine style={{ fontSize: 16 }} /> Confirm Return</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
