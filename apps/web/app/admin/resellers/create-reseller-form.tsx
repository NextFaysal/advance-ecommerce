"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Create-reseller form (wave 7) — the write half of /admin/resellers.
// Posts to POST /api/v1/admin/resellers (the no-resellerId branch,
// resellers.manage + module.reseller gate server-side). The store
// generates the ?ref= attribution code at create; the row starts
// PENDING_APPROVAL, so the success panel shows the code immediately
// but states plainly that the link attributes orders only once the
// reseller is ACTIVE. Styled plainly to match this legacy page.
export function CreateResellerForm() {
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
            : `HTTP ${res.status} — রিসেলার তৈরি হয়নি।`,
        );
      }
    } catch {
      setError("নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন। (Network error — try again.)");
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
      <h2 style={{ marginTop: 0, fontSize: 17 }}>নতুন রিসেলার যোগ করুন / Add a reseller</h2>
      <p style={{ color: "#475569", fontSize: 13, marginTop: 4 }}>
        তৈরি হলেই রিসেলার একটি ?ref= অ্যাট্রিবিউশন কোড পায়, কিন্তু অবস্থা থাকে{" "}
        <strong>PENDING_APPROVAL</strong> — অনুমোদন (ACTIVE) না হওয়া পর্যন্ত তার লিংকের
        অর্ডার অ্যাট্রিবিউট হয় না। (The attribution code is generated at create; orders
        attribute only once the reseller is ACTIVE.)
      </p>
      <form onSubmit={onSubmit} style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ flex: "1 1 220px", fontSize: 13, fontWeight: 600 }}>
          নাম / Name
          <input
            style={inputStyle}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="রিসেলারের নাম"
            required
            minLength={2}
          />
        </label>
        <label style={{ flex: "1 1 220px", fontSize: 13, fontWeight: 600 }}>
          ফোন / Phone
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
          {busy ? "তৈরি হচ্ছে…" : "রিসেলার তৈরি করুন / Create"}
        </button>
      </form>
      {error && (
        <p role="alert" style={{ color: "#b91c1c", fontSize: 13, marginBottom: 0 }}>
          {error}
        </p>
      )}
      {created && (
        <p role="status" style={{ color: "#166534", fontSize: 13, marginBottom: 0 }}>
          তৈরি হয়েছে: <strong>{created.name}</strong> — অবস্থা PENDING_APPROVAL।
          {created.code ? (
            <>
              {" "}
              কোড <code>{created.code}</code>, শেয়ার লিংক{" "}
              <code>{`${appBaseUrl}/?ref=${created.code}`}</code> (ACTIVE হলেই লিংকটি কাজ করবে)।
            </>
          ) : null}
        </p>
      )}
    </section>
  );
}
