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

  if (loading || !user) return <AppShellLoading />;

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

  const circuitRows = isMobile
    ? [18, 36, 54, 72, 90]
    : [15, 30, 45, 60, 75, 90];
  const circuitColumns = isMobile
    ? [10, 30, 50, 70, 90]
    : [10, 25, 40, 55, 70, 85];
  const circuitNodes = isMobile
    ? [
        { top: "18%", left: "30%" },
        { top: "18%", left: "70%" },
        { top: "36%", left: "10%" },
        { top: "36%", left: "50%" },
        { top: "54%", left: "70%" },
        { top: "72%", left: "10%" },
        { top: "72%", left: "50%" },
        { top: "90%", left: "30%" },
      ]
    : [
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
      ];
  const circuitTraces = isMobile
    ? [
        {
          axis: "h",
          style: {
            top: "36%",
            left: "10%",
            width: "40%",
            animation: "circuitPulse1 6s ease-in-out infinite",
          },
        },
        {
          axis: "h",
          style: {
            top: "72%",
            left: "30%",
            width: "40%",
            animation: "circuitPulse2 7s ease-in-out 1s infinite",
          },
        },
        {
          axis: "v",
          style: {
            left: "50%",
            top: "36%",
            height: "18%",
            animation: "circuitPulse3 8s ease-in-out 2s infinite",
          },
        },
      ]
    : [
        {
          axis: "h",
          style: {
            top: "30%",
            left: "10%",
            width: "45%",
            animation: "circuitPulse1 6s ease-in-out infinite",
          },
        },
        {
          axis: "h",
          style: {
            top: "75%",
            left: "40%",
            width: "45%",
            animation: "circuitPulse2 6s ease-in-out 1s infinite",
          },
        },
        {
          axis: "v",
          style: {
            left: "55%",
            top: "30%",
            height: "30%",
            animation: "circuitPulse3 6s ease-in-out 2s infinite",
          },
        },
        {
          axis: "h",
          style: {
            top: "45%",
            left: "25%",
            width: "30%",
            animation: "circuitPulse2 8s ease-in-out 3s infinite",
          },
        },
        {
          axis: "v",
          style: {
            left: "25%",
            top: "45%",
            height: "30%",
            animation: "circuitPulse1 7s ease-in-out 1.5s infinite",
          },
        },
        {
          axis: "h",
          style: {
            top: "60%",
            left: "55%",
            width: "30%",
            animation: "circuitPulse3 9s ease-in-out 0.5s infinite",
          },
        },
      ];
  const inventoryOptions = [
    {
      key: "tech",
      href: "/inventory/tech-inventory",
      title: "Tech Inventory",
      description: "Cables, adapters, cameras & more",
      Icon: RiArchiveLine,
    },
    {
      key: "laptop",
      href: "/inventory/laptop-loans",
      title: "Laptop Loans",
      description: "Borrow MacBooks for ministry or projects",
      Icon: RiMacbookLine,
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
        .inv-shell {
          position: relative;
          overflow: hidden;
          min-height: calc(100vh - 64px);
          display: flex;
          align-items: center;
        }
        .inv-bg-layer {
          position: absolute;
          inset: 0;
          pointer-events: none;
          z-index: 0;
        }
        .inv-corner-glow {
          position: absolute;
          width: 40%;
          height: 40%;
        }
        .inv-corner-glow--start {
          top: 0;
          left: 0;
          background: radial-gradient(ellipse at top left, rgba(99,102,241,0.04) 0%, transparent 70%);
        }
        .inv-corner-glow--end {
          right: 0;
          bottom: 0;
          background: radial-gradient(ellipse at bottom right, rgba(16,185,129,0.03) 0%, transparent 70%);
        }
        .inv-content {
          position: relative;
          z-index: 1;
          display: flex;
          width: 100%;
          flex-direction: column;
          align-items: center;
        }
        .inv-heading-wrap {
          margin-bottom: 48px;
          text-align: center;
        }
        .inv-heading {
          margin-bottom: 10px;
          font-size: 36px;
          font-weight: 800;
          letter-spacing: -0.02em;
        }
        .inv-subheading {
          margin: 0;
          color: var(--text-secondary);
          font-size: 16px;
        }
        .inv-grid {
          display: grid;
          width: 100%;
          max-width: 780px;
          grid-template-columns: repeat(2, 1fr);
          gap: 24px;
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
        .inv-card--desktop {
          flex-direction: column;
          gap: 20px;
          padding: 36px 32px;
          border-radius: 20px;
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
        .inv-card-head {
          display: flex;
          width: 100%;
          align-items: center;
          justify-content: space-between;
        }
        .inv-card-copy {
          width: 100%;
        }
        .inv-icon-box {
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .inv-icon-box--desktop {
          width: 72px;
          height: 72px;
          border-radius: 18px;
          font-size: 32px;
        }
        .inv-icon-box--mobile {
          width: 52px;
          height: 52px;
          border-radius: 14px;
          font-size: 24px;
        }
        .inv-card-tech .inv-icon-box {
          background: linear-gradient(135deg, rgba(99,102,241,0.15), rgba(139,92,246,0.15));
          border: 1px solid rgba(99,102,241,0.15);
          color: var(--accent);
        }
        .inv-card-laptop .inv-icon-box {
          background: linear-gradient(135deg, rgba(16,185,129,0.15), rgba(5,150,105,0.15));
          border: 1px solid rgba(16,185,129,0.15);
          color: #10b981;
        }
        .inv-card-title {
          margin-bottom: 6px;
          color: var(--text-primary);
          font-size: 20px;
          font-weight: 700;
        }
        .inv-card-desc {
          color: var(--text-secondary);
          font-size: 14px;
          line-height: 1.5;
        }
        .inv-card-compact {
          display: none;
          width: 100%;
          align-items: center;
          gap: 16px;
        }
        .inv-card-compact-copy {
          min-width: 0;
          flex: 1;
        }
        .inv-card-compact .inv-card-title {
          margin-bottom: 3px;
          font-size: 16px;
        }
        .inv-card-compact .inv-card-desc {
          font-size: 12px;
          line-height: 1.4;
        }
        .inv-card-tech .inv-arrow {
          color: var(--accent);
        }
        .inv-card-laptop .inv-arrow {
          color: #10b981;
        }

        /* --- Mobile layout --- */
        @media (max-width: 768px) {
          .inv-shell {
            align-items: flex-start;
            padding-top: 0;
          }
          .inv-bg-circuit-line {
            background: rgba(99,102,241,0.02);
          }
          .inv-bg-node {
            background: rgba(99,102,241,0.08);
          }
          .inv-corner-glow {
            opacity: 0.6;
          }
          .inv-grid {
            grid-template-columns: 1fr !important;
            max-width: 100% !important;
            gap: 12px !important;
          }
          .inv-content {
            justify-content: flex-start;
          }
          .inv-card--desktop {
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
            font-size: 15px !important;
          }
          .inv-card-desc {
            font-size: 11px !important;
          }
          .inv-heading {
            font-size: 22px !important;
            margin-bottom: 6px !important;
          }
          .inv-subheading {
            font-size: 13px !important;
          }
          .inv-heading-wrap {
            margin-bottom: 28px !important;
          }
          .inv-desktop-only {
            display: none !important;
          }
          .inv-card-compact {
            display: flex !important;
          }
          .inv-bg-desktop {
            display: none !important;
          }
        }
      `}</style>
      <div className="inventory-landing inv-shell">
        {/* Circuit board grid */}
        <div className="inv-bg-layer">
          {/* Horizontal circuit lines */}
          {circuitRows.map((pct) => (
            <div
              key={`h${pct}`}
              className="inv-bg-circuit-line h"
              style={{ top: `${pct}%` }}
            />
          ))}
          {/* Vertical circuit lines */}
          {circuitColumns.map((pct) => (
            <div
              key={`v${pct}`}
              className="inv-bg-circuit-line v"
              style={{ left: `${pct}%` }}
            />
          ))}
          {/* Intersection nodes */}
          {circuitNodes.map(({ top, left }, i) => (
            <div
              key={`n${i}`}
              className="inv-bg-node"
              style={{ top, left, animationDelay: `${i * 0.4}s` }}
            />
          ))}
          {/* Animated data traces */}
          {circuitTraces.map((trace, index) => (
            <div
              key={`trace-${index}`}
              className={`inv-bg-trace ${trace.axis}`}
              style={trace.style}
            />
          ))}
        </div>

        {/* Subtle corner glows */}
        <div className="inv-bg-layer">
          <div className="inv-corner-glow inv-corner-glow--start" />
          <div className="inv-corner-glow inv-corner-glow--end" />
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

        <div className="page-container inv-content">
          <div className="inv-heading-wrap">
            <h1 className="inv-heading">Inventory</h1>
            <p className="inv-subheading">What would you like to browse?</p>
          </div>

          <div className="inv-grid">
            {inventoryOptions.map(({ key, href, title, description, Icon }) => (
              <button
                key={key}
                className={`inv-card inv-card-${key} inv-card--desktop`}
                onClick={() => router.push(href)}
              >
                <div className="inv-desktop-only inv-card-head">
                  <div className="inv-icon-box inv-icon-box--desktop">
                    <Icon />
                  </div>
                  <span className="inv-arrow" style={{ fontSize: 22 }}>
                    →
                  </span>
                </div>
                <div className="inv-desktop-only inv-card-copy">
                  <div className="inv-card-title">{title}</div>
                  <div className="inv-card-desc">{description}</div>
                </div>
                <div className="inv-card-compact">
                  <div className="inv-icon-box inv-icon-box--mobile">
                    <Icon />
                  </div>
                  <div className="inv-card-compact-copy">
                    <div className="inv-card-title">{title}</div>
                    <div className="inv-card-desc">{description}</div>
                  </div>
                  <span className="inv-arrow" style={{ fontSize: 18 }}>
                    →
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
