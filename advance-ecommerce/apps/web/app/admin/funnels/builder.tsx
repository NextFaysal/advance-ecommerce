"use client";
// Funnel builder UI — doc 34 L7.
// Editing state is seeded from the DB-backed store via the server
// parent's props and PERSISTS through the admin API: Save posts a
// new funnel (POST /api/v1/admin/funnels) or patches the full body
// of an existing one (PATCH .../[id]); status buttons patch
// { status } through the same route's status flow (publishing runs
// the full §3.8 validation server-side); Delete calls DELETE.
// Every API validation error is surfaced VERBATIM (the API's own
// bilingual messages) — this UI never invents its own verdicts; it
// only mirrors the graph rules in the controls themselves (offer
// accept/decline targets can only be LATER steps, exactly the
// server's forward-only rule). A funnel created here but not yet
// saved carries an `fn_local_` id and is labelled unsaved.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatBdt } from "@advance-ecommerce/validators";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick, type Locale } from "@/i18n/locale";
import {
  FUNNEL_STEP_LABELS,
  newFunnelStepId,
  type BumpOffer,
  type Funnel,
  type FunnelStatus,
  type FunnelStep,
  type FunnelStepKind,
  type StepOffer,
} from "@/funnels/types";
import { FUNNEL_ADMIN_STRINGS } from "./strings";

export interface FunnelPickerPage {
  id: string;
  titleBn: string;
  titleEn: string;
  slug: string;
  status: string;
}

export interface FunnelPickerProduct {
  id: string;
  titleBn: string;
  titleEn: string;
  variants: { id: string; label: string; sku: string; pricePoisha: number; stock: number }[];
}

type OfferStep = Extract<FunnelStep, { kind: "upsell" | "downsell" }>;

const inputCls =
  "min-h-10 w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-text-main outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";
const labelCls = "mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const STEP_KINDS: readonly FunnelStepKind[] = ["landing", "order", "upsell", "downsell", "thank_you"];

/** API error details → verbatim display messages (the API's own
 *  bilingual validation errors; zod issues fall back to .message). */
function problemMessages(details: unknown, locale: Locale): string[] {
  if (!Array.isArray(details)) return [];
  return details
    .map((d) => {
      const e = d as { messageBn?: unknown; messageEn?: unknown; message?: unknown };
      if (typeof e.messageBn === "string" || typeof e.messageEn === "string") {
        return locale === "en"
          ? (e.messageEn as string) || (e.messageBn as string) || ""
          : (e.messageBn as string) || (e.messageEn as string) || "";
      }
      return typeof e.message === "string" ? e.message : "";
    })
    .filter((m) => m !== "");
}

