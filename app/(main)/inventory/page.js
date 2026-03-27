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
      <div className="page-container" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "calc(100vh - 64px)" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Inventory</h1>
          <p style={{ color: "var(--text-secondary)", fontSize: 15 }}>What would you like to browse?</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24, width: "100%", maxWidth: 680 }}>
          {/* Tech Inventory */}
          <button
            onClick={() => router.push("/inventory/tech-inventory")}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              padding: "40px 32px",
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 20,
              cursor: "pointer",
              transition: "all 0.2s",
              boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
              textAlign: "center",
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
              width: 72, height: 72, borderRadius: 18,
              background: "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15))",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 32, color: "var(--accent)",
            }}>
              <RiArchiveLine />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text-primary)", marginBottom: 6 }}>Tech Inventory</div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Browse cables, adapters, cameras, and other tech equipment
              </div>
            </div>
            <span style={{
              marginTop: 4, padding: "6px 18px", borderRadius: 8,
              background: "var(--accent)", color: "white", fontSize: 13, fontWeight: 600,
            }}>Browse →</span>
          </button>

          {/* Laptop Loans */}
          <button
            onClick={() => router.push("/inventory/laptop-loans")}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              padding: "40px 32px",
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 20,
              cursor: "pointer",
              transition: "all 0.2s",
              boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
              textAlign: "center",
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
              width: 72, height: 72, borderRadius: 18,
              background: "linear-gradient(135deg, rgba(16,185,129,0.15), rgba(5,150,105,0.15))",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 32, color: "#10b981",
            }}>
              <RiMacbookLine />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text-primary)", marginBottom: 6 }}>Laptop Loans</div>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                Borrow MacBooks and Apple laptops for your ministry or project
              </div>
            </div>
            <span style={{
              marginTop: 4, padding: "6px 18px", borderRadius: 8,
              background: "#10b981", color: "white", fontSize: 13, fontWeight: 600,
            }}>Browse →</span>
          </button>
        </div>
      </div>
    </>
  );
}
