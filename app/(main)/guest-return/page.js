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
  RiImageLine,
} from "react-icons/ri";

export default function GuestReturnPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [hasSearched, setHasSearched] = useState(false);
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

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
    } catch (err) {
      toast.error("Could not load your loans");
    } finally {
      setLoading(false);
    }
  };

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please actally upload an image file");
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
      // Remove from list
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
      <div className="page-container" style={{ paddingTop: 40, paddingBottom: 60, minHeight: "100vh" }}>
        
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

        <div className="glass-panel" style={{ padding: "40px 24px", maxWidth: 640, margin: "0 auto", textAlign: "center" }}>
          <h1 style={{ marginBottom: 12, fontSize: 28, background: "linear-gradient(to right, var(--text-primary), #a5b4fc)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            Guest Return Portal
          </h1>
          <p style={{ color: "var(--text-secondary)", marginBottom: 32 }}>
            Search your name or Telegram handle to find your active guest loans and process a return.
          </p>

          <form onSubmit={handleSearch} style={{ display: "flex", gap: 12, marginBottom: 40, position: "relative" }}>
            <div style={{ position: "relative", flex: 1 }}>
              <RiSearch2Line 
                style={{ 
                  position: "absolute", 
                  left: 16, 
                  top: "50%", 
                  transform: "translateY(-50%)", 
                  color: "var(--text-muted)",
                  fontSize: 20
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
                  fontSize: 16,
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

          {/* Results Area */}
          <div style={{ textAlign: "left" }}>
            {loading ? (
              <div style={{ textAlign: "center", color: "var(--text-muted)" }}>Searching databases...</div>
            ) : hasSearched && loans.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 0", color: "var(--text-muted)", background: "var(--bg-secondary)", borderRadius: 16, border: "1px solid var(--border)" }}>
                No active loans found matching "{searchQuery}"
              </div>
            ) : loans.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <h3 style={{ fontSize: 16, color: "var(--text-secondary)", marginBottom: 4 }}>
                  Found {loans.length} active loan{loans.length !== 1 ? 's' : ''}
                </h3>
                {loans.map(loan => (
                  <div key={loan.id} style={{
                    background: "rgba(10, 16, 32, 0.4)",
                    border: "1px solid var(--border)",
                    borderRadius: 16,
                    padding: 20,
                    display: "flex",
                    flexDirection: "column",
                    gap: 16
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 18, color: "var(--text-primary)", marginBottom: 4 }}>
                          {loan.loan_type === "permanent" ? "Permanent Loan" : "Temporary Loan"}
                        </div>
                        <div style={{ color: "var(--text-muted)", fontSize: 14 }}>
                          Borrowed on: {loan.start_date}
                        </div>
                      </div>
                      <div style={{ background: "rgba(99, 102, 241, 0.1)", color: "var(--accent)", padding: "4px 10px", borderRadius: 8, fontSize: 12, fontWeight: 700 }}>
                        {loan._loanKind === 'laptop' ? 'Laptop' : 'Accessory / Cable'}
                      </div>
                    </div>

                    <div style={{ background: "var(--bg-secondary)", borderRadius: 12, padding: 12 }}>
                      <p style={{ margin: "0 0 8px 0", fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>Items Borrowed</p>
                      <ul style={{ margin: 0, paddingLeft: 16, color: "var(--text-primary)", fontSize: 14 }}>
                        {loan.items.map((it, idx) => (
                          <li key={idx} style={{ marginBottom: 4 }}>{it.quantity}x {it.item}</li>
                        ))}
                      </ul>
                    </div>

                    <button
                      onClick={() => setReturnModalLoan(loan)}
                      className="btn btn-primary"
                      style={{ width: "100%", padding: "12px 0", fontSize: 15 }}
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

      {/* Return Modal Overlay */}
      {returnModalLoan && (
        <div style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0,0,0,0.8)",
          backdropFilter: "blur(4px)",
          zIndex: 9999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20
        }}>
          <div className="glass-panel" style={{
            background: "var(--bg-card)",
            padding: 32,
            borderRadius: 24,
            maxWidth: 440,
            width: "100%",
            animation: "fadeIn 0.2s ease-out"
          }}>
            <h2 style={{ marginBottom: 8, fontSize: 22 }}>Return Items</h2>
            <p style={{ color: "var(--text-secondary)", marginBottom: 24, fontSize: 14 }}>
              Returning {returnModalLoan.items.reduce((s, i) => s + i.quantity, 0)} items. Please upload a clear photo of the equipment left at the tech booth.
            </p>

            {returnPhoto ? (
              <div style={{ position: "relative", marginBottom: 20, borderRadius: 12, overflow: "hidden", border: "1px solid var(--border)" }}>
                <img src={returnPhoto} alt="Return preview" style={{ width: "100%", height: 200, objectFit: "cover", display: "block" }} />
                <button
                  onClick={() => setReturnPhoto(null)}
                  style={{ position: "absolute", top: 12, right: 12, background: "rgba(0,0,0,0.6)", color: "white", padding: "6px 12px", borderRadius: 8, fontSize: 13, border: "none", cursor: "pointer", backdropFilter: "blur(4px)" }}
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
                  transition: "all 0.2s"
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "rgba(99,102,241,0.05)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "rgba(255,255,255,0.02)"; }}
              >
                <RiUploadCloud2Line style={{ fontSize: 32 }} />
                <span style={{ fontSize: 14, fontWeight: 500 }}>Tap to upload proof photo required</span>
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
