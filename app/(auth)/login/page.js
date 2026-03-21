"use client";
import { useRef, useState } from "react";
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
  const [, setLogoTapCount] = useState(0);
  const [easterMode, setEasterMode] = useState(false);
  const requiredTaps = 7;
  const audioContextRef = useRef(null);

  const playLogoTapFeedback = async () => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(14);
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    }

    const ctx = audioContextRef.current;
    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch {
        return;
      }
    }

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "square";
    osc.frequency.setValueAtTime(820, now);
    osc.frequency.exponentialRampToValueAtTime(560, now + 0.12);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);
  };

  const easterParticles = Array.from({ length: 16 }, (_, i) => ({
    id: i,
    xDelay: `${-((i % 9) * 1.1 + i * 0.35)}s`,
    yDelay: `${-((i % 7) * 1.3 + i * 0.25)}s`,
    xDuration: `${8 + (i % 6) * 1.35}s`,
    yDuration: `${6.5 + (i % 5) * 1.1}s`,
    size: `${26 + (i % 6) * 6}px`,
    hue: `${(i * 37) % 360}deg`,
  }));

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

  const handleLogoTap = () => {
    void playLogoTapFeedback();

    setLogoTapCount((count) => {
      const next = count + 1;
      if (next >= requiredTaps) {
        setEasterMode(true);
        return 0;
      }
      return next;
    });
  };

  return (
    <>
      <FluidBackground />
      <div className={`auth-container${easterMode ? " login-easter-egg" : ""}`}>
        {easterMode && (
          <div className="login-easter-bg" aria-hidden="true">
            {easterParticles.map((p) => (
              <div
                key={p.id}
                className="login-easter-dvd"
                style={{
                  "--x-range": `calc(100vw - ${p.size})`,
                  animationDuration: p.xDuration,
                  animationDelay: p.xDelay,
                }}
              >
                <span
                  className="login-easter-number"
                  style={{
                    "--y-range": `calc(100vh - ${p.size})`,
                    animationDuration: p.yDuration,
                    animationDelay: p.yDelay,
                    fontSize: p.size,
                    filter: `hue-rotate(${p.hue})`,
                  }}
                >
                  67
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="auth-card glass-panel">
          <div style={{ textAlign: "center", marginBottom: 8 }}>
            <button type="button" className="logo-secret-hitbox" onClick={handleLogoTap}>
              <RiServerLine style={{ fontSize: 40, color: "var(--accent)" }} />
            </button>
          </div>
          <h1>Welcome Back</h1>
          <p className="auth-subtitle">
            {easterMode ? "67 mode enabled" : "Sign in to Tech Inventory"}
          </p>

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
