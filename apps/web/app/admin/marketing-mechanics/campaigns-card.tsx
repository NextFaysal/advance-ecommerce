"use client";

// Seasonal campaigns + exit-intent admin card (ADV-17/18 remainders)
// — mounted on /admin/marketing-mechanics below the mechanics
// manager. Talks to GET/PUT /api/v1/admin/marketing/campaigns:
// pick a preset, fill its slots (collection source, headline
// override, coupon — the API rejects a code that does not exist),
// save with a reason (audited). The storefront page is
// /campaign/<slug> and renders only while a campaign is enabled
// here; products always come from the real catalogue source.
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (json as { error?: { message?: string; details?: unknown } } | null)?.error;
    const details = Array.isArray(err?.details) ? ` (${(err.details as string[]).join(", ")})` : "";
    throw new Error(`${err?.message ?? `HTTP ${res.status}`}${details}`);
  }
  return (json as { data: T }).data;
}

const inputCls = "min-h-[44px] w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-text-main";
const labelCls = "block text-xs font-semibold text-text-muted";

type SourceState =
  | { kind: "category"; slug: string }
  | { kind: "tag"; tag: string }
  | { kind: "flash_sale" };

interface CampaignRow {
  enabled: boolean;
  headlineBn: string;
  headlineEn: string;
  subBn: string;
  source: SourceState;
  couponCode: string;
  endsAt: string; // datetime-local value or ""
}

interface PresetMeta {
  slug: string;
  nameBn: string;
  nameEn: string;
  headlineBn: string;
  defaultTag: string;
}

