"use client";
import { useState, useEffect } from "react";
import { RiDownload2Line, RiCloseLine, RiSmartphoneLine } from "react-icons/ri";

export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const shell = document.documentElement.dataset.shell;
    if (shell !== "mobile-web") return;

    // Don't show if dismissed recently
    const dismissed = localStorage.getItem("pwa-install-dismissed");
    if (
      dismissed &&
      Date.now() - parseInt(dismissed, 10) < 7 * 24 * 60 * 60 * 1000
    )
      return;

    // Detect iOS (Safari doesn't fire beforeinstallprompt)
    const ua = navigator.userAgent;
    const isiOS =
      /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isiOS) {
      setTimeout(() => {
        setIsIOS(true);
        setShowBanner(true);
      }, 0);
      return;
    }

    // Android / Chrome: listen for beforeinstallprompt
    const handler = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowBanner(true);
    };
    const installedHandler = () => {
      setShowBanner(false);
      setDeferredPrompt(null);
      localStorage.setItem("pwa-install-dismissed", Date.now().toString());
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setShowBanner(false);
      }
      setDeferredPrompt(null);
    }
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem("pwa-install-dismissed", Date.now().toString());
  };

  if (!showBanner) return null;

  return (
    <div className="install-banner">
      <div className="install-banner-icon">
        <RiSmartphoneLine />
      </div>
      <div className="install-banner-text">
        <strong>Install Tech Inventory</strong>
        {isIOS ? (
          <span>
            Tap the{" "}
            <span
              style={{
                display: "inline-flex",
                verticalAlign: "middle",
                color: "var(--accent)",
                fontSize: 16,
              }}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M16 5l-1.42 1.42-1.59-1.59V16h-1.98V4.83L9.42 6.42 8 5l4-4 4 4zm4 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2V10a2 2 0 012-2h3v2H6v11h12V10h-3V8h3a2 2 0 012 2z" />
              </svg>
            </span>{" "}
            Share button, then &quot;Add to Home Screen&quot;
          </span>
        ) : (
          <span>Get quick access from your home screen</span>
        )}
      </div>
      <div className="install-banner-actions">
        {!isIOS && (
          <button className="install-banner-btn" onClick={handleInstall}>
            <RiDownload2Line /> Install
          </button>
        )}
        <button
          className="install-banner-close"
          aria-label="Dismiss install prompt"
          onClick={handleDismiss}
        >
          <RiCloseLine />
        </button>
      </div>
    </div>
  );
}
