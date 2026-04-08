import { Inter } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import "./styles/web.css";
import "./styles/pwa.css";
import "./styles/mobile.css";
import { AuthProvider } from "@/lib/context/AuthContext";
import { CartProvider } from "@/lib/context/CartContext";
import { ToastProvider } from "@/lib/context/ToastContext";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata = {
  title: "Tech Inventory | Church Tech Ministry",
  description:
    "Equipment inventory and loan management for church tech ministry ICs",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Tech Inventory",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  viewportFit: "cover",
  themeColor: "#060914",
};

function detectInitialShell(userAgent) {
  const ua = userAgent || "";
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua));
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
      ua,
    );

  return {
    device: isMobile ? "mobile" : "desktop",
    platform: isIOS ? "ios" : "default",
    shell: isMobile ? "mobile-web" : "desktop-web",
  };
}

export default async function RootLayout({ children }) {
  const headerStore = await headers();
  const userAgent = headerStore.get("user-agent") || "";
  const initialShell = detectInitialShell(userAgent);
  const serviceWorkerBootstrap =
    process.env.NODE_ENV === "production"
      ? `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
              navigator.serviceWorker
                .register('/sw.js')
                .then((registration) => {
                  registration.update().catch(() => {});
                })
                .catch(() => {});
            });
          }
        `
      : `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
              navigator.serviceWorker.getRegistrations().then((registrations) => {
                registrations.forEach((registration) => registration.unregister());
              }).catch(() => {});

              if ('caches' in window) {
                caches.keys().then((keys) => {
                  keys
                    .filter((key) => key.startsWith('tech-inventory'))
                    .forEach((key) => caches.delete(key));
                }).catch(() => {});
              }
            });
          }
        `;

  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-shell={initialShell.shell}
      data-device={initialShell.device}
      data-platform={initialShell.platform}
      className={inter.variable}
    >
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="color-scheme" content="dark" />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function () {
                var doc = document.documentElement;
                var shellMedia = window.matchMedia("(display-mode: standalone)");
                var mobileMedia = window.matchMedia("(max-width: 768px)");
                var frame = 0;
                var getNextState = function () {
                  var isPwa = shellMedia.matches || window.navigator.standalone === true;
                  var isMobileViewport = mobileMedia.matches;
                  var ua = window.navigator.userAgent || "";
                  var isIOS =
                    /iPad|iPhone|iPod/.test(ua) ||
                    (window.navigator.platform === "MacIntel" &&
                      window.navigator.maxTouchPoints > 1);
                  return {
                    shell: isPwa
                      ? "pwa"
                      : isMobileViewport
                        ? "mobile-web"
                        : "desktop-web",
                    device: isMobileViewport ? "mobile" : "desktop",
                    platform: isIOS ? "ios" : "default"
                  };
                };

                var applyShellMode = function (force) {
                  var next = getNextState();
                  if (
                    force ||
                    doc.dataset.shell !== next.shell ||
                    doc.dataset.device !== next.device ||
                    doc.dataset.platform !== next.platform
                  ) {
                    doc.dataset.shell = next.shell;
                    doc.dataset.device = next.device;
                    doc.dataset.platform = next.platform;
                  }
                };

                var scheduleShellMode = function (force) {
                  if (frame) {
                    cancelAnimationFrame(frame);
                  }
                  frame = requestAnimationFrame(function () {
                    frame = 0;
                    applyShellMode(force);
                  });
                };

                applyShellMode(true);
                window.addEventListener("pageshow", function () {
                  scheduleShellMode(false);
                }, { passive: true });

                if (shellMedia.addEventListener) {
                  shellMedia.addEventListener("change", function () {
                    scheduleShellMode(false);
                  });
                } else if (shellMedia.addListener) {
                  shellMedia.addListener(function () {
                    scheduleShellMode(false);
                  });
                }

                if (mobileMedia.addEventListener) {
                  mobileMedia.addEventListener("change", function () {
                    scheduleShellMode(false);
                  });
                } else if (mobileMedia.addListener) {
                  mobileMedia.addListener(function () {
                    scheduleShellMode(false);
                  });
                }
              })();
            `,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <AuthProvider>
          <CartProvider>
            <ToastProvider>{children}</ToastProvider>
          </CartProvider>
        </AuthProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: serviceWorkerBootstrap,
          }}
        />
      </body>
    </html>
  );
}
