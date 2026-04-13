"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import FluidBackground from "@/components/FluidBackground";
import { useToast } from "@/lib/context/ToastContext";
import {
  RiSearch2Line,
  RiArrowLeftLine,
  RiUploadCloud2Line,
  RiArrowGoBackLine,
  RiShoppingCart2Line,
} from "react-icons/ri";

export default function GuestReturnPage() {
  const [activeTab, setActiveTab] = useState("return");
  const [searchQuery, setSearchQuery] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const toast = useToast();

  // Return modal state
  const [returnModalLoan, setReturnModalLoan] = useState(null);
  const [returnPhoto, setReturnPhoto] = useState(null);
  const [returnRemarks, setReturnRemarks] = useState("");
  const [returnLoading, setReturnLoading] = useState(false);
  const fileInputRef = useRef(null);

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      toast.error("Please enter at least 2 characters to search");
      return;
    }

    setLoading(true);
    setHasSearched(true);
    try {
      const res = await fetch(
        `/api/guest/search?q=${encodeURIComponent(searchQuery.trim())}`,
      );
      if (!res.ok) throw new Error("Search failed");
      const data = await res.json();
      setLoans(data.loans || []);
    } catch {
      toast.error("Could not load your loans");
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("File is too large. Please upload an image under 10MB");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => setReturnPhoto(event.target.result);
    reader.readAsDataURL(file);
  };

  const handleReturnSubmit = async () => {
    if (!returnPhoto) {
      toast.error("Please upload a photo of the returned items");
      return;
    }

    setReturnLoading(true);
    try {
      const res = await fetch("/api/guest/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          loan_id: returnModalLoan.id,
          imageBase64: returnPhoto,
          remarks: returnRemarks.trim() || null,
        }),
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

  return (
    <>
      <FluidBackground />
      <div
        className="page-container"
        style={{ paddingTop: 40, paddingBottom: 60, minHeight: "100vh" }}
      >
        {/* Back Button */}
        <button
          onClick={() => router.push("/login")}
          className="btn btn-outline"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            color: "var(--text-secondary)",
            padding: "8px 16px",
            borderRadius: 12,
            marginBottom: 32,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontSize: 14,
          }}
        >
          <RiArrowLeftLine /> Back to Login
        </button>

        <div
          className="glass-panel"
          style={{
            padding: "32px 24px",
            maxWidth: 640,
            margin: "0 auto",
          }}
        >
          {/* Tab strip */}
          <div
            style={{
              display: "flex",
              background: "rgba(255,255,255,0.04)",
              borderRadius: 14,
              padding: 4,
              gap: 4,
              marginBottom: 32,
            }}
          >
            <button
              onClick={() => router.push("/home")}
              style={{
                flex: 1,
                padding: "10px 0",
                borderRadius: 10,
                border: "none",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                background:
                  activeTab === "borrow"
                    ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                    : "transparent",
                color:
                  activeTab === "borrow"
                    ? "white"
                    : "var(--text-secondary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                transition: "all 0.15s",
              }}
            >
              <RiShoppingCart2Line style={{ fontSize: 16 }} />
              Borrow
            </button>
            <button
              onClick={() => setActiveTab("return")}
              style={{
                flex: 1,
                padding: "10px 0",
                borderRadius: 10,
                border: "none",
                fontWeight: 600,
                fontSize: 14,
                cursor: "pointer",
                background:
                  activeTab === "return"
                    ? "linear-gradient(135deg, #6366f1, #8b5cf6)"
                    : "transparent",
                color:
                  activeTab === "return"
                    ? "white"
                    : "var(--text-secondary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                transition: "all 0.15s",
              }}
            >
              <RiArrowGoBackLine style={{ fontSize: 16 }} />
              Return
            </button>
          </div>

          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: 32 }}>
            <h1
              style={{
                marginBottom: 10,
                fontSize: 26,
                background:
                  "linear-gradient(to right, var(--text-primary), #a5b4fc)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Guest Return Portal
            </h1>
            <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
              Search your name or Telegram handle to find your active loans and
              process a return.
            </p>
          </div>

          {/* Search form */}
          <form
            onSubmit={handleSearch}
            style={{
              display: "flex",
              gap: 12,
              marginBottom: 32,
            }}
          >
            <div style={{ position: "relative", flex: 1 }}>
              <RiSearch2Line
                style={{
                  position: "absolute",
                  left: 16,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-muted)",
                  fontSize: 20,
                  pointerEvents: "none",
                }}
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Enter your name or Telegram..."
                className="input"
                style={{
                  paddingLeft: 46,
                  height: 52,
                  fontSize: 15,
                  borderRadius: 14,
                  background: "var(--bg-secondary)",
                  border: "1px solid var(--border)",
                }}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading}
              style={{
                height: 52,
                padding: "0 24px",
                borderRadius: 14,
                flexShrink: 0,
              }}
            >
              {loading ? "Searching..." : "Search"}
            </button>
          </form>

          {/* Results */}
          <div>
            {loading ? (
              <div
                style={{ textAlign: "center", color: "var(--text-muted)", padding: "24px 0" }}
              >
                Searching...
              </div>
            ) : hasSearched && loans.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px 0",
                  color: "var(--text-muted)",
                  background: "var(--bg-secondary)",
                  borderRadius: 16,
                  border: "1px solid var(--border)",
                }}
              >
                No active loans found matching &quot;{searchQuery}&quot;
              </div>
            ) : loans.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    marginBottom: 2,
                  }}
                >
                  Found {loans.length} active loan{loans.length !== 1 ? "s" : ""}
                </p>
                {loans.map((loan) => (
                  <div
                    key={loan.id}
                    style={{
                      background: "rgba(10, 16, 32, 0.4)",
                      border: "1px solid var(--border)",
                      borderRadius: 16,
                      padding: 20,
                      display: "flex",
                      flexDirection: "column",
                      gap: 14,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "flex-start",
                        gap: 12,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: 16,
                            color: "var(--text-primary)",
                            marginBottom: 3,
                          }}
                        >
                          {loan.requester_name || "Guest"}
                        </div>
                        <div
                          style={{ color: "var(--text-muted)", fontSize: 13 }}
                        >
                          {loan.start_date}
                          {loan.end_date ? ` → ${loan.end_date}` : ""}
                        </div>
                      </div>
                      <span
                        style={{
                          background: "rgba(99,102,241,0.12)",
                          color: "var(--accent)",
                          padding: "3px 10px",
                          borderRadius: 8,
                          fontSize: 11,
                          fontWeight: 700,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {loan._loanKind === "laptop" ? "Laptop" : "Tech"}
                      </span>
                    </div>

                    <div
                      style={{
                        background: "var(--bg-secondary)",
                        borderRadius: 10,
                        padding: "10px 14px",
                      }}
                    >
                      <p
                        style={{
                          margin: "0 0 6px 0",
                          fontSize: 11,
                          fontWeight: 700,
                          color: "var(--text-muted)",
                          textTransform: "uppercase",
                          letterSpacing: 0.5,
                        }}
                      >
                        Items
                      </p>
                      <ul
                        style={{
                          margin: 0,
                          paddingLeft: 16,
                          color: "var(--text-primary)",
                          fontSize: 14,
                        }}
                      >
                        {loan.items.map((it, idx) => (
                          <li key={idx} style={{ marginBottom: 3 }}>
                            {it.quantity}× {it.item}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {loan.purpose && (
                      <div
                        style={{ fontSize: 13, color: "var(--text-secondary)" }}
                      >
                        <span style={{ fontWeight: 600 }}>Purpose:</span>{" "}
                        {loan.purpose}
                      </div>
                    )}

                    <button
                      onClick={() => setReturnModalLoan(loan)}
                      className="btn btn-primary"
                      style={{ width: "100%", padding: "11px 0", fontSize: 14 }}
                    >
                      Process Return
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Return Modal */}
      {returnModalLoan && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.8)",
            backdropFilter: "blur(4px)",
            zIndex: 9999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div
            className="glass-panel"
            style={{
              background: "var(--bg-card)",
              padding: 32,
              borderRadius: 24,
              maxWidth: 440,
              width: "100%",
              animation: "fadeIn 0.2s ease-out",
            }}
          >
            <h2 style={{ marginBottom: 8, fontSize: 22 }}>Return Items</h2>
            <p
              style={{
                color: "var(--text-secondary)",
                marginBottom: 24,
                fontSize: 14,
              }}
            >
              Returning{" "}
              {returnModalLoan.items.reduce((s, i) => s + i.quantity, 0)} item
              {returnModalLoan.items.reduce((s, i) => s + i.quantity, 0) !== 1
                ? "s"
                : ""}
              . Please upload a clear photo of the equipment left at the tech
              booth.
            </p>

            {returnPhoto ? (
              <div
                style={{
                  position: "relative",
                  marginBottom: 20,
                  borderRadius: 12,
                  overflow: "hidden",
                  border: "1px solid var(--border)",
                }}
              >
                <img
                  src={returnPhoto}
                  alt="Return preview"
                  style={{
                    width: "100%",
                    height: 200,
                    objectFit: "cover",
                    display: "block",
                  }}
                />
                <button
                  onClick={() => setReturnPhoto(null)}
                  style={{
                    position: "absolute",
                    top: 12,
                    right: 12,
                    background: "rgba(0,0,0,0.6)",
                    color: "white",
                    padding: "6px 12px",
                    borderRadius: 8,
                    fontSize: 13,
                    border: "none",
                    cursor: "pointer",
                    backdropFilter: "blur(4px)",
                  }}
                >
                  Retake
                </button>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: "2px dashed var(--border)",
                  borderRadius: 16,
                  height: 160,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 12,
                  color: "var(--text-muted)",
                  background: "rgba(255,255,255,0.02)",
                  cursor: "pointer",
                  marginBottom: 20,
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent)";
                  e.currentTarget.style.background = "rgba(99,102,241,0.05)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.background = "rgba(255,255,255,0.02)";
                }}
              >
                <RiUploadCloud2Line style={{ fontSize: 32 }} />
                <span style={{ fontSize: 14, fontWeight: 500 }}>
                  Tap to upload proof photo
                </span>
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  ref={fileInputRef}
                  onChange={handlePhotoSelect}
                  style={{ display: "none" }}
                />
              </div>
            )}

            <div className="input-group" style={{ marginBottom: 24 }}>
              <label>Optional Remarks</label>
              <textarea
                value={returnRemarks}
                onChange={(e) => setReturnRemarks(e.target.value)}
                placeholder="E.g. left it on the second shelf..."
                rows={3}
              />
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <button
                onClick={() => {
                  setReturnModalLoan(null);
                  setReturnPhoto(null);
                  setReturnRemarks("");
                }}
                className="btn btn-outline"
                style={{ flex: 1, padding: "12px 0" }}
                disabled={returnLoading}
              >
                Cancel
              </button>
              <button
                onClick={handleReturnSubmit}
                className="btn btn-primary"
                style={{ flex: 1, padding: "12px 0" }}
                disabled={returnLoading || !returnPhoto}
              >
                {returnLoading ? "Returning..." : "Submit Return"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
