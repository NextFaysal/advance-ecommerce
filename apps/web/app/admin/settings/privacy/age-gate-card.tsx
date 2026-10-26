"use client";

// Age-restricted categories card — Settings > Privacy (ADV-29).
// Edits the ONE JSON document behind the
// `catalog.age_restricted_categories` Setting through the standard
// Settings API (POST /api/v1/admin/settings { key, value, reason }),
// so every change is audited (settings.update) with a mandatory
// reason like every other settings write. Products in a listed
// category require a customer age ATTESTATION at checkout — a
// recorded self-declaration, NOT identity/age verification; the
// card copy says so, so no operator mistakes this for a KYC gate.
import { useState } from "react";
import { Icon } from "@/components/ui/icon";

const AGE_RESTRICTIONS_KEY = "catalog.age_restricted_categories";

interface RestrictionRow {
  slug: string;
  minAge: number;
}

interface AgeGateCardProps {
  initialRestrictions: RestrictionRow[];
  categorySlugs: string[];
  dbReady: boolean;
}

export function AgeGateCard({ initialRestrictions, categorySlugs, dbReady }: AgeGateCardProps) {
  const [rows, setRows] = useState<RestrictionRow[]>(initialRestrictions);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [statusOk, setStatusOk] = useState(false);
  const [saving, setSaving] = useState(false);

  function updateRow(index: number, patch: Partial<RestrictionRow>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function handleSave() {
    setStatus("");
    if (reason.trim() === "") {
      setStatusOk(false);
      setStatus("পরিবর্তনের কারণ লিখুন — এটি অডিট লগে সংরক্ষিত থাকে।");
      return;
    }
    const cleaned: RestrictionRow[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const slug = row.slug.trim();
      if (slug === "") continue;
      if (seen.has(slug)) {
        setStatusOk(false);
        setStatus(`একই ক্যাটাগরি দুবার আছে: ${slug} — একটি রাখুন।`);
        return;
      }
      seen.add(slug);
      const minAge = Number.isFinite(row.minAge) ? Math.min(120, Math.max(1, Math.round(row.minAge))) : 18;
      cleaned.push({ slug, minAge });
    }
    const value = JSON.stringify({ restrictions: cleaned });
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: AGE_RESTRICTIONS_KEY, value, reason: reason.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setStatusOk(false);
        setStatus(`সেভ করা যায়নি: ${data.error?.message ?? `সেভ করা যায়নি (${res.status})`}`);
        return;
      }
      setRows(cleaned);
      setStatusOk(true);
      setStatus(
        cleaned.length === 0
          ? "সেভ হয়েছে — এখন কোনো ক্যাটাগরিই বয়স-সীমাবদ্ধ নয়।"
          : `সেভ হয়েছে — ${cleaned.length}টি ক্যাটাগরিতে বয়স নিশ্চিতকরণ লাগবে। PDP ও চেকআউটে সঙ্গে সঙ্গে কার্যকর।`,
      );
    } catch {
      setStatusOk(false);
      setStatus("সার্ভারের সঙ্গে যোগাযোগ করা যায়নি — সেভ হয়েছে কিনা নিশ্চিত নয়; পেজটি আবার লোড করে যাচাই করুন।");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "block min-h-[44px] w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100";

  return (
    <section className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-card">
      <div className="brand-gradient h-1.5 w-full" aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
            <Icon name="shield" size={20} />
          </span>
          <h2 className="font-display text-base font-semibold text-text-main">
            বয়স-সীমাবদ্ধ ক্যাটাগরি (Age Gate)
          </h2>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-text-muted">
          নিচের ক্যাটাগরিগুলোর পণ্য কিনতে ক্রেতাকে চেকআউটে বয়স নিশ্চিত করতে হবে (PDP-তেও
          নিশ্চিতকরণ দেখায়)। নিশ্চিতকরণটি অর্ডারের নোটে রেকর্ড থাকে।{" "}
          <strong className="text-text-main">এটি একটি স্ব-ঘোষণা — পরিচয় বা বয়স যাচাই নয়</strong>;
          কোনো ডকুমেন্ট সংগ্রহ করা হয় না। সেটিং কী{" "}
          <code className="font-mono text-xs">catalog.age_restricted_categories</code>।
          {!dbReady && (
            <span className="mt-1.5 block text-rose-600">
              সতর্কতা: ডাটাবেস থেকে বর্তমান মান পড়া যায়নি — উপরে ডিফল্ট (খালি) দেখানো হচ্ছে।
            </span>
          )}
        </p>

        <div className="mt-4 space-y-2">
          {rows.length === 0 ? (
            <p className="text-sm text-text-muted">কোনো ক্যাটাগরি যোগ করা হয়নি — বয়স গেট বন্ধ।</p>
          ) : (
            rows.map((row, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2">
                <label className="min-w-52 flex-1">
                  <span className="text-sm font-medium">ক্যাটাগরি স্লাগ</span>
                  <input
                    className={inputCls}
                    value={row.slug}
                    list="age-gate-category-slugs"
                    placeholder="যেমন: vape-and-accessories"
                    onChange={(e) => updateRow(i, { slug: e.target.value })}
                    disabled={saving}
                  />
                </label>
                <label className="w-32">
                  <span className="text-sm font-medium">সর্বনিম্ন বয়স</span>
                  <input
                    className={inputCls}
                    type="number"
                    min={1}
                    max={120}
                    value={row.minAge}
                    onChange={(e) => updateRow(i, { minAge: Number(e.target.value) })}
                    disabled={saving}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                  disabled={saving}
                  className="min-h-[44px] rounded-lg border border-border px-3 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                >
                  সরান
                </button>
              </div>
            ))
          )}
          <datalist id="age-gate-category-slugs">
            {categorySlugs.map((slug) => (
              <option key={slug} value={slug} />
            ))}
          </datalist>
          <button
            type="button"
            onClick={() => setRows((prev) => [...prev, { slug: "", minAge: 18 }])}
            disabled={saving}
            className="min-h-[44px] rounded-lg border border-border px-3 text-sm font-medium transition hover:bg-surface-2 disabled:opacity-50"
          >
            + ক্যাটাগরি যোগ করুন
          </button>
        </div>

        <label className="mt-4 block">
          <span className="text-sm font-medium">পরিবর্তনের কারণ (অডিট লগে থাকবে)</span>
          <input
            className={inputCls}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="যেমন: আইনি বাধ্যবাধকতায় ভেপ ক্যাটাগরিতে ১৮+ গেট"
            disabled={saving}
          />
        </label>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="brand-gradient min-h-[44px] rounded-lg px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "সেভ হচ্ছে…" : "সেভ করুন"}
          </button>
          {status !== "" && (
            <p className={`text-sm ${statusOk ? "text-emerald-600" : "text-rose-600"}`} role="status">
              {status}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
