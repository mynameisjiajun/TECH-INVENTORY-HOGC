"use client";
import { useAuth } from "@/lib/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import CartPanel from "@/components/CartPanel";
import {
  RiMacbookLine,
  RiArchiveLine,
  RiCpuLine,
  RiWifiLine,
  RiServerLine,
  RiDatabase2Line,
  RiHardDriveLine,
  RiUsbLine,
} from "react-icons/ri";

export default function InventoryLanding() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    setIsMobile(mq.matches);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  if (loading || !user)
    return (
      <div
        className="loading-spinner"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <div className="spinner" />
      </div>
    );

  const floatingIcons = [
    { Icon: RiCpuLine, top: "12%", left: "8%", size: 28, delay: 0, dur: 20 },
    { Icon: RiWifiLine, top: "22%", right: "12%", size: 24, delay: 3, dur: 25 },
    {
      Icon: RiServerLine,
      bottom: "25%",
      left: "15%",
      size: 22,
      delay: 6,
      dur: 22,
    },
    {
      Icon: RiDatabase2Line,
      top: "65%",
      right: "18%",
      size: 26,
      delay: 2,
      dur: 28,
    },
    {
      Icon: RiHardDriveLine,
      top: "40%",
      left: "5%",
      size: 20,
      delay: 8,
      dur: 18,
    },
    {
      Icon: RiUsbLine,
      bottom: "15%",
      right: "6%",
      size: 22,
      delay: 5,
      dur: 24,
    },
    { Icon: RiCpuLine, top: "8%", left: "45%", size: 18, delay: 10, dur: 30 },
    {
      Icon: RiWifiLine,
      bottom: "35%",
      left: "70%",
      size: 20,
      delay: 7,
      dur: 26,
    },
  ];

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
        @keyframes floatIcon {
          0%   { transform: translate(0, 0) rotate(0deg); opacity: 0.08; }
          25%  { transform: translate(12px, -18px) rotate(8deg); opacity: 0.14; }
          50%  { transform: translate(-8px, -28px) rotate(-5deg); opacity: 0.08; }
          75%  { transform: translate(16px, -10px) rotate(12deg); opacity: 0.12; }
          100% { transform: translate(0, 0) rotate(0deg); opacity: 0.08; }
        }
        @keyframes gridPulse {
          0%, 100% { opacity: 0.03; }
          50%      { opacity: 0.07; }
        }
        .inv-card {
          display: flex;
          align-items: center;
          background: var(--bg-card);
          border: 1px solid var(--border);
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          box-shadow: 0 2px 12px rgba(0,0,0,0.06);
          text-align: left;
          position: relative;
          overflow: hidden;
        }
        .inv-card::before {
          content: "";
          position: absolute;
          inset: 0;
          opacity: 0;
          transition: opacity 0.3s;
        }
        .inv-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 20px 60px rgba(0,0,0,0.2);
        }
        .inv-card:hover::before {
          opacity: 1;
        }
        .inv-card-tech::before {
          background: linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(139,92,246,0.03) 100%);
        }
        .inv-card-tech:hover {
          border-color: var(--accent);
          box-shadow: 0 20px 60px rgba(99,102,241,0.15), 0 0 0 1px rgba(99,102,241,0.1);
        }
        .inv-card-laptop::before {
          background: linear-gradient(135deg, rgba(16,185,129,0.06) 0%, rgba(5,150,105,0.03) 100%);
        }
        .inv-card-laptop:hover {
          border-color: #10b981;
          box-shadow: 0 20px 60px rgba(16,185,129,0.15), 0 0 0 1px rgba(16,185,129,0.1);
        }
        .inv-card .inv-arrow {
          transition: transform 0.3s;
        }
        .inv-card:hover .inv-arrow {
          transform: translateX(4px);
        }

        /* --- Mobile layout --- */
        @media (max-width: 768px) {
          .inv-grid {
            grid-template-columns: 1fr !important;
            max-width: 100% !important;
            gap: 12px !important;
          }
          .inv-card {
            flex-direction: row !important;
            padding: 18px 20px !important;
            border-radius: 16px !important;
            gap: 16px !important;
          }
          .inv-icon-box {
            width: 52px !important;
            height: 52px !important;
            border-radius: 14px !important;
            font-size: 24px !important;
          }
          .inv-card-title {
            font-size: 16px !important;
          }
          .inv-card-desc {
            font-size: 12px !important;
          }
          .inv-heading {
            font-size: 24px !important;
            margin-bottom: 6px !important;
          }
          .inv-subheading {
            font-size: 14px !important;
          }
          .inv-heading-wrap {
            margin-bottom: 28px !important;
          }
        }
      `}</style>
      <div
        style={{
          position: "relative",
          overflow: "hidden",
          minHeight: "calc(100vh - 64px)",
          display: "flex",
          alignItems: "center",
        }}
      >
        {/* Tech grid pattern */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 0,
            backgroundImage: `
            linear-gradient(rgba(99,102,241,0.05) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99,102,241,0.05) 1px, transparent 1px)
          `,
            backgroundSize: "60px 60px",
            animation: "gridPulse 8s ease-in-out infinite",
          }}
        />

        {/* Floating orbs */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "15%",
              left: "10%",
              width: 420,
              height: 420,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(99,102,241,0.22) 0%, transparent 70%)",
              filter: "blur(48px)",
              animation: "orb1 28s ease-in-out infinite",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: "10%",
              right: "8%",
              width: 380,
              height: 380,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(139,92,246,0.18) 0%, transparent 70%)",
              filter: "blur(48px)",
              animation: "orb2 34s ease-in-out infinite",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "55%",
              width: 300,
              height: 300,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, rgba(16,185,129,0.14) 0%, transparent 70%)",
              filter: "blur(56px)",
              animation: "orb3 22s ease-in-out infinite",
            }}
          />
        </div>

        {/* Floating tech icons (desktop only) */}
        {!isMobile && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              zIndex: 0,
            }}
          >
            {floatingIcons.map(({ Icon, size, delay, dur, ...pos }, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  ...pos,
                  color: "var(--accent)",
                  fontSize: size,
                  opacity: 0.08,
                  animation: `floatIcon ${dur}s ease-in-out ${delay}s infinite`,
                }}
              >
                <Icon />
              </div>
            ))}
          </div>
        )}

        <div
          className="page-container"
          style={{
            position: "relative",
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: "100%",
          }}
        >
          <div
            className="inv-heading-wrap"
            style={{ textAlign: "center", marginBottom: 48 }}
          >
            <h1
              className="inv-heading"
              style={{
                fontSize: 36,
                fontWeight: 800,
                marginBottom: 10,
                letterSpacing: "-0.02em",
              }}
            >
              Inventory
            </h1>
            <p
              className="inv-subheading"
              style={{
                color: "var(--text-secondary)",
                fontSize: 16,
                margin: 0,
              }}
            >
              What would you like to browse?
            </p>
          </div>

          <div
            className="inv-grid"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 24,
              width: "100%",
              maxWidth: 780,
            }}
          >
            {/* Tech Inventory */}
            <button
              className="inv-card inv-card-tech"
              onClick={() => router.push("/inventory/tech-inventory")}
              style={{
                flexDirection: "column",
                gap: 20,
                padding: "36px 32px",
                borderRadius: 20,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                }}
              >
                <div
                  className="inv-icon-box"
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 18,
                    flexShrink: 0,
                    background:
                      "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15))",
                    border: "1px solid rgba(99,102,241,0.15)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 32,
                    color: "var(--accent)",
                  }}
                >
                  <RiArchiveLine />
                </div>
                <span
                  className="inv-arrow"
                  style={{
                    color: "var(--accent)",
                    fontSize: 22,
                    flexShrink: 0,
                  }}
                >
                  →
                </span>
              </div>
              <div style={{ width: "100%" }}>
                <div
                  className="inv-card-title"
                  style={{
                    fontWeight: 700,
                    fontSize: 20,
                    color: "var(--text-primary)",
                    marginBottom: 6,
                  }}
                >
                  Tech Inventory
                </div>
                <div
                  className="inv-card-desc"
                  style={{
                    fontSize: 14,
                    color: "var(--text-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  Cables, adapters, cameras &amp; more
                </div>
              </div>
            </button>

            {/* Laptop Loans */}
            <button
              className="inv-card inv-card-laptop"
              onClick={() => router.push("/inventory/laptop-loans")}
              style={{
                flexDirection: "column",
                gap: 20,
                padding: "36px 32px",
                borderRadius: 20,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                }}
              >
                <div
                  className="inv-icon-box"
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 18,
                    flexShrink: 0,
                    background:
                      "linear-gradient(135deg, rgba(16,185,129,0.15), rgba(5,150,105,0.15))",
                    border: "1px solid rgba(16,185,129,0.15)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 32,
                    color: "#10b981",
                  }}
                >
                  <RiMacbookLine />
                </div>
                <span
                  className="inv-arrow"
                  style={{ color: "#10b981", fontSize: 22, flexShrink: 0 }}
                >
                  →
                </span>
              </div>
              <div style={{ width: "100%" }}>
                <div
                  className="inv-card-title"
                  style={{
                    fontWeight: 700,
                    fontSize: 20,
                    color: "var(--text-primary)",
                    marginBottom: 6,
                  }}
                >
                  Laptop Loans
                </div>
                <div
                  className="inv-card-desc"
                  style={{
                    fontSize: 14,
                    color: "var(--text-secondary)",
                    lineHeight: 1.5,
                  }}
                >
                  Borrow MacBooks for ministry or projects
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
