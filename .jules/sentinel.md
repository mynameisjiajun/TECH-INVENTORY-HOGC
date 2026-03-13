
## 2024-05-24 - Rate Limiting IP Spoofing
**Vulnerability:** The authentication rate limiter blindly trusted the `x-forwarded-for` header.
**Learning:** In Next.js App Router on Vercel, `x-forwarded-for` can be spoofed by an attacker. Instead, `request.ip` or `request.headers.get("x-real-ip")` must be prioritized, as these are set by the infrastructure (Vercel/Nginx) and cannot be overridden by the client.
**Prevention:** Use a centralized IP extraction utility that prioritizes infrastructure-provided headers (`request.ip` and `x-real-ip`) before falling back to `x-forwarded-for`.
