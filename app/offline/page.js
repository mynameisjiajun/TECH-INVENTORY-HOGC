"use client";
import { RiWifiOffLine, RiRefreshLine } from "react-icons/ri";

export default function OfflinePage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        textAlign: "center",
      }}
    >
      <div>
        <RiWifiOffLine
          style={{ fontSize: 56, color: "var(--text-muted)", marginBottom: 16 }}
        />
        <h1
          style={{
            fontSize: 22,
            fontWeight: 700,
            marginBottom: 8,
            color: "var(--text-primary)",
          }}
        >
          You&apos;re Offline
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "var(--text-secondary)",
            marginBottom: 24,
            maxWidth: 320,
            margin: "0 auto 24px",
            lineHeight: 1.5,
          }}
        >
          No internet connection. Pages you&apos;ve visited before and inventory
          data are still available offline.
        </p>
        <button
          className="btn btn-primary"
          onClick={() => window.location.reload()}
        >
          <RiRefreshLine /> Try Again
        </button>
      </div>
    </div>
  );
}
