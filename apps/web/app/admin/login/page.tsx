"use client";

/**
 * Staff admin login UI — /admin/login.
 *
 * Flow:
 *  1. POST { identifier, password } to /api/v1/admin/auth/login
 *     (Route Handler to be added with Step 4 completion; it calls
 *     authenticateStaff() from src/lib/auth.ts, enforces the login
 *     rate limit, and sets a httpOnly pending-2FA cookie on needs_2fa.)
 *  2. If needs_2fa: show the 6-digit TOTP step and POST
 *     { code } to /api/v1/admin/auth/verify-2fa, which calls verifyTotp()
 *     and sets the httpOnly admin session cookie on success.
 *  3. On success: redirect to /admin.
 *
 * Security notes shown to staff, and enforced server-side:
 *  - 5 failed logins in 15 minutes locks the account for 30 minutes.
 *  - Error messages are generic on purpose (never "user not found").
 *  - No token, password, or OTP is stored in localStorage/sessionStorage.
 *  - This page uses plain, accessible form controls on purpose — the
 *    Design System (Step 5, another agent's slice) will replace them
 *    with shared components; do not duplicate a design system here.
 */
import { useState } from "react";
import type { FormEvent } from "react";

type Step = "login" | "totp" | "error";

export default function AdminLoginPage() {
  const [step, setStep] = useState<Step>("login");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/v1/admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        data?: { status?: string };
        error?: { message?: string };
      };
      if (!res.ok) {
        setMessage(data.error?.message ?? "Login failed. Please try again.");
        setStep("error");
        return;
      }
      if (data.data?.status === "needs_2fa") {
        setStep("totp");
      } else {
        window.location.href = "/admin";
      }
    } catch {
      setMessage("Network error. Check your connection and try again.");
      setStep("error");
    } finally {
      setLoading(false);
    }
  }

  async function handleTotp(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage("");
    try {
      const res = await fetch("/api/v1/admin/auth/verify-2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!res.ok) {
        setMessage("Invalid code. Please try again.");
        return;
      }
      window.location.href = "/admin";
    } catch {
      setMessage("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "64px auto", padding: 24, fontFamily: "system-ui" }}>
      <h1>Admin Login</h1>
      <p>Staff only. Email ba phone number + password diye login korun.</p>

      {step === "login" && (
        <form onSubmit={handleLogin}>
          <label htmlFor="identifier">Email / Phone</label>
          <input
            id="identifier"
            type="text"
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            required
            style={{ display: "block", width: "100%", padding: 10, margin: "8px 0 16px" }}
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            style={{ display: "block", width: "100%", padding: 10, margin: "8px 0 16px" }}
          />
          <label>
            <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />{" "}
            Show password
          </label>
          <button
            type="submit"
            disabled={loading}
            style={{ display: "block", width: "100%", padding: 12, marginTop: 16, background: "#4F46E5", color: "#fff", border: 0, borderRadius: 8 }}
          >
            {loading ? "Logging in…" : "Login"}
          </button>
        </form>
      )}

      {step === "totp" && (
        <form onSubmit={handleTotp}>
          <label htmlFor="code">2FA Code (6 digit, authenticator app)</label>
          <input
            id="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            required
            pattern="\d{6}"
            style={{ display: "block", width: "100%", padding: 10, margin: "8px 0 16px", letterSpacing: 4 }}
          />
          <button
            type="submit"
            disabled={loading || code.length !== 6}
            style={{ display: "block", width: "100%", padding: 12, marginTop: 16, background: "#4F46E5", color: "#fff", border: 0, borderRadius: 8 }}
          >
            {loading ? "Verifying…" : "Verify"}
          </button>
        </form>
      )}

      {message !== "" && (
        <p role="alert" style={{ color: "#E11D48", marginTop: 16 }}>
          {message}
        </p>
      )}
      {step === "error" && (
        <button type="button" onClick={() => setStep("login")} style={{ marginTop: 12 }}>
          Back to login
        </button>
      )}
      <p style={{ fontSize: 13, color: "#555", marginTop: 24 }}>
        Rate limit: 5 bar bhul login korle account 30 minute lock hobe. Suspicious login hole admin ke janano hobe.
      </p>
    </main>
  );
}