interface CampaignsData {
  presets: PresetMeta[];
  campaigns: Record<
    string,
    {
      enabled: boolean;
      headlineBn: string | null;
      headlineEn: string | null;
      subBn: string | null;
      source: SourceState;
      couponCode: string | null;
      endsAt: string | null;
    }
  >;
  exitIntent: { enabled: boolean; headlineBn: string; bodyBn: string; couponCode: string | null };
  categories: Array<{ slug: string; label: string }>;
  couponStates: Record<string, { ok: boolean; reason?: string }>;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CampaignsCard() {
  const [data, setData] = useState<CampaignsData | null>(null);
  const [rows, setRows] = useState<Record<string, CampaignRow>>({});
  const [exit, setExit] = useState({ enabled: false, headlineBn: "", bodyBn: "", couponCode: "" });
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<CampaignsData>("/api/v1/admin/marketing/campaigns");
      setData(d);
      const next: Record<string, CampaignRow> = {};
      for (const preset of d.presets) {
        const saved = d.campaigns[preset.slug];
        next[preset.slug] = saved
          ? {
              enabled: saved.enabled,
              headlineBn: saved.headlineBn ?? "",
              headlineEn: saved.headlineEn ?? "",
              subBn: saved.subBn ?? "",
              source: saved.source,
              couponCode: saved.couponCode ?? "",
              endsAt: toLocalInput(saved.endsAt),
            }
          : {
              enabled: false,
              headlineBn: "",
              headlineEn: "",
              subBn: "",
              source: { kind: "tag", tag: preset.defaultTag },
              couponCode: "",
              endsAt: "",
            };
      }
      setRows(next);
      setExit({
        enabled: d.exitIntent.enabled,
        headlineBn: d.exitIntent.headlineBn,
        bodyBn: d.exitIntent.bodyBn,
        couponCode: d.exitIntent.couponCode ?? "",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "লোড করা যায়নি");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setRow = (slug: string, patch: Partial<CampaignRow>) =>
    setRows((prev) => ({ ...prev, [slug]: { ...prev[slug], ...patch } }));

  const save = async () => {
    setError(null);
    setNotice(null);
    if (!reason.trim()) {
      setError("সেভ করতে কারণ (reason) আবশ্যক।");
      return;
    }
    setSaving(true);
    try {
      const campaigns: Record<string, unknown> = {};
      for (const [slug, row] of Object.entries(rows)) {
        campaigns[slug] = {
          enabled: row.enabled,
          headlineBn: row.headlineBn.trim() || null,
          headlineEn: row.headlineEn.trim() || null,
          subBn: row.subBn.trim() || null,
          subEn: null,
          source: row.source,
          couponCode: row.couponCode.trim() || null,
          endsAt: row.endsAt ? new Date(row.endsAt).toISOString() : null,
        };
      }
      await api("/api/v1/admin/marketing/campaigns", {
        method: "PUT",
        body: JSON.stringify({
          campaigns,
          exitIntent: {
            enabled: exit.enabled,
            headlineBn: exit.headlineBn,
            bodyBn: exit.bodyBn,
            couponCode: exit.couponCode.trim() || null,
          },
          reason: reason.trim(),
        }),
      });
      setNotice("সেভ হয়েছে। স্টোরফ্রন্টে /campaign/<slug> পেজে দেখা যাবে (সক্রিয় থাকলে)।");
      setReason("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "সেভ করা যায়নি");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="mt-8">
      <h2 className="text-lg font-bold text-text-main">সিজনাল ক্যাম্পেইন ও এক্সিট-ইনটেন্ট পপআপ</h2>
      <p className="mt-1 text-sm text-text-muted">
        টেমপ্লেট বেছে স্লট পূরণ করুন — পণ্য আসবে আসল ক্যাটালগ থেকে (ক্যাটাগরি / ট্যাগ / চলমান ফ্ল্যাশ সেল),
        কুপন কোড থাকতে হবে আসল Coupon তালিকায়। কাউন্টডাউন শুধু শেষ তারিখ দিলেই দেখাবে।
      </p>

      {error ? (
        <p className="mt-4 rounded-xl bg-danger-soft px-3 py-2 text-sm font-medium text-danger">{error}</p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-xl bg-success-soft px-3 py-2 text-sm font-medium text-success-solid">{notice}</p>
      ) : null}
      {data === null && !error ? <p className="mt-4 text-sm text-text-subtle">লোড হচ্ছে…</p> : null}

      {data !== null ? (
        <>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {data.presets.map((preset) => {
              const row = rows[preset.slug];
              if (!row) return null;
              const couponProblem =
                row.couponCode && data.couponStates[row.couponCode] && !data.couponStates[row.couponCode].ok
                  ? data.couponStates[row.couponCode].reason
                  : null;
              return (
                <div key={preset.slug} className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-bold text-text-main">
                      {preset.nameBn} <span className="text-xs font-medium text-text-subtle">/campaign/{preset.slug}</span>
                    </h3>
                    <label className="flex items-center gap-2 text-sm font-semibold text-text-muted">
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        onChange={(e) => setRow(preset.slug, { enabled: e.target.checked })}
                      />
                      সক্রিয়
                    </label>
                  </div>
                  <div className="mt-3 grid gap-3">
                    <div>
                      <label className={labelCls}>হেডলাইন (বাংলা, খালি = ডিফল্ট: “{preset.headlineBn}”)</label>
                      <input
                        className={inputCls}
                        value={row.headlineBn}
                        onChange={(e) => setRow(preset.slug, { headlineBn: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>হেডলাইন (English, ঐচ্ছিক)</label>
                      <input
                        className={inputCls}
                        value={row.headlineEn}
                        onChange={(e) => setRow(preset.slug, { headlineEn: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className={labelCls}>সাব-টেক্সট (বাংলা, ঐচ্ছিক)</label>
                      <input
                        className={inputCls}
                        value={row.subBn}
                        onChange={(e) => setRow(preset.slug, { subBn: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>পণ্যের উৎস</label>
                        <select
                          className={inputCls}
                          value={row.source.kind}
                          onChange={(e) => {
                            const kind = e.target.value;
                            if (kind === "category")
                              setRow(preset.slug, { source: { kind: "category", slug: data.categories[0]?.slug ?? "" } });
                            else if (kind === "tag")
                              setRow(preset.slug, { source: { kind: "tag", tag: preset.defaultTag } });
                            else setRow(preset.slug, { source: { kind: "flash_sale" } });
                          }}
                        >
                          <option value="category">ক্যাটাগরি</option>
                          <option value="tag">পণ্যের ট্যাগ</option>
                          <option value="flash_sale">চলমান ফ্ল্যাশ সেল</option>
                        </select>
                      </div>
                      <div>
                        <label className={labelCls}>উৎসের মান</label>
                        {row.source.kind === "category" ? (
                          <select
                            className={inputCls}
                            value={row.source.slug}
                            onChange={(e) =>
                              setRow(preset.slug, { source: { kind: "category", slug: e.target.value } })
                            }
                          >
                            {data.categories.map((c) => (
                              <option key={c.slug} value={c.slug}>
                                {c.label}
                              </option>
                            ))}
                          </select>
                        ) : row.source.kind === "tag" ? (
                          <input
                            className={inputCls}
                            value={row.source.tag}
                            onChange={(e) => setRow(preset.slug, { source: { kind: "tag", tag: e.target.value } })}
                            placeholder="যেমন: eid"
                          />
                        ) : (
                          <p className="px-1 py-2 text-xs text-text-muted">যে ফ্ল্যাশ সেলটি তখন লাইভ থাকবে</p>
                        )}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelCls}>কুপন কোড (ঐচ্ছিক, থাকতে হবে)</label>
                        <input
                          className={inputCls}
                          value={row.couponCode}
                          onChange={(e) => setRow(preset.slug, { couponCode: e.target.value })}
                          placeholder="যেমন: EID10"
                        />
                        {couponProblem ? (
                          <p className="mt-1 text-xs font-medium text-danger">
                            সতর্কতা: এই কোডটি এখন {couponProblem} — পেজে দেখানো হবে না।
                          </p>
                        ) : null}
                      </div>
                      <div>
                        <label className={labelCls}>শেষ তারিখ (ঐচ্ছিক — কাউন্টডাউনের জন্য)</label>
                        <input
                          type="datetime-local"
                          className={inputCls}
                          value={row.endsAt}
                          onChange={(e) => setRow(preset.slug, { endsAt: e.target.value })}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-bold text-text-main">এক্সিট-ইনটেন্ট পপআপ</h3>
              <label className="flex items-center gap-2 text-sm font-semibold text-text-muted">
                <input
                  type="checkbox"
                  checked={exit.enabled}
                  onChange={(e) => setExit({ ...exit, enabled: e.target.checked })}
                />
                সক্রিয়
              </label>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              ডেস্কটপে পেজ ছাড়ার ইঙ্গিতে, মোবাইলে ৬০ সেকেন্ড পর — সেশনে সর্বোচ্চ একবার, বন্ধ করলে ৭ দিন আর
              দেখাবে না। চেকআউট/অ্যাকাউন্ট পেজে কখনো নয়।
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>হেডলাইন (বাংলা)</label>
                <input
                  className={inputCls}
                  value={exit.headlineBn}
                  onChange={(e) => setExit({ ...exit, headlineBn: e.target.value })}
                />
              </div>
              <div>
                <label className={labelCls}>কুপন কোড (ঐচ্ছিক, থাকতে হবে)</label>
                <input
                  className={inputCls}
                  value={exit.couponCode}
                  onChange={(e) => setExit({ ...exit, couponCode: e.target.value })}
                  placeholder="যেমন: WELCOME10"
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>বডি টেক্সট (বাংলা)</label>
                <textarea
                  className={inputCls}
                  rows={2}
                  value={exit.bodyBn}
                  onChange={(e) => setExit({ ...exit, bodyBn: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <label className={labelCls}>পরিবর্তনের কারণ (আবশ্যক, অডিটে থাকবে)</label>
              <input
                className={inputCls}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="যেমন: ঈদ ক্যাম্পেইন চালু"
              />
            </div>
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-brand-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-50"
            >
              {saving ? "সেভ হচ্ছে…" : "সব সেভ করুন"}
            </button>
          </div>
        </>
      ) : null}
    </Card>
  );
}
