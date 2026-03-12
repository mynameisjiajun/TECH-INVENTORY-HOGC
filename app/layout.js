import './globals.css';
import { AuthProvider } from '@/lib/AuthContext';
import { CartProvider } from '@/lib/CartContext';
import { ToastProvider } from '@/lib/ToastContext';

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
  themeColor: '#6366f1',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body>
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
