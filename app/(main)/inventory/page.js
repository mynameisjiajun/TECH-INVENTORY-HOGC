"use client";
import { useAuth } from "@/lib/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import Navbar from "@/components/Navbar";
import CartPanel from "@/components/CartPanel";
import { RiMacbookLine, RiArchiveLine } from "react-icons/ri";

export default function InventoryLanding() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  if (loading || !user) return (
    <div className="loading-spinner" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div className="spinner" />
    </div>
  );

  return (
    <>
      <Navbar />
      <CartPanel />
      <style>{`
        @keyframes orb1 {
          0%   { transform: translate(0, 0) scale(1); }
          33%  { transform: translate(60px, -40px) scale(1.08); }
          66%  { transform: translate(-30px, 50px) scale(0.95); }
          100% { transform: translate(0, 0) scale(1); }
        }
        @keyframes orb2 {
          0%   { transform: translate(0, 0) scale(1); }
          33%  { transform: translate(-50px, 60px) scale(1.06); }
          66%  { transform: translate(40px, -30px) scale(0.97); }
          100% { transform: translate(0, 0) scale(1); }
        }
        @keyframes orb3 {
          0%   { transform: translate(0, 0) scale(1); }
          50%  { transform: translate(30px, 40px) scale(1.05); }
          100% { transform: translate(0, 0) scale(1); }
        }
      `}</style>
      <div style={{ position: "relative", overflow: "hidden", minHeight: "calc(100vh - 64px)", display: "flex", alignItems: "center" }}>
        {/* Floating orbs */}
        <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 0 }}>
          <div style={{ position: "absolute", top: "15%", left: "10%", width: 420, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.22) 0%, transparent 70%)", filter: "blur(48px)", animation: "orb1 28s ease-in-out infinite" }} />
          <div style={{ position: "absolute", bottom: "10%", right: "8%", width: 380, height: 380, borderRadius: "50%", background: "radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 70%)", filter: "blur(48px)", animation: "orb2 34s ease-in-out infinite" }} />
          <div style={{ position: "absolute", top: "50%", left: "55%", width: 300, height: 300, borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.14) 0%, transparent 70%)", filter: "blur(56px)", animation: "orb3 22s ease-in-out infinite" }} />
        </div>

        <div className="page-container" style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, marginBottom: 6 }}>Inventory</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>What would you like to browse?</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16, width: "100%", maxWidth: 560 }}>
          {/* Tech Inventory */}
          <button
            onClick={() => router.push("/inventory/tech-inventory")}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 16,
              padding: "18px 20px",
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              cursor: "pointer",
              transition: "all 0.2s",
              boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
              textAlign: "left",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--accent)";
              e.currentTarget.style.boxShadow = "0 8px 32px rgba(99,102,241,0.15)";
              e.currentTarget.style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.06)";
              e.currentTarget.style.transform = "none";
            }}
          >
            <div style={{
              width: 52, height: 52, borderRadius: 14, flexShrink: 0,
              background: "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15))",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, color: "var(--accent)",
            }}>
              <RiArchiveLine />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)", marginBottom: 3 }}>Tech Inventory</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 }}>
                Cables, adapters, cameras &amp; more
              </div>
            </div>
            <span style={{ color: "var(--accent)", fontSize: 18, flexShrink: 0 }}>→</span>
          </button>

          {/* Laptop Loans */}
          <button
            onClick={() => router.push("/inventory/laptop-loans")}
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 16,
              padding: "18px 20px",
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 16,
              cursor: "pointer",
              transition: "all 0.2s",
              boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
              textAlign: "left",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "#10b981";
              e.currentTarget.style.boxShadow = "0 8px 32px rgba(16,185,129,0.15)";
              e.currentTarget.style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.06)";
              e.currentTarget.style.transform = "none";
            }}
          >
            <div style={{
              width: 52, height: 52, borderRadius: 14, flexShrink: 0,
              background: "linear-gradient(135deg, rgba(16,185,129,0.15), rgba(5,150,105,0.15))",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, color: "#10b981",
            }}>
              <RiMacbookLine />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: "var(--text-primary)", marginBottom: 3 }}>Laptop Loans</div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.4 }}>
                Borrow MacBooks for ministry or projects
              </div>
            </div>
            <span style={{ color: "#10b981", fontSize: 18, flexShrink: 0 }}>→</span>
          </button>
        </div>
        </div>
      </div>
    </>
  );
}
