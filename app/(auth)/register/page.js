"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/context/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RiServerLine, RiArrowLeftLine } from "react-icons/ri";
import { MINISTRY_OPTIONS } from "@/lib/utils/ministries";

export default function RegisterPage() {
  const { register, user } = useAuth();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    confirm_password: "",
    display_name: "",
    email: "",
    telegram_handle: "",
    ministry: "",
  });
  const [ministryIsOther, setMinistryIsOther] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) router.replace("/home");
  }, [user, router]);

  const update = (field) => (e) =>
    setFormData((p) => ({ ...p, [field]: e.target.value }));

  const handleStep1 = (e) => {
    e.preventDefault();
    setError("");
    if (formData.password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (formData.password !== formData.confirm_password) {
      setError("Passwords do not match");
      return;
    }
    setStep(2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    const rawHandle = formData.telegram_handle.trim().replace(/^@/, "");
    if (!rawHandle) {
      setError("Telegram handle is required");
      return;
    }

    setLoading(true);
    const result = await register(
      formData.username,
      formData.password,
      formData.display_name,
      null,
      formData.email,
      rawHandle,
      formData.ministry.trim() || null,
    );
    if (result.ok) {
      router.push("/home");
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  return (
    <div className="auth-container">
      <div className="auth-card">
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <RiServerLine style={{ fontSize: 40, color: "var(--accent)" }} />
        </div>
        <h1>Create Account</h1>
        <p className="auth-subtitle">Join the Tech Ministry team</p>

        {/* Step indicator */}
        <div style={{ margin: "16px 0 20px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ height: 4, borderRadius: 99, background: "var(--border)", overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: step === 1 ? "50%" : "100%",
              borderRadius: 99,
              background: "var(--accent)",
              transition: "width 0.35s ease",
            }} />
          </div>
          <span style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "right" }}>
            Step {step} of 2
          </span>
        </div>

        {error && <div className="error-msg">{error}</div>}

        {/* Step 1 — Account Details */}
        {step === 1 && (
          <form onSubmit={handleStep1}>
            <div className="input-group">
              <label>Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={update("email")}
                placeholder="your.email@example.com"
                required
                autoFocus
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="email"
              />
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, display: "block" }}>
                Used for password reset emails
              </span>
            </div>
            <div className="input-group">
              <label>Username</label>
              <input
                type="text"
                value={formData.username}
                onChange={update("username")}
                placeholder="Choose a username"
                required
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="username"
                spellCheck={false}
              />
            </div>
            <div className="input-group">
              <label>Password</label>
              <input
                type="password"
                value={formData.password}
                onChange={update("password")}
                placeholder="Min 6 characters"
                required
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="new-password"
              />
            </div>
            <div className="input-group">
              <label>Confirm Password</label>
              <input
                type="password"
                value={formData.confirm_password}
                onChange={update("confirm_password")}
                placeholder="Repeat your password"
                required
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="new-password"
              />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: 8 }}>
              Next →
            </button>
          </form>
        )}

        {/* Step 2 — About You */}
        {step === 2 && (
          <form onSubmit={handleSubmit}>
            <div className="input-group">
              <label>Display Name</label>
              <input
                type="text"
                value={formData.display_name}
                onChange={update("display_name")}
                placeholder="Your name (e.g., Jia Jun)"
                required
                autoFocus
                autoComplete="name"
              />
            </div>
            <div className="input-group">
              <label>Telegram Handle</label>
              <input
                type="text"
                value={formData.telegram_handle}
                onChange={update("telegram_handle")}
                placeholder="@yourhandle"
                required
                autoCapitalize="off"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
              />
              <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, display: "block" }}>
                Used for loan notifications and reminders
              </span>
            </div>
            <div className="input-group">
              <label>Ministry / Department <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>(optional)</span></label>
              <select
                value={ministryIsOther ? "Others" : formData.ministry}
                onChange={(e) => {
                  if (e.target.value === "Others") {
                    setMinistryIsOther(true);
                    setFormData((p) => ({ ...p, ministry: "" }));
                  } else {
                    setMinistryIsOther(false);
                    setFormData((p) => ({ ...p, ministry: e.target.value }));
                  }
                }}
                style={{ width: "100%", appearance: "none" }}
              >
                <option value="">— Select your ministry —</option>
                {MINISTRY_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
                <option value="Others">Others</option>
              </select>
              {ministryIsOther && (
                <input
                  type="text"
                  value={formData.ministry}
                  onChange={update("ministry")}
                  placeholder="Enter your ministry or department"
                  autoCapitalize="words"
                  style={{ marginTop: 8 }}
                />
              )}
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: "100%", marginTop: 8 }}
              disabled={loading}
            >
              {loading ? "Creating account..." : "Create Account"}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              style={{ width: "100%", marginTop: 8, gap: 6 }}
              onClick={() => { setError(""); setStep(1); }}
            >
              <RiArrowLeftLine /> Back
            </button>
          </form>
        )}

        <p className="auth-footer" style={{ marginTop: 16 }}>
          Already have an account? <Link href="/login">Sign In</Link>
        </p>
      </div>
    </div>
  );
}