export default function FunnelBuilder({
  initialFunnels,
  landingPages,
  products,
}: {
  initialFunnels: Funnel[];
  landingPages: FunnelPickerPage[];
  products: FunnelPickerProduct[];
}) {
  const { locale } = useLocale();
  const s = pick(locale, FUNNEL_ADMIN_STRINGS);
  const [funnels, setFunnels] = useState<Funnel[]>(() => clone(initialFunnels));
  const [savedJson, setSavedJson] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialFunnels.map((f) => [f.id, JSON.stringify(f)])),
  );
  const [selectedId, setSelectedId] = useState<string | null>(initialFunnels[0]?.id ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [newStepKind, setNewStepKind] = useState<FunnelStepKind>("landing");

  const selected = funnels.find((f) => f.id === selectedId) ?? null;
  const isLocal = (f: Funnel) => f.id.startsWith("fn_local_");
  const isDirty = (f: Funnel) => isLocal(f) || savedJson[f.id] !== JSON.stringify(f);

  const pageTitle = (pageId: string): string => {
    const p = landingPages.find((x) => x.id === pageId);
    if (!p) return pageId || "—";
    return locale === "en" ? p.titleEn || p.titleBn : p.titleBn;
  };
  const statusText = (status: string): string =>
    status === "PUBLISHED" ? s.statusPublished : status === "ARCHIVED" ? s.statusArchived : s.statusDraft;
  const stepLabel = (steps: FunnelStep[], step: FunnelStep): string => {
    const idx = steps.findIndex((x) => x.id === step.id);
    return `#${idx + 1} ${FUNNEL_STEP_LABELS[step.kind][locale]} — ${pageTitle(step.pageId)}`;
  };

  function replaceFunnel(next: Funnel) {
    setFunnels((prev) => prev.map((f) => (f.id === next.id || f.id === selectedId ? next : f)));
    setSavedJson((prev) => ({ ...prev, [next.id]: JSON.stringify(next) }));
    setSelectedId(next.id);
  }

  function updateSelected(mut: (f: Funnel) => Funnel) {
    if (!selected) return;
    setFunnels((prev) => prev.map((f) => (f.id === selected.id ? mut(clone(f)) : f)));
  }

  function updateStep(stepId: string, mut: (step: FunnelStep) => FunnelStep) {
    updateSelected((f) => ({ ...f, steps: f.steps.map((st) => (st.id === stepId ? mut(clone(st)) : st)) }));
  }

  function newFunnel() {
    const draft: Funnel = {
      id: `fn_local_${Date.now()}`,
      name: "",
      slug: "",
      status: "DRAFT",
      steps: [
        { id: newFunnelStepId("landing"), kind: "landing", pageId: "" },
        { id: newFunnelStepId("order"), kind: "order", pageId: "" },
        { id: newFunnelStepId("thank_you"), kind: "thank_you", pageId: "" },
      ],
      createdAt: "",
      updatedAt: "",
    };
    setFunnels((prev) => [draft, ...prev]);
    setSelectedId(draft.id);
    setProblems([]);
    setNotice(s.newDraftNotice);
  }

  async function save() {
    if (!selected || busy) return;
    setBusy(true);
    setProblems([]);
    setNotice(null);
    const local = isLocal(selected);
    const body = { name: selected.name, slug: selected.slug, status: selected.status, steps: selected.steps };
    try {
      const res = await fetch(local ? "/api/v1/admin/funnels" : `/api/v1/admin/funnels/${selected.id}`, {
        method: local ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as {
        data?: { funnel: Funnel };
        error?: { message?: string; details?: unknown };
      } | null;
      if (res.ok && json?.data?.funnel) {
        replaceFunnel(json.data.funnel);
        setNotice(s.savedMsg);
      } else {
        const msgs = problemMessages(json?.error?.details, locale);
        if (msgs.length > 0) setProblems(msgs);
        else setNotice(interpolate(s.saveFailed, { msg: json?.error?.message ?? String(res.status) }));
      }
    } catch {
      setNotice(s.saveFailedNetwork);
    }
    setBusy(false);
  }

  async function changeStatus(to: FunnelStatus) {
    if (!selected || busy) return;
    if (isLocal(selected)) {
      setNotice(s.notSavedNotice);
      return;
    }
    setBusy(true);
    setProblems([]);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/admin/funnels/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to }),
      });
      const json = (await res.json().catch(() => null)) as {
        data?: { funnel: Funnel };
        error?: { message?: string; details?: unknown };
      } | null;
      if (res.ok && json?.data?.funnel) {
        replaceFunnel(json.data.funnel);
        setNotice(to === "PUBLISHED" ? interpolate(s.publishedMsg, { slug: json.data.funnel.slug }) : s.statusChangedMsg);
      } else {
        const msgs = problemMessages(json?.error?.details, locale);
        if (msgs.length > 0) setProblems(msgs);
        else setNotice(interpolate(s.statusFailed, { msg: json?.error?.message ?? String(res.status) }));
      }
    } catch {
      setNotice(s.statusFailedNetwork);
    }
    setBusy(false);
  }

  async function deleteFunnel() {
    if (!selected || busy) return;
    if (!window.confirm(interpolate(s.confirmDeleteFunnel, { name: selected.name || selected.slug }))) return;
    if (isLocal(selected)) {
      setFunnels((prev) => prev.filter((f) => f.id !== selected.id));
      setSelectedId(null);
      setNotice(s.deletedMsg);
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/admin/funnels/${selected.id}`, { method: "DELETE" });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (res.ok) {
        setFunnels((prev) => prev.filter((f) => f.id !== selected.id));
        setSelectedId(null);
        setNotice(s.deletedMsg);
      } else {
        setNotice(interpolate(s.deleteFailed, { msg: json?.error?.message ?? String(res.status) }));
      }
    } catch {
      setNotice(s.deleteFailedNetwork);
    }
    setBusy(false);
  }

  /* ---------- step operations ---------- */

  function rebuildStep(step: FunnelStep, kind: FunnelStepKind, steps: FunnelStep[]): FunnelStep {
    const base = { id: step.id, pageId: step.pageId };
    const idx = steps.findIndex((x) => x.id === step.id);
    const nextId = steps[idx + 1]?.id ?? "";
    switch (kind) {
      case "landing":
        return { ...base, kind };
      case "thank_you":
        return { ...base, kind };
      case "order":
        return step.kind === "order" ? { ...base, kind, ...(step.bump ? { bump: step.bump } : {}) } : { ...base, kind };
      case "upsell":
      case "downsell":
        return step.kind === "upsell" || step.kind === "downsell"
          ? { ...base, kind, offer: step.offer, acceptStepId: step.acceptStepId, declineStepId: step.declineStepId }
          : { ...base, kind, offer: { productId: "", variantId: null, discount: null }, acceptStepId: nextId, declineStepId: nextId };
    }
  }

  function addStep() {
    if (!selected) return;
    const id = newFunnelStepId(newStepKind);
    updateSelected((f) => {
      const steps = [...f.steps];
      const blank: FunnelStep =
        newStepKind === "upsell" || newStepKind === "downsell"
          ? { id, kind: newStepKind, pageId: "", offer: { productId: "", variantId: null, discount: null }, acceptStepId: "", declineStepId: "" }
          : newStepKind === "order"
            ? { id, kind: "order", pageId: "" }
            : newStepKind === "thank_you"
              ? { id, kind: "thank_you", pageId: "" }
              : { id, kind: "landing", pageId: "" };
      steps.push(blank);
      return { ...f, steps };
    });
  }

  /* ---------- shared offer editor ---------- */

  function OfferEditor({
    value,
    onChange,
  }: {
    value: StepOffer;
    onChange: (next: StepOffer) => void;
  }) {
    const product = products.find((p) => p.id === value.productId);
    const discountKind = value.discount?.kind ?? "none";
    return (
      <div className="grid gap-3">
        <div>
          <label className={labelCls}>{s.productLabel}</label>
          <select
            className={inputCls}
            value={value.productId}
            onChange={(e) => onChange({ ...value, productId: e.target.value, variantId: null })}
          >
            <option value="">{s.chooseProduct}</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {locale === "en" ? p.titleEn || p.titleBn : p.titleBn}
              </option>
            ))}
            {value.productId && !product ? <option value={value.productId}>{value.productId}</option> : null}
          </select>
        </div>
        <div>
          <label className={labelCls}>{s.variantLabel}</label>
          <select
            className={inputCls}
            value={value.variantId ?? ""}
            onChange={(e) => onChange({ ...value, variantId: e.target.value === "" ? null : e.target.value })}
          >
            <option value="">{s.autoVariant}</option>
            {(product?.variants ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.label || v.sku} — {formatBdt(v.pricePoisha)} ({v.stock})
              </option>
            ))}
            {value.variantId && !(product?.variants ?? []).some((v) => v.id === value.variantId) ? (
              <option value={value.variantId}>{value.variantId}</option>
            ) : null}
          </select>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>{s.discountKindLabel}</label>
            <select
              className={inputCls}
              value={discountKind}
              onChange={(e) => {
                const kind = e.target.value;
                if (kind === "percent") onChange({ ...value, discount: { kind: "percent", pct: value.discount?.kind === "percent" ? value.discount.pct : 10 } });
                else if (kind === "fixed") onChange({ ...value, discount: { kind: "fixed", poisha: value.discount?.kind === "fixed" ? value.discount.poisha : 10000 } });
                else onChange({ ...value, discount: null });
              }}
            >
              <option value="none">{s.discountNone}</option>
              <option value="percent">{s.discountPercent}</option>
              <option value="fixed">{s.discountFixed}</option>
            </select>
          </div>
          {value.discount?.kind === "percent" ? (
            <div>
              <label className={labelCls}>{s.discountPctLabel}</label>
              <input
                type="number"
                min={1}
                max={90}
                className={inputCls}
                value={value.discount.pct}
                onChange={(e) =>
                  onChange({ ...value, discount: { kind: "percent", pct: Number(e.target.value) || 0 } })
                }
              />
            </div>
          ) : value.discount?.kind === "fixed" ? (
            <div>
              <label className={labelCls}>{s.discountPoishaLabel}</label>
              <input
                type="number"
                min={1}
                className={inputCls}
                value={value.discount.poisha}
                onChange={(e) =>
                  onChange({ ...value, discount: { kind: "fixed", poisha: Number(e.target.value) || 0 } })
                }
              />
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  /* ---------- render ---------- */

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[320px_1fr]">
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold text-text-main">{s.funnelsListTitle}</h2>
          <Button type="button" onClick={newFunnel} disabled={busy}>
            {s.newFunnel}
          </Button>
        </div>
        <ul className="space-y-2">
          {funnels.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(f.id);
                  setProblems([]);
                  setNotice(null);
                }}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  f.id === selectedId ? "border-brand-500 bg-brand-50" : "border-border hover:border-brand-300"
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold text-text-main">{f.name || f.slug || "—"}</span>
                  <Badge>{statusText(f.status)}</Badge>
                </span>
                <span className="mt-1 block text-xs text-text-muted">
                  /f/{f.slug} · {interpolate(s.stepsSuffix, { count: f.steps.length })}
                  {isLocal(f) ? s.localSuffix : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <div className="min-w-0 space-y-4">
        {notice ? (
          <p className="rounded-xl bg-surface-2 p-3.5 text-sm font-medium text-text-main" role="status">
            {notice}
          </p>
        ) : null}
        {problems.length > 0 ? (
          <div className="rounded-xl bg-red-50 p-3.5 text-sm leading-6 text-red-800" role="alert">
            <p className="font-semibold">{interpolate(s.problemsTitle, { count: problems.length })}</p>
            <ul className="mt-1 list-inside list-disc">
              {problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {!selected ? (
          <Card className="p-5 text-text-muted">{s.noFunnelSelected}</Card>
        ) : (
          <>
            <Card className="space-y-4 p-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelCls}>{s.nameLabel}</label>
                  <input
                    className={inputCls}
                    value={selected.name}
                    onChange={(e) => updateSelected((f) => ({ ...f, name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={labelCls}>{s.slugLabel}</label>
                  <input
                    className={inputCls}
                    value={selected.slug}
                    onChange={(e) => updateSelected((f) => ({ ...f, slug: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={labelCls}>{s.statusLabel}:</span>
                <Badge>{statusText(selected.status)}</Badge>
                {selected.status === "PUBLISHED" ? (
                  <a className="text-sm text-brand-600 underline" href={`/f/${selected.slug}`} target="_blank" rel="noreferrer">
                    {s.publicLinkLabel}: /f/{selected.slug}
                  </a>
                ) : null}
                <span className="ml-auto flex flex-wrap gap-2">
                  {selected.status !== "PUBLISHED" ? (
                    <Button type="button" onClick={() => void changeStatus("PUBLISHED")} disabled={busy}>
                      {s.publish}
                    </Button>
                  ) : null}
                  {selected.status === "PUBLISHED" ? (
                    <Button type="button" variant="secondary" onClick={() => void changeStatus("DRAFT")} disabled={busy}>
                      {s.backToDraft}
                    </Button>
                  ) : null}
                  {selected.status !== "ARCHIVED" ? (
                    <Button type="button" variant="secondary" onClick={() => void changeStatus("ARCHIVED")} disabled={busy}>
                      {s.archive}
                    </Button>
                  ) : (
                    <Button type="button" variant="secondary" onClick={() => void changeStatus("DRAFT")} disabled={busy}>
                      {s.restoreDraft}
                    </Button>
                  )}
                  <Button type="button" variant="destructive" onClick={() => void deleteFunnel()} disabled={busy}>
                    {s.deleteBtn}
                  </Button>
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
                <Button type="button" onClick={() => void save()} disabled={busy}>
                  {busy ? s.saving : s.save}
                </Button>
                {isDirty(selected) ? <span className="text-sm text-amber-700">{s.unsavedChanges}</span> : null}
              </div>
            </Card>

            <Card className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold text-text-main">{s.stepsTitle}</h3>
                <span className="flex items-center gap-2">
                  <select
                    className={`${inputCls} w-auto`}
                    aria-label={s.newStepKindLabel}
                    value={newStepKind}
                    onChange={(e) => setNewStepKind(e.target.value as FunnelStepKind)}
                  >
                    {STEP_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {FUNNEL_STEP_LABELS[k][locale]}
                      </option>
                    ))}
                  </select>
                  <Button type="button" variant="secondary" onClick={addStep} disabled={busy}>
                    {s.addStep}
                  </Button>
                </span>
              </div>

              {selected.steps.map((step, idx) => (
                <div key={step.id} className="space-y-3 rounded-xl border border-border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-text-main">
                      #{idx + 1} {FUNNEL_STEP_LABELS[step.kind][locale]}
                    </span>
                    {idx === 0 ? <Badge>{s.entryBadge}</Badge> : null}
                    <span className="ml-auto flex gap-1.5">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={idx === 0 || busy}
                        onClick={() =>
                          updateSelected((f) => {
                            const steps = [...f.steps];
                            const [moved] = steps.splice(idx, 1);
                            steps.splice(idx - 1, 0, moved);
                            return { ...f, steps };
                          })
                        }
                      >
                        {s.moveUp}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={idx === selected.steps.length - 1 || busy}
                        onClick={() =>
                          updateSelected((f) => {
                            const steps = [...f.steps];
                            const [moved] = steps.splice(idx, 1);
                            steps.splice(idx + 1, 0, moved);
                            return { ...f, steps };
                          })
                        }
                      >
                        {s.moveDown}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => updateSelected((f) => ({ ...f, steps: f.steps.filter((x) => x.id !== step.id) }))}
                      >
                        {s.deleteStep}
                      </Button>
                    </span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className={labelCls}>{s.stepKindLabel}</label>
                      <select
                        className={inputCls}
                        value={step.kind}
                        onChange={(e) =>
                          updateStep(step.id, (st) => rebuildStep(st, e.target.value as FunnelStepKind, selected.steps))
                        }
                      >
                        {STEP_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {FUNNEL_STEP_LABELS[k][locale]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>{s.pageLabel}</label>
                      <select
                        className={inputCls}
                        value={step.pageId}
                        onChange={(e) => updateStep(step.id, (st) => ({ ...st, pageId: e.target.value }))}
                      >
                        <option value="">{s.choosePage}</option>
                        {landingPages.map((p) => (
                          <option key={p.id} value={p.id}>
                            {locale === "en" ? p.titleEn || p.titleBn : p.titleBn} (/{p.slug}) · {statusText(p.status)}
                          </option>
                        ))}
                        {step.pageId && !landingPages.some((p) => p.id === step.pageId) ? (
                          <option value={step.pageId}>{step.pageId}</option>
                        ) : null}
                      </select>
                    </div>
                  </div>

                  {step.kind === "order" ? (
                    <div className="space-y-3 rounded-lg bg-surface-2 p-3.5">
                      <p className="font-semibold text-text-main">{s.bumpTitle}</p>
                      {step.bump ? (
                        <>
                          <OfferEditor
                            value={step.bump}
                            onChange={(next) =>
                              updateStep(step.id, (st) =>
                                st.kind === "order" ? { ...st, bump: { ...(st.bump as BumpOffer), ...next } } : st,
                              )
                            }
                          />
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <label className={labelCls}>{s.headingBn}</label>
                              <input
                                className={inputCls}
                                value={step.bump.headingBn}
                                onChange={(e) =>
                                  updateStep(step.id, (st) =>
                                    st.kind === "order" && st.bump ? { ...st, bump: { ...st.bump, headingBn: e.target.value } } : st,
                                  )
                                }
                              />
                            </div>
                            <div>
                              <label className={labelCls}>{s.headingEn}</label>
                              <input
                                className={inputCls}
                                value={step.bump.headingEn}
                                onChange={(e) =>
                                  updateStep(step.id, (st) =>
                                    st.kind === "order" && st.bump ? { ...st, bump: { ...st.bump, headingEn: e.target.value } } : st,
                                  )
                                }
                              />
                            </div>
                          </div>
                          <p className="text-xs leading-5 text-text-muted">{s.bumpNote}</p>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() =>
                              updateStep(step.id, (st) => {
                                if (st.kind !== "order") return st;
                                const { bump: _dropped, ...rest } = st;
                                return rest;
                              })
                            }
                          >
                            {s.bumpDisable}
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            updateStep(step.id, (st) =>
                              st.kind === "order"
                                ? { ...st, bump: { productId: "", variantId: null, discount: null, headingBn: "", headingEn: "" } }
                                : st,
                            )
                          }
                        >
                          {s.bumpEnable}
                        </Button>
                      )}
                    </div>
                  ) : null}

                  {step.kind === "upsell" || step.kind === "downsell" ? (
                    <div className="space-y-3 rounded-lg bg-surface-2 p-3.5">
                      <p className="font-semibold text-text-main">{s.offerTitle}</p>
                      <OfferEditor
                        value={step.offer}
                        onChange={(next) =>
                          updateStep(step.id, (st) =>
                            st.kind === "upsell" || st.kind === "downsell" ? { ...st, offer: next } : st,
                          )
                        }
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        {(
                          [
                            ["acceptStepId", s.acceptTargetLabel],
                            ["declineStepId", s.declineTargetLabel],
                          ] as const
                        ).map(([field, label]) => {
                          const current = (step as OfferStep)[field];
                          const later = selected.steps.slice(idx + 1);
                          return (
                            <div key={field}>
                              <label className={labelCls}>{label}</label>
                              <select
                                className={inputCls}
                                value={current}
                                onChange={(e) =>
                                  updateStep(step.id, (st) =>
                                    st.kind === "upsell" || st.kind === "downsell" ? { ...st, [field]: e.target.value } : st,
                                  )
                                }
                              >
                                <option value="">{s.chooseTarget}</option>
                                {later.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {stepLabel(selected.steps, t)}
                                  </option>
                                ))}
                                {current && !later.some((t) => t.id === current) ? (
                                  <option value={current}>⚠ {stepLabel(selected.steps, selected.steps.find((x) => x.id === current) ?? step)}</option>
                                ) : null}
                              </select>
                            </div>
                          );
                        })}
                      </div>
                      <p className="text-xs leading-5 text-text-muted">{s.targetNote}</p>
                    </div>
                  ) : null}
                </div>
              ))}
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
