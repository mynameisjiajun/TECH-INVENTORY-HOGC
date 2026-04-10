"use client";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/context/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RiServerLine, RiKeyLine } from "react-icons/ri";

export default function RegisterPage() {
  const { register, user } = useAuth();
  const router = useRouter();
  const [formData, setFormData] = useState({
    username: "",
    password: "",
    confirm_password: "",
    display_name: "",
    email: "",
    invite_code: "",
    telegram_handle: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (user) router.replace("/home");
  }, [user, router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (formData.password.length < 6) {
      setError("Password must be at least 6 characters");
      setLoading(false);
      return;
    }

    if (formData.password !== formData.confirm_password) {
      setError("Passwords do not match");
      setLoading(false);
      return;
    }

    const rawHandle = formData.telegram_handle.trim().replace(/^@/, "");
    if (!rawHandle) {
      setError("Telegram handle is required");
      setLoading(false);
      return;
    }

    const result = await register(
      formData.username,
      formData.password,
      formData.display_name,
      formData.invite_code,
      formData.email,
      rawHandle,
    );
    if (result.ok) {
      router.push("/home");
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  const update = (field) => (e) =>
    setFormData((p) => ({ ...p, [field]: e.target.value }));

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <RiServerLine style={{ fontSize: 40, color: "var(--accent)" }} />
        </div>
        <h1>Create Account</h1>
        <p className="auth-subtitle">Join the Tech Ministry team</p>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label>
              <RiKeyLine style={{ verticalAlign: "middle" }} /> Invite Code
            </label>
            <input
              type="password"
              value={formData.invite_code}
              onChange={update("invite_code")}
              placeholder="Enter the secret invite code"
              required
              autoFocus
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
            />
          </div>
          <div className="input-group">
            <label>Display Name</label>
            <input
              type="text"
              value={formData.display_name}
              onChange={update("display_name")}
              placeholder="Your name (e.g., Jia Jun)"
              required
              autoComplete="name"
            />
          </div>
          <div className="input-group">
            <label>Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={update("email")}
              placeholder="your.email@example.com"
              required
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="email"
            />
            <span
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                marginTop: 4,
                display: "block",
              }}
            >
              Used for password reset emails
            </span>
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
            <span
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                marginTop: 4,
                display: "block",
              }}
            >
              Required for loan notifications and reminders
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
              placeholder="Choose a password (min 6 chars)"
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
              placeholder="Confirm your password"
              required
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="new-password"
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 8 }}
            disabled={loading}
          >
            {loading ? "Creating account..." : "Create Account"}
          </button>
        </form>

        <p className="auth-footer">
          Already have an account? <Link href="/login">Sign In</Link>
        </p>
      </div>
    </div>
  );
}
