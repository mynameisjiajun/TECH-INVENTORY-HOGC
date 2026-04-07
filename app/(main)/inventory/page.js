"use client";
import { useAuth } from "@/lib/context/AuthContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Navbar from "@/components/Navbar";
import CartPanel from "@/components/CartPanel";
import AppShellLoading from "@/components/AppShellLoading";
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
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 768px)").matches
      : false,
  );

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  if (loading || !user)
    return <AppShellLoading />;

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
        @keyframes circuitPulse1 {
          0%, 100% { opacity: 0; }
          15%, 35% { opacity: 0.5; }
        }
        @keyframes circuitPulse2 {
          0%, 100% { opacity: 0; }
          40%, 60% { opacity: 0.5; }
        }
        @keyframes circuitPulse3 {
          0%, 100% { opacity: 0; }
          65%, 85% { opacity: 0.5; }
        }

        @keyframes floatIcon {
          0%   { transform: translate(0, 0) rotate(0deg); opacity: 0.04; }
          25%  { transform: translate(12px, -18px) rotate(8deg); opacity: 0.07; }
          50%  { transform: translate(-8px, -28px) rotate(-5deg); opacity: 0.04; }
          75%  { transform: translate(16px, -10px) rotate(12deg); opacity: 0.06; }
          100% { transform: translate(0, 0) rotate(0deg); opacity: 0.04; }
        }
        @keyframes nodeGlow {
          0%, 100% { box-shadow: 0 0 3px rgba(99,102,241,0.15); }
          50%      { box-shadow: 0 0 6px rgba(99,102,241,0.35); }
        }
        .inv-bg-circuit-line {
          position: absolute;
          background: rgba(99,102,241,0.03);
        }
        .inv-bg-circuit-line.h {
          height: 1px;
          left: 0;
          right: 0;
        }
        .inv-bg-circuit-line.v {
          width: 1px;
          top: 0;
          bottom: 0;
        }
        .inv-bg-node {
          position: absolute;
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: rgba(99,102,241,0.12);
          animation: nodeGlow 6s ease-in-out infinite;
        }
        .inv-bg-trace {
          position: absolute;
          border-radius: 1px;
          opacity: 0;
        }
        .inv-bg-trace.h {
          height: 1px;
          background: linear-gradient(90deg, transparent, rgba(99,102,241,0.25), rgba(16,185,129,0.15), transparent);
        }
        .inv-bg-trace.v {
          width: 1px;
          background: linear-gradient(180deg, transparent, rgba(99,102,241,0.25), rgba(16,185,129,0.15), transparent);
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
          .inv-desktop-only {
            display: none !important;
          }
          .inv-mobile-only {
            display: flex !important;
          }
          .inv-bg-desktop {
            display: none !important;
          }
        }
        @media (min-width: 769px) {
          .inv-mobile-only {
            display: none !important;
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
        {/* Circuit board grid */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 0,
          }}
        >
          {/* Horizontal circuit lines */}
          {[15, 30, 45, 60, 75, 90].map((pct) => (
            <div
              key={`h${pct}`}
              className="inv-bg-circuit-line h"
              style={{ top: `${pct}%` }}
            />
          ))}
          {/* Vertical circuit lines */}
          {[10, 25, 40, 55, 70, 85].map((pct) => (
            <div
              key={`v${pct}`}
              className="inv-bg-circuit-line v"
              style={{ left: `${pct}%` }}
            />
          ))}
          {/* Intersection nodes */}
          {[
            { top: "15%", left: "25%" },
            { top: "15%", left: "70%" },
            { top: "30%", left: "10%" },
            { top: "30%", left: "55%" },
            { top: "30%", left: "85%" },
            { top: "45%", left: "25%" },
            { top: "45%", left: "40%" },
            { top: "60%", left: "55%" },
            { top: "60%", left: "85%" },
            { top: "75%", left: "10%" },
            { top: "75%", left: "40%" },
            { top: "75%", left: "70%" },
            { top: "90%", left: "25%" },
            { top: "90%", left: "55%" },
          ].map(({ top, left }, i) => (
            <div
              key={`n${i}`}
              className="inv-bg-node"
              style={{ top, left, animationDelay: `${i * 0.4}s` }}
            />
          ))}
          {/* Animated data traces */}
          <div
            className="inv-bg-trace h"
            style={{
              top: "30%",
              left: "10%",
              width: "45%",
              animation: "circuitPulse1 6s ease-in-out infinite",
            }}
          />
          <div
            className="inv-bg-trace h"
            style={{
              top: "75%",
              left: "40%",
              width: "45%",
              animation: "circuitPulse2 6s ease-in-out 1s infinite",
            }}
          />
          <div
            className="inv-bg-trace v"
            style={{
              left: "55%",
              top: "30%",
              height: "30%",
              animation: "circuitPulse3 6s ease-in-out 2s infinite",
            }}
          />
          <div
            className="inv-bg-trace h"
            style={{
              top: "45%",
              left: "25%",
              width: "30%",
              animation: "circuitPulse2 8s ease-in-out 3s infinite",
            }}
          />
          <div
            className="inv-bg-trace v"
            style={{
              left: "25%",
              top: "45%",
              height: "30%",
              animation: "circuitPulse1 7s ease-in-out 1.5s infinite",
            }}
          />
          <div
            className="inv-bg-trace h"
            style={{
              top: "60%",
              left: "55%",
              width: "30%",
              animation: "circuitPulse3 9s ease-in-out 0.5s infinite",
            }}
          />
        </div>

        {/* Subtle corner glows */}
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
              top: 0,
              left: 0,
              width: "40%",
              height: "40%",
              background:
                "radial-gradient(ellipse at top left, rgba(99,102,241,0.04) 0%, transparent 70%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 0,
              right: 0,
              width: "40%",
              height: "40%",
              background:
                "radial-gradient(ellipse at bottom right, rgba(16,185,129,0.03) 0%, transparent 70%)",
            }}
          />
        </div>

        {/* Floating tech icons (desktop only) */}
        {!isMobile && (
          <div
            className="inv-bg-desktop"
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
                  opacity: 0.07,
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
              {/* Desktop layout: icon+arrow top row, text bottom */}
              <div
                className="inv-desktop-only"
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
              <div
                className="inv-desktop-only"
                style={{ width: "100%", display: "block" }}
              >
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
              {/* Mobile layout: icon | text | arrow in a row */}
              <div
                className="inv-mobile-only"
                style={{
                  display: "none",
                  alignItems: "center",
                  gap: 16,
                  width: "100%",
                }}
              >
                <div
                  className="inv-icon-box"
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    flexShrink: 0,
                    background:
                      "linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24,
                    color: "var(--accent)",
                  }}
                >
                  <RiArchiveLine />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="inv-card-title"
                    style={{
                      fontWeight: 700,
                      fontSize: 16,
                      color: "var(--text-primary)",
                      marginBottom: 3,
                    }}
                  >
                    Tech Inventory
                  </div>
                  <div
                    className="inv-card-desc"
                    style={{
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      lineHeight: 1.4,
                    }}
                  >
                    Cables, adapters, cameras &amp; more
                  </div>
                </div>
                <span
                  className="inv-arrow"
                  style={{
                    color: "var(--accent)",
                    fontSize: 18,
                    flexShrink: 0,
                  }}
                >
                  →
                </span>
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
              {/* Desktop layout */}
              <div
                className="inv-desktop-only"
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
              <div
                className="inv-desktop-only"
                style={{ width: "100%", display: "block" }}
              >
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
              {/* Mobile layout */}
              <div
                className="inv-mobile-only"
                style={{
                  display: "none",
                  alignItems: "center",
                  gap: 16,
                  width: "100%",
                }}
              >
                <div
                  className="inv-icon-box"
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    flexShrink: 0,
                    background:
                      "linear-gradient(135deg, rgba(16,185,129,0.15), rgba(5,150,105,0.15))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24,
                    color: "#10b981",
                  }}
                >
                  <RiMacbookLine />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    className="inv-card-title"
                    style={{
                      fontWeight: 700,
                      fontSize: 16,
                      color: "var(--text-primary)",
                      marginBottom: 3,
                    }}
                  >
                    Laptop Loans
                  </div>
                  <div
                    className="inv-card-desc"
                    style={{
                      fontSize: 12,
                      color: "var(--text-secondary)",
                      lineHeight: 1.4,
                    }}
                  >
                    Borrow MacBooks for ministry or projects
                  </div>
                </div>
                <span
                  className="inv-arrow"
                  style={{ color: "#10b981", fontSize: 18, flexShrink: 0 }}
                >
                  →
                </span>
              </div>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
