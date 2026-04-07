import { Inter } from 'next/font/google';
import './globals.css';
import './styles/web.css';
import './styles/pwa.css';
import './styles/mobile.css';
import { AuthProvider } from '@/lib/context/AuthContext';
import { CartProvider } from '@/lib/context/CartContext';
import { ToastProvider } from '@/lib/context/ToastContext';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

export const metadata = {
  title: 'Tech Inventory | Church Tech Ministry',
  description: 'Equipment inventory and loan management for church tech ministry ICs',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Tech Inventory',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  viewportFit: 'cover',
  themeColor: '#0a0e1a',
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      data-shell="desktop-web"
      data-device="desktop"
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
                var media = window.matchMedia("(display-mode: standalone)");
                var applyShellMode = function () {
                  var isPwa = media.matches || window.navigator.standalone === true;
                  var isMobileViewport = window.innerWidth <= 768;
                  var ua = window.navigator.userAgent || "";
                  var isIOS =
                    /iPad|iPhone|iPod/.test(ua) ||
                    (window.navigator.platform === "MacIntel" &&
                      window.navigator.maxTouchPoints > 1);
                  doc.dataset.shell = isPwa
                    ? "pwa"
                    : isMobileViewport
                      ? "mobile-web"
                      : "desktop-web";
                  doc.dataset.device = isMobileViewport ? "mobile" : "desktop";
                  doc.dataset.platform = isIOS ? "ios" : "default";
                };

                applyShellMode();
                window.addEventListener("resize", applyShellMode, { passive: true });
                window.addEventListener("orientationchange", applyShellMode, { passive: true });

                if (media.addEventListener) {
                  media.addEventListener("change", applyShellMode);
                } else if (media.addListener) {
                  media.addListener(applyShellMode);
                }
              })();
            `,
          }}
        />
      </head>
      <body suppressHydrationWarning>
        <AuthProvider>
          <CartProvider>
            <ToastProvider>
              {children}
            </ToastProvider>
          </CartProvider>
        </AuthProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js').catch(() => {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}
