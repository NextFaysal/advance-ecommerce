"use client";

// Marketing mechanics manager (ADV-18B) — three sections over the
// admin marketing APIs. Everything shown is live server state:
// spin odds come from the server's drawable-draw computation, A/B
// numbers are raw TrackingEvent counts (labelled descriptive), and
// a broadcast is only "sent" when the Meta adapter really sent it.
import { useCallback, useEffect, useState } from "react";

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = (json as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  return (json as { data: T }).data;
}

const inputCls = "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900";
const labelCls = "block text-xs font-semibold text-slate-500";

/* ------------------------------------------------------------------ */
/* Spin                                                                */
/* ------------------------------------------------------------------ */

interface SpinSegmentRow {
  id: string;
  labelBn: string;
  couponCode: string;
  weightBps: number;
}

interface SpinData {
  config: {
    enabled: boolean;
    dailyLimit: number;
    claimExpiryDays: number;
    segments: Array<{ id: string; labelBn: string; couponCode: string | null; weightBps: number }>;
  };
  display: {
    segments: Array<{ id: string; labelBn: string; couponCode: string | null; oddsPercent: number }>;
    excludedPrizeSegments: Array<{ id: string; couponCode: string; reason: string }>;
  };
  recentSpins: Array<Record<string, unknown>>;
}

