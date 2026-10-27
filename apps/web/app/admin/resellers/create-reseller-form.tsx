"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { RESELLERS_STRINGS } from "./strings";

// Create-reseller form (wave 7) — the write half of /admin/resellers.
// Posts to POST /api/v1/admin/resellers (the no-resellerId branch,
// resellers.manage + module.reseller gate server-side). The store
// generates the ?ref= attribution code at create; the row starts
// PENDING_APPROVAL, so the success panel shows the code immediately
// but states plainly that the link attributes orders only once the
// reseller is ACTIVE. Styled plainly to match this legacy page.
export function CreateResellerForm() {
  const { locale } = useLocale();
  const s = pick(locale, RESELLERS_STRINGS);
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<{ name: string; code: string | null } | null>(null);

  // Same share-link base rule as the server table on this page.
  const appBaseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setCreated(null);
    try {
      const res = await fetch("/api/v1/admin/resellers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
      });
      const body = (await res.json().catch(() => null)) as
        | {
            data?: { reseller?: { name: string; code: string | null } };
            error?: { code: string; message: string };
          }
        | null;
      if (res.ok && body?.data?.reseller) {
        setCreated({ name: body.data.reseller.name, code: body.data.reseller.code });
        setName("");
        setPhone("");
        router.refresh();
      } else {
        setError(
          body?.error
            ? `${body.error.code}: ${body.error.message}`
            : interpolate(s.createFailed, { status: res.status }),
        );
      }
    } catch {
      setError(s.networkError);
    } finally {
      setBusy(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    display: "block",
    width: "100%",
    marginTop: 4,
    padding: "8px 10px",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    fontSize: 14,
  };

  return (
    <section style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: 16, margin: "16px 0" }}>
      <h2 style={{ marginTop: 0, fontSize: 17 }}>{s.createTitle}</h2>
      <p style={{ color: "#475569", fontSize: 13, marginTop: 4 }}>{s.createDesc}</p>
      <form onSubmit={onSubmit} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ flex: "1 1 220px", fontSize: 13, fontWeight: 600 }}>
          {s.nameLabel}
          <input
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={s.namePlaceholder}
            required
            minLength={2}
          />
        </label>
        <label style={{ flex: "1 1 220px", fontSize: 13, fontWeight: 600 }}>
          {s.phoneLabel}
          <input
            style={inputStyle}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="01XXXXXXXXX"
            required
            inputMode="tel"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          style={{
            padding: "9px 18px",
            borderRadius: 6,
            border: "none",
            background: "#4f46e5",
            color: "#fff",
            fontSize: 14,
            fontWeight: 600,
            cursor: busy ? "wait" : "pointer",
          }}
        >
          {busy ? s.creating : s.createBtn}
        </button>
      </form>
      {error && (
        <p role="alert" style={{ color: "#b91c1c", fontSize: 13, marginBottom: 0 }}>
          {error}
        </p>
      )}
      {created && (
        <p role="status" style={{ color: "#166534", fontSize: 13, marginBottom: 0 }}>
          {interpolate(s.createdMsg, { name: created.name })}
          {created.code ? <> {interpolate(s.createdCode, { code: created.code, link: `${appBaseUrl}/?ref=${created.code}` })}</> : null}
        </p>
      )}
    </section>
  );
}
