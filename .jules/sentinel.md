## 2025-03-08 - Adding Security Headers in Next.js
**Vulnerability:** The application was missing critical HTTP security headers (like Content-Security-Policy, X-Frame-Options, X-Content-Type-Options) leaving it potentially exposed to clickjacking, content sniffing, and some forms of XSS if a vulnerability exists elsewhere.
**Learning:** Next.js doesn't provide strict default security headers out of the box. They must be explicitly configured in `next.config.mjs` using the `headers()` function to ensure all routes are protected. It's an important defense-in-depth measure.
**Prevention:** Always include a baseline set of security headers for all web apps by defining them in `next.config.mjs` during the initial project setup.