function SpinSection() {
  const [data, setData] = useState<SpinData | null>(null);
  const [segments, setSegments] = useState<SpinSegmentRow[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [dailyLimit, setDailyLimit] = useState(1);
  const [claimExpiryDays, setClaimExpiryDays] = useState(7);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api<SpinData>("/api/v1/admin/marketing/spin-config");
      setData(d);
      setEnabled(d.config.enabled);
      setDailyLimit(d.config.dailyLimit);
      setClaimExpiryDays(d.config.claimExpiryDays);
      setSegments(
        d.config.segments.map((s) => ({
          id: s.id,
          labelBn: s.labelBn,
          couponCode: s.couponCode ?? "",
          weightBps: s.weightBps,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setMessage(null);
    setError(null);
    try {
      await api("/api/v1/admin/marketing/spin-config", {
        method: "PUT",
        body: JSON.stringify({
          version: 1,
          enabled,
          dailyLimit,
          claimExpiryDays,
          segments: segments.map((s) => ({
            id: s.id,
            labelBn: s.labelBn,
            couponCode: s.couponCode.trim() === "" ? null : s.couponCode.trim(),
            weightBps: s.weightBps,
          })),
        }),
      });
      setMessage("সংরক্ষিত হয়েছে।");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    }
  };

  const oddsFor = (id: string) => data?.display.segments.find((s) => s.id === id)?.oddsPercent;

  return (
    <section className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <h2 className="text-lg font-bold text-slate-900">স্পিন হুইল</h2>
      <p className="mt-1 text-sm text-slate-500">
        ওজন অনুযায়ী সার্ভার ফলাফল ঠিক করে। অন্তত একটি &ldquo;পুরস্কার নেই&rdquo; সেগমেন্ট (কুপন খালি) থাকতেই হবে —
        ছাড়া সেভ হবে না। যেসব পুরস্কার-সেগমেন্টের কুপন এখন সক্রিয় নয়, সেগুলো ড্র থেকে বাদ যায় (নিচে দেখুন)।
      </p>
      {error !== null ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {message !== null ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className={labelCls}>
          চালু আছে
          <select className={inputCls} value={enabled ? "on" : "off"} onChange={(e) => setEnabled(e.target.value === "on")}>
            <option value="on">হ্যাঁ</option>
            <option value="off">না</option>
          </select>
        </label>
        <label className={labelCls}>
          দৈনিক স্পিন সীমা (জনপ্রতি)
          <input type="number" min={1} max={10} className={inputCls} value={dailyLimit} onChange={(e) => setDailyLimit(Number(e.target.value))} />
        </label>
        <label className={labelCls}>
          জেতা কুপনের মেয়াদ (দিন)
          <input type="number" min={1} max={30} className={inputCls} value={claimExpiryDays} onChange={(e) => setClaimExpiryDays(Number(e.target.value))} />
        </label>
      </div>
      <div className="mt-4 space-y-2">
        {segments.map((segment, i) => (
          <div key={segment.id} className="grid items-end gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_110px_110px_36px]">
            <label className={labelCls}>
              লেবেল
              <input className={inputCls} value={segment.labelBn} onChange={(e) => setSegments((rows) => rows.map((r, j) => (j === i ? { ...r, labelBn: e.target.value } : r)))} />
            </label>
            <label className={labelCls}>
              কুপন কোড (খালি = পুরস্কার নেই)
              <input className={inputCls} value={segment.couponCode} placeholder="WELCOME10" onChange={(e) => setSegments((rows) => rows.map((r, j) => (j === i ? { ...r, couponCode: e.target.value } : r)))} />
            </label>
            <label className={labelCls}>
              ওজন (bps)
              <input type="number" min={1} max={10000} className={inputCls} value={segment.weightBps} onChange={(e) => setSegments((rows) => rows.map((r, j) => (j === i ? { ...r, weightBps: Number(e.target.value) } : r)))} />
            </label>
            <p className="pb-2 text-xs text-slate-500">
              আসল সম্ভাবনা: {oddsFor(segment.id) !== undefined ? `${oddsFor(segment.id)}%` : "ড্রতে নেই"}
            </p>
            <button type="button" aria-label="সেগমেন্ট মুছুন" className="mb-1 h-9 w-9 rounded-lg bg-white text-slate-500 ring-1 ring-slate-200 hover:text-red-600" onClick={() => setSegments((rows) => rows.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-200"
          onClick={() => setSegments((rows) => [...rows, { id: `seg-${rows.length + 1}-${Date.now().toString(36)}`, labelBn: "", couponCode: "", weightBps: 1000 }])}
        >
          + সেগমেন্ট যোগ করুন
        </button>
      </div>
      {data !== null && data.display.excludedPrizeSegments.length > 0 ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          ড্র থেকে বাদ: {data.display.excludedPrizeSegments.map((x) => `${x.couponCode} (${x.reason})`).join(", ")}
        </p>
      ) : null}
      <button type="button" onClick={() => void save()} className="mt-4 rounded-full bg-violet-600 px-5 py-2 text-sm font-bold text-white hover:bg-violet-700">
        সংরক্ষণ করুন
      </button>
      {data !== null && data.recentSpins.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-bold text-slate-700">সাম্প্রতিক স্পিন (Redis অডিট লগ — সাময়িক)</h3>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs text-slate-500">
            {data.recentSpins.map((entry, i) => (
              <li key={i} className="rounded bg-slate-50 px-2 py-1 font-mono">
                {JSON.stringify(entry)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Experiments                                                         */
/* ------------------------------------------------------------------ */

interface ExperimentRow {
  id: string;
  name: string;
  status: "draft" | "running" | "stopped";
  target: "hero";
  createdAt: string;
  variants: Array<{
    key: string;
    weightBps: number;
    hero?: { headlineBn: string; subBn: string; ctaLabelBn: string; ctaHref: string };
  }>;
}

interface ExpStats {
  variants: Array<{ variantKey: string; exposures: number; conversions: number; conversionPercent: number | null }>;
}

function ExperimentsSection() {
  const [experiments, setExperiments] = useState<ExperimentRow[]>([]);
  const [stats, setStats] = useState<Record<string, ExpStats>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [variantB, setVariantB] = useState({ headlineBn: "", subBn: "", ctaLabelBn: "", ctaHref: "/shop" });
  const [weightA, setWeightA] = useState(5000);
  const [weightB, setWeightB] = useState(5000);

  const load = useCallback(async () => {
    try {
      const d = await api<{ doc: { experiments: ExperimentRow[] } }>("/api/v1/admin/marketing/experiments");
      setExperiments(d.doc.experiments);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const putDoc = async (next: ExperimentRow[]) => {
    await api("/api/v1/admin/marketing/experiments", {
      method: "PUT",
      body: JSON.stringify({ version: 1, experiments: next }),
    });
    setExperiments(next);
  };

  const create = async () => {
    setError(null);
    setMessage(null);
    if (name.trim() === "" || variantB.headlineBn.trim() === "" || variantB.ctaLabelBn.trim() === "") {
      setError("নাম, B ভ্যারিয়েন্টের হেডলাইন ও CTA লেবেল আবশ্যক।");
      return;
    }
    const id = `exp-${Date.now().toString(36)}`;
    const experiment: ExperimentRow = {
      id,
      name: name.trim(),
      status: "draft",
      target: "hero",
      createdAt: new Date().toISOString(),
      variants: [
        { key: "A", weightBps: weightA },
        { key: "B", weightBps: weightB, hero: { ...variantB } },
      ],
    };
    try {
      await putDoc([...experiments, experiment]);
      setMessage("এক্সপেরিমেন্ট তৈরি হয়েছে (ড্রাফট)। চালু করতে “শুরু করুন” চাপুন।");
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed");
    }
  };

  const setStatus = async (id: string, status: ExperimentRow["status"]) => {
    setError(null);
    try {
      await putDoc(experiments.map((e) => (e.id === id ? { ...e, status } : e)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "update failed");
    }
  };

  const loadStats = async (id: string) => {
    try {
      const d = await api<{ stats: ExpStats | null }>(`/api/v1/admin/marketing/experiments?stats=${encodeURIComponent(id)}`);
      if (d.stats !== null) setStats((prev) => ({ ...prev, [id]: d.stats as ExpStats }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "stats failed");
    }
  };

  return (
    <section className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <h2 className="text-lg font-bold text-slate-900">A/B এক্সপেরিমেন্ট — হোমপেজ হিরো</h2>
      <p className="mt-1 text-sm text-slate-500">
        A = কন্ট্রোল (বর্তমান হিরো), B = নতুন হেডলাইন/CTA। ভিজিটর আইডির হ্যাশ দিয়ে নির্ধারিতভাবে ভ্যারিয়েন্ট দেওয়া হয় —
        একই ভিজিটর সবসময় একই ভ্যারিয়েন্ট দেখে। সংখ্যাগুলো কাঁচা কাউন্ট মাত্র; কোনো সিগনিফিক্যান্স দাবি করা হয় না।
      </p>
      {error !== null ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {message !== null ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p> : null}

      <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2">
        <label className={labelCls}>
          এক্সপেরিমেন্টের নাম
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="হিরো হেডলাইন টেস্ট" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={labelCls}>
            A ওজন (bps)
            <input type="number" className={inputCls} value={weightA} onChange={(e) => setWeightA(Number(e.target.value))} />
          </label>
          <label className={labelCls}>
            B ওজন (bps)
            <input type="number" className={inputCls} value={weightB} onChange={(e) => setWeightB(Number(e.target.value))} />
          </label>
        </div>
        <label className={labelCls}>
          B হেডলাইন
          <input className={inputCls} value={variantB.headlineBn} onChange={(e) => setVariantB((v) => ({ ...v, headlineBn: e.target.value }))} />
        </label>
        <label className={labelCls}>
          B সাব-টেক্সট
          <input className={inputCls} value={variantB.subBn} onChange={(e) => setVariantB((v) => ({ ...v, subBn: e.target.value }))} />
        </label>
        <label className={labelCls}>
          B CTA লেবেল
          <input className={inputCls} value={variantB.ctaLabelBn} onChange={(e) => setVariantB((v) => ({ ...v, ctaLabelBn: e.target.value }))} />
        </label>
        <label className={labelCls}>
          B CTA লিংক
          <input className={inputCls} value={variantB.ctaHref} onChange={(e) => setVariantB((v) => ({ ...v, ctaHref: e.target.value }))} />
        </label>
        <div>
          <button type="button" onClick={() => void create()} className="rounded-full bg-violet-600 px-5 py-2 text-sm font-bold text-white hover:bg-violet-700">
            ড্রাফট তৈরি করুন
          </button>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {experiments.map((experiment) => (
          <div key={experiment.id} className="rounded-xl ring-1 ring-slate-200 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-bold text-slate-900">{experiment.name}</p>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{experiment.status}</span>
              <span className="text-xs text-slate-400">{experiment.id}</span>
              <span className="ml-auto flex gap-2">
                {experiment.status !== "running" ? (
                  <button type="button" className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white" onClick={() => void setStatus(experiment.id, "running")}>
                    শুরু করুন
                  </button>
                ) : (
                  <button type="button" className="rounded-lg bg-red-600 px-3 py-1 text-xs font-bold text-white" onClick={() => void setStatus(experiment.id, "stopped")}>
                    বন্ধ করুন
                  </button>
                )}
                <button type="button" className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-bold text-slate-700" onClick={() => void loadStats(experiment.id)}>
                  ফলাফল দেখুন
                </button>
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              {experiment.variants.map((v) => `${v.key}: ওজন ${v.weightBps}${v.hero ? ` — “${v.hero.headlineBn}”` : " (কন্ট্রোল)"}`).join(" · ")}
            </p>
            {stats[experiment.id] !== undefined ? (
              <table className="mt-3 w-full text-left text-sm">
                <thead>
                  <tr className="text-xs text-slate-400">
                    <th className="py-1">ভ্যারিয়েন্ট</th>
                    <th>ইউনিক এক্সপোজার</th>
                    <th>অর্ডার (কনভার্সন)</th>
                    <th>কনভার্সন % (বর্ণনামূলক)</th>
                  </tr>
                </thead>
                <tbody>
                  {stats[experiment.id]?.variants.map((v) => (
                    <tr key={v.variantKey} className="border-t border-slate-100">
                      <td className="py-1 font-mono">{v.variantKey}</td>
                      <td>{v.exposures}</td>
                      <td>{v.conversions}</td>
                      <td>{v.conversionPercent !== null ? `${v.conversionPercent}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        ))}
        {experiments.length === 0 ? <p className="text-sm text-slate-400">কোনো এক্সপেরিমেন্ট নেই।</p> : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Broadcast                                                           */
/* ------------------------------------------------------------------ */

interface CampaignRow {
  id: string;
  title: string;
  message: string;
  status: string;
  notSentReason?: string;
  note?: string;
  audienceCount: number;
  attemptedCount: number;
  results: Array<{ phoneMasked: string; status: string; platformMessageId?: string; error?: string }>;
  createdAt: string;
  sentAt?: string;
}

interface BroadcastData {
  campaigns: CampaignRow[];
  audienceCount: number;
  channel: { configured: boolean; missingSettings: string[] };
}

function BroadcastSection() {
  const [data, setData] = useState<BroadcastData | null>(null);
  const [title, setTitle] = useState("");
  const [messageText, setMessageText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<BroadcastData>("/api/v1/admin/marketing/broadcasts"));
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setError(null);
    setNotice(null);
    try {
      await api("/api/v1/admin/marketing/broadcasts", { method: "POST", body: JSON.stringify({ title, message: messageText }) });
      setTitle("");
      setMessageText("");
      setNotice("ক্যাম্পেইন ড্রাফট হিসেবে সংরক্ষিত হয়েছে।");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "create failed");
    }
  };

  const send = async (id: string) => {
    setError(null);
    setNotice(null);
    setSendingId(id);
    try {
      const d = await api<{ campaign: CampaignRow }>(`/api/v1/admin/marketing/broadcasts/${id}/send`, { method: "POST" });
      setNotice(
        d.campaign.status === "NOT_SENT"
          ? `পাঠানো হয়নি: ${d.campaign.notSentReason ?? ""}`
          : `ক্যাম্পেইনের অবস্থা: ${d.campaign.status} (চেষ্টা ${d.campaign.attemptedCount} জন)`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "send failed");
    } finally {
      setSendingId(null);
    }
  };

  return (
    <section className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <h2 className="text-lg font-bold text-slate-900">WhatsApp ব্রডকাস্ট</h2>
      <p className="mt-1 text-sm text-slate-500">
        অডিয়েন্স: নিউজলেটারে সাবস্ক্রাইব করা ইমেইলের সঙ্গে মিলে যাওয়া, ফোন-সহ অ্যাক্টিভ কাস্টমাররাই শুধু — আলাদা
        WhatsApp সম্মতির কোনো ফিল্ড সিস্টেমে নেই, তাই এর বাইরে কাউকে পাঠানো হয় না। বর্তমান অডিয়েন্স:{" "}
        <strong className="text-slate-700">{data?.audienceCount ?? "…"}</strong> জন। একবারে সর্বোচ্চ ৫০ জনকে পাঠানো হয়
        (ব্যাচ সীমা)। Meta-র নিয়মে ২৪ ঘণ্টার উইন্ডোর বাইরে ফ্রি-ফর্ম টেক্সট বাতিল হতে পারে — অনুমোদিত টেমপ্লেট ব্যবহারই
        নিরাপদ।
      </p>
      {data !== null && !data.channel.configured ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          WhatsApp চ্যানেল কনফিগার করা নেই — অনুপস্থিত Settings: {data.channel.missingSettings.join(", ") || "—"}।
          ক্যাম্পেইন পাঠালে NOT_SENT হিসেবে রেকর্ড হবে, পাঠানো হয়েছে বলে দেখানো হবে না।
        </p>
      ) : null}
      {error !== null ? <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {notice !== null ? <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p> : null}

      <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4">
        <label className={labelCls}>
          ক্যাম্পেইনের নাম
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className={labelCls}>
          মেসেজ
          <textarea className={inputCls} rows={3} value={messageText} onChange={(e) => setMessageText(e.target.value)} />
        </label>
        <div>
          <button type="button" onClick={() => void create()} disabled={title.trim() === "" || messageText.trim() === ""} className="rounded-full bg-violet-600 px-5 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50">
            ড্রাফট তৈরি করুন
          </button>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {data?.campaigns.map((campaign) => (
          <div key={campaign.id} className="rounded-xl ring-1 ring-slate-200 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-bold text-slate-900">{campaign.title}</p>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{campaign.status}</span>
              <span className="text-xs text-slate-400">
                অডিয়েন্স {campaign.audienceCount} · চেষ্টা {campaign.attemptedCount}
              </span>
              {campaign.status === "DRAFT" || campaign.status === "NOT_SENT" || campaign.status === "FAILED" ? (
                <button
                  type="button"
                  disabled={sendingId !== null}
                  className="ml-auto rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
                  onClick={() => void send(campaign.id)}
                >
                  {sendingId === campaign.id ? "পাঠানো হচ্ছে…" : "পাঠান"}
                </button>
              ) : null}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{campaign.message}</p>
            {campaign.notSentReason !== undefined ? <p className="mt-1 text-sm text-red-600">{campaign.notSentReason}</p> : null}
            {campaign.note !== undefined ? <p className="mt-1 text-sm text-amber-700">{campaign.note}</p> : null}
            {campaign.results.length > 0 ? (
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto text-xs text-slate-500">
                {campaign.results.map((r, i) => (
                  <li key={i}>
                    {r.phoneMasked} — {r.status}
                    {r.platformMessageId !== undefined ? ` (${r.platformMessageId})` : ""}
                    {r.error !== undefined ? ` — ${r.error}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
        {data !== null && data.campaigns.length === 0 ? <p className="text-sm text-slate-400">কোনো ক্যাম্পেইন নেই।</p> : null}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* EMI info (settings live in Settings → Payments; display summary)    */
/* ------------------------------------------------------------------ */

function EmiSection() {
  return (
    <section className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <h2 className="text-lg font-bold text-slate-900">EMI ডিসপ্লে</h2>
      <p className="mt-1 text-sm text-slate-500">
        EMI শুধু প্রদর্শনের জন্য — কোনো গেটওয়ে নেই, চার্জের পরিমাণ বদলায় না। কনফিগারেশন: Admin → Settings → Payment —
        কীগুলো: <code className="font-mono text-[13px]">payments.emi.enabled</code>,{" "}
        <code className="font-mono text-[13px]">payments.emi.months</code>,{" "}
        <code className="font-mono text-[13px]">payments.emi.surcharge_bps</code>,{" "}
        <code className="font-mono text-[13px]">payments.emi.min_order_poisha</code>। BNPL-এর কোনো প্রোভাইডার সিস্টেমে নেই,
        তাই BNPL কোথাও দেখানো হয় না।
      </p>
    </section>
  );
}

export function MechanicsManager() {
  return (
    <>
      <SpinSection />
      <ExperimentsSection />
      <BroadcastSection />
      <EmiSection />
    </>
  );
}
