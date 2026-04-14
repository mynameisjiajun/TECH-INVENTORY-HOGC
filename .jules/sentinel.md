## 2024-05-25 - Weak Password Validation
**Vulnerability:** Hardcoded minimum password length of 6 characters across multiple authentication and user management endpoints, lacking sufficient complexity requirements to deter brute-force or dictionary attacks.
**Learning:** Hardcoded, simple validation limits scattered across frontend and backend code lead to inconsistent enforcement and weak security defaults. Validation logic should ideally be centralized.
**Prevention:** Implement centralized password strength validation functions (e.g., using zmod or a dedicated utility) to ensure consistent, strong policies (min 8+ chars, complexity rules) are applied universally across all auth and user management routes.
