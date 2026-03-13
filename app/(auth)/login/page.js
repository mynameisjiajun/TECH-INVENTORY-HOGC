"use client";
import { useState } from "react";
import { useAuth } from "@/lib/context/AuthContext";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RiServerLine } from "react-icons/ri";
import FluidBackground from "@/components/FluidBackground";

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    const result = await login(username, password);
    if (result.ok) {
      // Trigger inventory sync in the background so data is fresh
      fetch("/api/items/sync", { method: "POST" }).catch(() => {});
      router.push("/inventory");
    } else {
      setError(result.error);
    }
    setLoading(false);
  };

  return (
    <>
    <FluidBackground />
    <div className="auth-container">
      <div className="auth-card glass-panel">
        <div style={{ textAlign: "center", marginBottom: 8 }}>
          <RiServerLine style={{ fontSize: 40, color: "var(--accent)" }} />
        </div>
        <h1>Welcome Back</h1>
        <p className="auth-subtitle">Sign in to Tech Inventory</p>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label>Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              required
              autoFocus
            />
          </div>
          <div className="input-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
            />
          </div>
          <div
            style={{
              textAlign: "right",
              marginBottom: 8,
              marginTop: -8,
            }}
          >
            <Link
              href="/reset-password"
              style={{ fontSize: 12, color: "var(--accent)" }}
            >
              Forgot password?
            </Link>
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: "100%", marginTop: 8 }}
            disabled={loading}
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p className="auth-footer">
          Don&apos;t have an account? <Link href="/register">Register</Link>
        </p>
      </div>
    </div>
    </>
  );
}
