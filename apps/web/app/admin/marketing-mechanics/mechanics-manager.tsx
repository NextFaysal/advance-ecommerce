"use client";

// Marketing mechanics manager (ADV-18B) — three sections over the
// admin marketing APIs. Everything shown is live server state:
// spin odds come from the server's drawable-draw computation, A/B
// numbers are raw TrackingEvent counts (labelled descriptive), and
// a broadcast is only "sent" when the Meta adapter really sent it.
import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { formatBdt } from "@advance-ecommerce/validators";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { MECHANICS_STRINGS } from "./strings";

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

const inputCls = "min-h-[44px] w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-text-main";
const labelCls = "block text-xs font-semibold text-text-muted";

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
    <Card className="mt-6">
      <h2 className="text-lg font-bold text-text-main">স্পিন হুইল</h2>
      <p className="mt-1 text-sm text-text-muted">
        ওজন অনুযায়ী সার্ভার ফলাফল ঠিক করে। অন্তত একটি &ldquo;পুরস্কার নেই&rdquo; সেগমেন্ট (কুপন খালি) থাকতেই হবে —
        ছাড়া সেভ হবে না। যেসব পুরস্কার-সেগমেন্টের কুপন এখন সক্রিয় নয়, সেগুলো ড্র থেকে বাদ যায় (নিচে দেখুন)।
      </p>
      {error !== null ? <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
      {message !== null ? <p className="mt-3 rounded-xl bg-success-soft px-3 py-2 text-sm text-success-solid">{message}</p> : null}
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
          <div key={segment.id} className="grid items-end gap-2 rounded-2xl border border-border/60 bg-surface-2/50 p-3 sm:grid-cols-[1fr_1fr_110px_110px_36px]">
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
            <p className="tnum pb-2 text-xs text-text-muted">
              আসল সম্ভাবনা: {oddsFor(segment.id) !== undefined ? `${oddsFor(segment.id)}%` : "ড্রতে নেই"}
            </p>
            <button type="button" aria-label="সেগমেন্ট মুছুন" className="mb-1 flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-card text-text-muted hover:text-danger" onClick={() => setSegments((rows) => rows.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="min-h-[44px] rounded-xl bg-surface-2 px-3 py-1.5 text-sm font-semibold text-text-main hover:bg-brand-soft"
          onClick={() => setSegments((rows) => [...rows, { id: `seg-${rows.length + 1}-${Date.now().toString(36)}`, labelBn: "", couponCode: "", weightBps: 1000 }])}
        >
          + সেগমেন্ট যোগ করুন
        </button>
      </div>
      {data !== null && data.display.excludedPrizeSegments.length > 0 ? (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          ড্র থেকে বাদ: {data.display.excludedPrizeSegments.map((x) => `${x.couponCode} (${x.reason})`).join(", ")}
        </p>
      ) : null}
      <button type="button" onClick={() => void save()} className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-brand-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-brand-700">
        সংরক্ষণ করুন
      </button>
      {data !== null && data.recentSpins.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-bold text-text-main">সাম্প্রতিক স্পিন (Redis অডিট লগ — সাময়িক)</h3>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs text-text-muted">
            {data.recentSpins.map((entry, i) => (
              <li key={i} className="rounded-lg bg-surface-2 px-2 py-1 font-mono">
                {JSON.stringify(entry)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Experiments                                                         */
/* ------------------------------------------------------------------ */

/** Mirrors src/marketing/experiments.ts: the target is the bare
 *  "hero" literal or a funnel-step object (doc 34 §3.8); a variant
 *  carries hero copy (hero target), a pageId (funnel-step target),
 *  or neither (control). */
type ExperimentTargetRow = "hero" | { kind: "funnel_step"; funnelId: string; stepId: string };

interface ExperimentVariantRow {
  key: string;
  weightBps: number;
  hero?: { headlineBn: string; subBn: string; ctaLabelBn: string; ctaHref: string };
  pageId?: string;
}

interface ExperimentRow {
  id: string;
  name: string;
  status: "draft" | "running" | "stopped";
  target: ExperimentTargetRow;
  createdAt: string;
  variants: ExperimentVariantRow[];
}

interface ExpStats {
  variants: Array<{ variantKey: string; exposures: number; conversions: number; conversionPercent: number | null }>;
}

/** Revenue stats (funnel-step experiments only, doc 34 §3.8):
 *  exposures/conversions plus the attributed orders' totals. */
interface ExpRevenueStats {
  variants: Array<{ variantKey: string; revenuePoisha: number; revenuePerVisitorPoisha: number | null }>;
}

interface FunnelOption {
  id: string;
  name: string;
  slug: string;
  status: string;
  steps: Array<{ id: string; kind: string; pageId: string }>;
}

interface LandingPageOption {
  id: string;
  titleBn: string;
  titleEn: string;
  status: string;
}

function ExperimentsSection() {
  const { locale } = useLocale();
  const s = pick(locale, MECHANICS_STRINGS);
  const [experiments, setExperiments] = useState<ExperimentRow[]>([]);
  const [stats, setStats] = useState<Record<string, ExpStats>>({});
  const [revenueStats, setRevenueStats] = useState<Record<string, ExpRevenueStats>>({});
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [variantB, setVariantB] = useState({ headlineBn: "", subBn: "", ctaLabelBn: "", ctaHref: "/shop" });
  const [weightA, setWeightA] = useState(5000);
  const [weightB, setWeightB] = useState(5000);
  // Funnel-step target (doc 34 §3.8): funnel → step → variant B page.
  const [targetKind, setTargetKind] = useState<"hero" | "funnel_step">("hero");
  const [funnels, setFunnels] = useState<FunnelOption[]>([]);
  const [landingPages, setLandingPages] = useState<LandingPageOption[]>([]);
  const [listsLoaded, setListsLoaded] = useState(false);
  const [listsError, setListsError] = useState(false);
  const [fxFunnelId, setFxFunnelId] = useState("");
  const [fxStepId, setFxStepId] = useState("");
  const [fxPageId, setFxPageId] = useState("");

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

  /** Funnel + landing-page lists for the funnel-step selects (the
   *  APIs guard on content.page; a failure leaves the selects empty
   *  with an honest hint instead of breaking the section). */
  const loadLists = useCallback(async () => {
    try {
      const [f, p] = await Promise.all([
        api<{ funnels: FunnelOption[] }>("/api/v1/admin/funnels"),
        api<{ pages: LandingPageOption[] }>("/api/v1/admin/landing"),
      ]);
      setFunnels(f.funnels);
      setLandingPages(p.pages);
      setListsError(false);
    } catch {
      setListsError(true);
    } finally {
      setListsLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!listsLoaded && (targetKind === "funnel_step" || experiments.some((e) => e.target !== "hero"))) {
      void loadLists();
    }
  }, [targetKind, listsLoaded, experiments, loadLists]);

  const fxFunnel = funnels.find((f) => f.id === fxFunnelId) ?? null;
  const fxSteps = (fxFunnel?.steps ?? []).filter((st) => st.kind === "landing" || st.kind === "order");
  const fxStep = fxSteps.find((st) => st.id === fxStepId) ?? null;
  const fxPageOptions = landingPages.filter((p) => p.status === "PUBLISHED" && (fxStep === null || p.id !== fxStep.pageId));
  const pageTitle = (id: string): string => {
    const p = landingPages.find((x) => x.id === id);
    return p ? (locale === "en" ? p.titleEn || p.titleBn : p.titleBn) : id;
  };
  const funnelName = (id: string): string => funnels.find((f) => f.id === id)?.name ?? id;

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
    const id = `exp-${Date.now().toString(36)}`;
    let experiment: ExperimentRow;
    if (targetKind === "funnel_step") {
      if (name.trim() === "" || fxFunnelId === "" || fxStepId === "" || fxPageId === "") {
        setError(s.fxRequiredError);
        return;
      }
      experiment = {
        id,
        name: name.trim(),
        status: "draft",
        target: { kind: "funnel_step", funnelId: fxFunnelId, stepId: fxStepId },
        createdAt: new Date().toISOString(),
        variants: [
          { key: "A", weightBps: weightA },
          { key: "B", weightBps: weightB, pageId: fxPageId },
        ],
      };
    } else {
      if (name.trim() === "" || variantB.headlineBn.trim() === "" || variantB.ctaLabelBn.trim() === "") {
        setError(s.expRequiredError);
        return;
      }
      experiment = {
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
    }
    try {
      await putDoc([...experiments, experiment]);
      setMessage(s.expCreated);
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
      const d = await api<{ stats: ExpStats | null; statsRevenue: ExpRevenueStats | null }>(
        `/api/v1/admin/marketing/experiments?stats=${encodeURIComponent(id)}`,
      );
      if (d.stats !== null) setStats((prev) => ({ ...prev, [id]: d.stats as ExpStats }));
      if (d.statsRevenue !== null && d.statsRevenue !== undefined) {
        setRevenueStats((prev) => ({ ...prev, [id]: d.statsRevenue as ExpRevenueStats }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "stats failed");
    }
  };

  const variantSummary = (v: ExperimentVariantRow): string => {
    const base = interpolate(s.expVariantWeight, { key: v.key, weight: v.weightBps });
    if (v.hero) return `${base} — “${v.hero.headlineBn}”`;
    if (v.pageId) return `${base} — ${pageTitle(v.pageId)}`;
    return `${base}${s.expControlSuffix}`;
  };

  return (
    <Card className="mt-6">
      <h2 className="text-lg font-bold text-text-main">{s.expTitle}</h2>
      <p className="mt-1 text-sm text-text-muted">{s.expIntro}</p>
      {error !== null ? <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
      {message !== null ? <p className="mt-3 rounded-xl bg-success-soft px-3 py-2 text-sm text-success-solid">{message}</p> : null}

      <div className="mt-4 grid gap-3 rounded-2xl border border-border/60 bg-surface-2/50 p-4 sm:grid-cols-2">
        <label className={labelCls}>
          {s.expNameLabel}
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={s.expNamePlaceholder} />
        </label>
        <label className={labelCls}>
          {s.fxTargetLabel}
          <select
            className={inputCls}
            value={targetKind}
            onChange={(e) => setTargetKind(e.target.value as "hero" | "funnel_step")}
          >
            <option value="hero">{s.fxTargetHero}</option>
            <option value="funnel_step">{s.fxTargetFunnelStep}</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className={labelCls}>
            {s.expWeightALabel}
            <input type="number" className={inputCls} value={weightA} onChange={(e) => setWeightA(Number(e.target.value))} />
          </label>
          <label className={labelCls}>
            {s.expWeightBLabel}
            <input type="number" className={inputCls} value={weightB} onChange={(e) => setWeightB(Number(e.target.value))} />
          </label>
        </div>
        {targetKind === "hero" ? (
          <>
            <label className={labelCls}>
              {s.expBHeadlineLabel}
              <input className={inputCls} value={variantB.headlineBn} onChange={(e) => setVariantB((v) => ({ ...v, headlineBn: e.target.value }))} />
            </label>
            <label className={labelCls}>
              {s.expBSubLabel}
              <input className={inputCls} value={variantB.subBn} onChange={(e) => setVariantB((v) => ({ ...v, subBn: e.target.value }))} />
            </label>
            <label className={labelCls}>
              {s.expBCtaLabel}
              <input className={inputCls} value={variantB.ctaLabelBn} onChange={(e) => setVariantB((v) => ({ ...v, ctaLabelBn: e.target.value }))} />
            </label>
            <label className={labelCls}>
              {s.expBCtaHrefLabel}
              <input className={inputCls} value={variantB.ctaHref} onChange={(e) => setVariantB((v) => ({ ...v, ctaHref: e.target.value }))} />
            </label>
          </>
        ) : (
          <>
            <label className={labelCls}>
              {s.fxFunnelLabel}
              <select
                className={inputCls}
                value={fxFunnelId}
                onChange={(e) => {
                  setFxFunnelId(e.target.value);
                  setFxStepId("");
                  setFxPageId("");
                }}
              >
                <option value="">—</option>
                {funnels.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.status})
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              {s.fxStepLabel}
              <select
                className={inputCls}
                value={fxStepId}
                onChange={(e) => {
                  setFxStepId(e.target.value);
                  setFxPageId("");
                }}
              >
                <option value="">—</option>
                {fxSteps.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.kind} · {st.id}
                  </option>
                ))}
              </select>
            </label>
            <label className={labelCls}>
              {s.fxBPageLabel}
              <select className={inputCls} value={fxPageId} onChange={(e) => setFxPageId(e.target.value)}>
                <option value="">—</option>
                {fxPageOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {locale === "en" ? p.titleEn || p.titleBn : p.titleBn}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-xs text-text-muted sm:col-span-2">
              {s.fxBPageHint}
              {listsError ? <span className="mt-1 block text-danger">{s.fxListsLoadFailed}</span> : null}
            </p>
          </>
        )}
        <div>
          <button type="button" onClick={() => void create()} className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-brand-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-brand-700">
            {s.expCreateDraft}
          </button>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {experiments.map((experiment) => (
          <div key={experiment.id} className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-bold text-text-main">{experiment.name}</p>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-text-muted">{experiment.status}</span>
              <span className="text-xs text-text-subtle">{experiment.id}</span>
              <span className="ml-auto flex gap-2">
                {experiment.status !== "running" ? (
                  <button type="button" className="rounded-xl bg-emerald-600 px-3 py-1 text-xs font-bold text-white" onClick={() => void setStatus(experiment.id, "running")}>
                    {s.expStart}
                  </button>
                ) : (
                  <button type="button" className="rounded-xl bg-red-600 px-3 py-1 text-xs font-bold text-white" onClick={() => void setStatus(experiment.id, "stopped")}>
                    {s.expStop}
                  </button>
                )}
                <button type="button" className="rounded-xl bg-surface-2 px-3 py-1 text-xs font-bold text-text-main" onClick={() => void loadStats(experiment.id)}>
                  {s.expViewResults}
                </button>
              </span>
            </div>
            {experiment.target !== "hero" ? (
              <p className="mt-1 text-xs font-semibold text-text-muted">
                {interpolate(s.fxTargetSummary, { funnel: funnelName(experiment.target.funnelId), step: experiment.target.stepId })}
              </p>
            ) : null}
            <p className="tnum mt-1 text-xs text-text-muted">
              {experiment.variants.map((v) => variantSummary(v)).join(" · ")}
            </p>
            {stats[experiment.id] !== undefined ? (
              <div className="mt-3">
                {revenueStats[experiment.id] !== undefined ? (
                  <DataTable
                    columns={[
                      { key: "variant", header: s.expThVariant },
                      { key: "exposures", header: s.expThExposures },
                      { key: "conversions", header: s.expThConversions },
                      { key: "conversionPercent", header: s.expThConversionPct },
                      { key: "revenue", header: s.fxThRevenue },
                      { key: "revenuePerVisitor", header: s.fxThRevenuePerVisitor },
                    ]}
                    rows={(stats[experiment.id]?.variants ?? []).map((v) => {
                      const rev = revenueStats[experiment.id]?.variants.find((r) => r.variantKey === v.variantKey);
                      return {
                        variant: <span className="font-mono">{v.variantKey}</span>,
                        exposures: <span className="tnum">{v.exposures}</span>,
                        conversions: <span className="tnum">{v.conversions}</span>,
                        conversionPercent: <span className="tnum">{v.conversionPercent !== null ? `${v.conversionPercent}%` : "—"}</span>,
                        revenue: <span className="tnum">{rev ? formatBdt(rev.revenuePoisha) : "—"}</span>,
                        revenuePerVisitor: (
                          <span className="tnum">{rev && rev.revenuePerVisitorPoisha !== null ? formatBdt(rev.revenuePerVisitorPoisha) : "—"}</span>
                        ),
                      };
                    })}
                  />
                ) : (
                  <DataTable
                    columns={[
                      { key: "variant", header: s.expThVariant },
                      { key: "exposures", header: s.expThExposures },
                      { key: "conversions", header: s.expThConversions },
                      { key: "conversionPercent", header: s.expThConversionPct },
                    ]}
                    rows={(stats[experiment.id]?.variants ?? []).map((v) => ({
                      variant: <span className="font-mono">{v.variantKey}</span>,
                      exposures: <span className="tnum">{v.exposures}</span>,
                      conversions: <span className="tnum">{v.conversions}</span>,
                      conversionPercent: <span className="tnum">{v.conversionPercent !== null ? `${v.conversionPercent}%` : "—"}</span>,
                    }))}
                  />
                )}
              </div>
            ) : null}
          </div>
        ))}
        {experiments.length === 0 ? <p className="text-sm text-text-subtle">{s.expNone}</p> : null}
      </div>
    </Card>
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
    <Card className="mt-6">
      <h2 className="text-lg font-bold text-text-main">WhatsApp ব্রডকাস্ট</h2>
      <p className="mt-1 text-sm text-text-muted">
        অডিয়েন্স: নিউজলেটারে সাবস্ক্রাইব করা ইমেইলের সঙ্গে মিলে যাওয়া, ফোন-সহ অ্যাক্টিভ কাস্টমাররাই শুধু — আলাদা
        WhatsApp সম্মতির কোনো ফিল্ড সিস্টেমে নেই, তাই এর বাইরে কাউকে পাঠানো হয় না। বর্তমান অডিয়েন্স:{" "}
        <strong className="text-text-main">{data?.audienceCount ?? "…"}</strong> জন। একবারে সর্বোচ্চ ৫০ জনকে পাঠানো হয়
        (ব্যাচ সীমা)। Meta-র নিয়মে ২৪ ঘণ্টার উইন্ডোর বাইরে ফ্রি-ফর্ম টেক্সট বাতিল হতে পারে — অনুমোদিত টেমপ্লেট ব্যবহারই
        নিরাপদ।
      </p>
      {data !== null && !data.channel.configured ? (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          WhatsApp চ্যানেল কনফিগার করা নেই — অনুপস্থিত Settings: {data.channel.missingSettings.join(", ") || "—"}।
          ক্যাম্পেইন পাঠালে NOT_SENT হিসেবে রেকর্ড হবে, পাঠানো হয়েছে বলে দেখানো হবে না।
        </p>
      ) : null}
      {error !== null ? <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p> : null}
      {notice !== null ? <p className="mt-3 rounded-xl bg-success-soft px-3 py-2 text-sm text-success-solid">{notice}</p> : null}

      <div className="mt-4 grid gap-3 rounded-2xl border border-border/60 bg-surface-2/50 p-4">
        <label className={labelCls}>
          ক্যাম্পেইনের নাম
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className={labelCls}>
          মেসেজ
          <textarea className={inputCls} rows={3} value={messageText} onChange={(e) => setMessageText(e.target.value)} />
        </label>
        <div>
          <button type="button" onClick={() => void create()} disabled={title.trim() === "" || messageText.trim() === ""} className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-brand-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-brand-700 disabled:opacity-50">
            ড্রাফট তৈরি করুন
          </button>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {data?.campaigns.map((campaign) => (
          <div key={campaign.id} className="rounded-2xl border border-border/60 bg-card p-4 shadow-xs">
            <div className="flex flex-wrap items-center gap-3">
              <p className="font-bold text-text-main">{campaign.title}</p>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-text-muted">{campaign.status}</span>
              <span className="tnum text-xs text-text-subtle">
                অডিয়েন্স {campaign.audienceCount} · চেষ্টা {campaign.attemptedCount}
              </span>
              {campaign.status === "DRAFT" || campaign.status === "NOT_SENT" || campaign.status === "FAILED" ? (
                <button
                  type="button"
                  disabled={sendingId !== null}
                  className="ml-auto rounded-xl bg-emerald-600 px-3 py-1 text-xs font-bold text-white disabled:opacity-50"
                  onClick={() => void send(campaign.id)}
                >
                  {sendingId === campaign.id ? "পাঠানো হচ্ছে…" : "পাঠান"}
                </button>
              ) : null}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-text-muted">{campaign.message}</p>
            {campaign.notSentReason !== undefined ? <p className="mt-1 text-sm text-danger">{campaign.notSentReason}</p> : null}
            {campaign.note !== undefined ? <p className="mt-1 text-sm text-amber-700">{campaign.note}</p> : null}
            {campaign.results.length > 0 ? (
              <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto text-xs text-text-muted">
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
        {data !== null && data.campaigns.length === 0 ? <p className="text-sm text-text-subtle">কোনো ক্যাম্পেইন নেই।</p> : null}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* EMI info (settings live in Settings → Payments; display summary)    */
/* ------------------------------------------------------------------ */

function EmiSection() {
  return (
    <Card className="mt-6">
      <h2 className="text-lg font-bold text-text-main">EMI ডিসপ্লে</h2>
      <p className="mt-1 text-sm text-text-muted">
        EMI শুধু প্রদর্শনের জন্য — কোনো গেটওয়ে নেই, চার্জের পরিমাণ বদলায় না। কনফিগারেশন: Admin → Settings → Payment —
        কীগুলো: <code className="font-mono text-[13px]">payments.emi.enabled</code>,{" "}
        <code className="font-mono text-[13px]">payments.emi.months</code>,{" "}
        <code className="font-mono text-[13px]">payments.emi.surcharge_bps</code>,{" "}
        <code className="font-mono text-[13px]">payments.emi.min_order_poisha</code>। BNPL-এর কোনো প্রোভাইডার সিস্টেমে নেই,
        তাই BNPL কোথাও দেখানো হয় না।
      </p>
    </Card>
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
