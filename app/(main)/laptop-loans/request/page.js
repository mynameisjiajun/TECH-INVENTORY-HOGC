"use client";
import { useState, useEffect, useMemo } from "react";
import { useAuth } from "@/lib/context/AuthContext";
import Navbar from "@/components/Navbar";
import CartPanel from "@/components/CartPanel";
import Link from "next/link";
import { LOANABLE_LAPTOPS, TIER_LABELS } from "@/lib/laptops";

const MINISTRIES = ["MG", "SI", "PROJ", "TECH", "IMD", "VP", "LANG"];

function toDatetimeLocal(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const _now = new Date();
const DEFAULT_FORM = {
  ministry: "",
  laptopId: "",
  startDatetime: toDatetimeLocal(_now),
  endDatetime: toDatetimeLocal(new Date(_now.getTime() + 3600000)),
  reason: "",
};

export default function LaptopLoanRequest() {
  const { user } = useAuth();
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState(DEFAULT_FORM);

  useEffect(() => {
    fetch("/api/laptop-loans")
      .then((r) => r.json())
      .then((data) => setLoans(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const unavailableLaptops = useMemo(() => {
    const start = form.startDatetime.slice(0, 10);
    const end = form.endDatetime.slice(0, 10);
    return new Set(
      loans
        .filter((l) => l.status === "active" && l.start_date <= end && l.end_date >= start)
        .map((l) => l.laptop_id)
    );
  }, [loans, form.startDatetime, form.endDatetime]);

  function setField(key, value) {
    setForm((prev) => {
      const updated = { ...prev, [key]: value };
      if (key === "startDatetime") {
        const start = new Date(value);
        const minEnd = new Date(start.getTime() + 3600000);
        if (new Date(updated.endDatetime) < minEnd) {
          updated.endDatetime = toDatetimeLocal(minEnd);
        }
        if (updated.laptopId) {
          const s = value.slice(0, 10);
          const e = updated.endDatetime.slice(0, 10);
          const clashes = loans.some(
            (l) => l.laptop_id === updated.laptopId && l.status === "active" && l.start_date <= e && l.end_date >= s
          );
          if (clashes) updated.laptopId = "";
        }
      }
      return updated;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.laptopId) { setError("Please select a laptop."); return; }
    setError("");
    setLoading(true);
    try {
      const laptop = LOANABLE_LAPTOPS.find((l) => l.id === form.laptopId);
      const res = await fetch("/api/laptop-loans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          laptopId: form.laptopId,
          laptopName: laptop?.name || form.laptopId,
          ministry: form.ministry || undefined,
          startDatetime: form.startDatetime,
          endDatetime: form.endDatetime,
          reason: form.reason,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error || "Submission failed.");
      } else {
        setSubmitted(true);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const minEnd = useMemo(
    () => toDatetimeLocal(new Date(new Date(form.startDatetime).getTime() + 3600000)),
    [form.startDatetime]
  );

  if (submitted) {
    return (
      <>
        <Navbar />
        <CartPanel />
        <div className="page-container" style={{ maxWidth: 560 }}>
          <div className="card card-body" style={{ textAlign: "center", padding: 48 }}>
            <div
              style={{
                width: 56, height: 56, borderRadius: "50%",
                background: "var(--success)", display: "flex",
                alignItems: "center", justifyContent: "center",
                margin: "0 auto 16px", fontSize: 24, color: "white",
              }}
            >
              ✓
            </div>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--success)", marginBottom: 8 }}>
              Loan Request Submitted!
            </h2>
            <p style={{ color: "var(--text-secondary)", fontSize: 14, marginBottom: 24 }}>
              A confirmation has been sent to your Telegram.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <Link href="/laptop-loans" className="btn btn-primary" style={{ textDecoration: "none" }}>
                View Calendar
              </Link>
              <button className="btn btn-outline" onClick={() => setSubmitted(false)}>
                New Request
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <CartPanel />
      <div className="page-container" style={{ maxWidth: 620 }}>
        <div className="page-header">
          <h1>Request a Laptop Loan</h1>
          <p>Fill in the details below to request a laptop loan.</p>
        </div>

        <form className="card card-body" onSubmit={handleSubmit}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label>Borrower</label>
              <input
                type="text"
                value={user?.display_name || user?.username || ""}
                disabled
                style={{ opacity: 0.6 }}
              />
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label>Ministry</label>
              <select value={form.ministry} onChange={(e) => setField("ministry", e.target.value)}>
                <option value="">Select a ministry</option>
                {MINISTRIES.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label>
                Start <span style={{ color: "var(--error)" }}>*</span>
              </label>
              <input
                type="datetime-local"
                value={form.startDatetime}
                min={toDatetimeLocal(_now)}
                onChange={(e) => setField("startDatetime", e.target.value)}
                required
                style={{ colorScheme: "dark" }}
              />
            </div>
            <div className="input-group" style={{ marginBottom: 0 }}>
              <label>
                End <span style={{ color: "var(--error)" }}>*</span>
              </label>
              <input
                type="datetime-local"
                value={form.endDatetime}
                min={minEnd}
                onChange={(e) => setField("endDatetime", e.target.value)}
                required
                style={{ colorScheme: "dark" }}
              />
            </div>
          </div>

          <div className="input-group">
            <label>
              Laptop <span style={{ color: "var(--error)" }}>*</span>
            </label>
            <select
              value={form.laptopId}
              onChange={(e) => setField("laptopId", e.target.value)}
              required
            >
              <option value="">Select a laptop</option>
              <optgroup label={TIER_LABELS.tier1}>
                {LOANABLE_LAPTOPS.filter((l) => l.tier === "tier1").map((l) => (
                  <option key={l.id} value={l.id} disabled={unavailableLaptops.has(l.id)}>
                    {l.id} · {l.specs}
                    {unavailableLaptops.has(l.id) ? " — Unavailable" : ""}
                  </option>
                ))}
              </optgroup>
              <optgroup label={TIER_LABELS.tier2}>
                {LOANABLE_LAPTOPS.filter((l) => l.tier === "tier2").map((l) => (
                  <option key={l.id} value={l.id} disabled={unavailableLaptops.has(l.id)}>
                    {l.id} · {l.specs}
                    {unavailableLaptops.has(l.id) ? " — Unavailable" : ""}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          <div className="input-group">
            <label>
              Reason for Loan <span style={{ color: "var(--error)" }}>*</span>
            </label>
            <textarea
              value={form.reason}
              onChange={(e) => setField("reason", e.target.value)}
              rows={3}
              placeholder="e.g. My laptop is being repaired and I have a meeting today."
              required
            />
          </div>

          {error && (
            <p style={{ color: "var(--error)", fontSize: 13, marginBottom: 16 }}>{error}</p>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={loading}
            style={{ width: "100%", justifyContent: "center" }}
          >
            {loading ? "Submitting…" : "Submit Loan Request"}
          </button>
        </form>
      </div>
    </>
  );
}
