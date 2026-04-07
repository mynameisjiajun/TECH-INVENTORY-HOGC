"use client";

import Navbar from "@/components/Navbar";
import CartPanel from "@/components/CartPanel";

export default function AppShellLoading({
  showCartPanel = true,
  containerStyle,
}) {
  return (
    <>
      <Navbar />
      {showCartPanel ? <CartPanel /> : null}
      <div className="page-container" style={containerStyle}>
        <div className="page-shell-loading" aria-live="polite">
          <div className="page-header page-header-skeleton" aria-hidden="true">
            <div className="shell-line shell-line-title" />
            <div className="shell-line shell-line-subtitle" />
          </div>

          <div className="shell-loading-card">
            <div className="spinner" />
            <div className="shell-loading-copy">
              <div className="shell-line shell-line-body" />
              <div className="shell-line shell-line-body shell-line-body-short" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
