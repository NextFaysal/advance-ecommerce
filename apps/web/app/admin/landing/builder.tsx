"use client";
// Landing builder UI — Agent 53.
// Editing state is seeded from the DB-backed store via the server
// parent's `initialPages` prop (src/landing/store.ts is Prisma-backed)
// and PERSISTS through the API: "সংরক্ষণ করুন" posts a new page
// (POST /api/v1/admin/landing) or patches the full body of an existing
// one (PATCH .../[id]); status buttons patch { status } through the
// same route's status flow. A page created here but not yet saved
// carries an `lp_local_` id and is labelled অসংরক্ষিত until its first
// save. Validation shown here comes from the REAL
// validateLandingPage() — the same function the API and the publish
// transition run. The product catalog is NOT demo data: the server
// parent passes ACTIVE products from the real catalog DB
// (src/catalog/server-read) as the `catalogProducts` prop.
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Product } from "@/catalog/types";
import {
  LANDING_SECTION_LABELS, createEmptySection,
  type LandingPage, type LandingSection, type LandingSectionType, type LandingStatus,
} from "@/landing/types";
import { transitionLandingStatus, validateLandingPage } from "@/landing/validate";
import { buildLandingViewModel } from "@/landing/render";
import { LandingView } from "@/landing/components/LandingView";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { LANDING_STRINGS, type LandingStrings } from "./strings";

const SECTION_TYPES = Object.keys(LANDING_SECTION_LABELS) as LandingSectionType[];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function statusBadge(status: LandingStatus, s: LandingStrings) {
  if (status === "PUBLISHED") return <Badge tone="success">{s.statusPublished}</Badge>;
  if (status === "ARCHIVED") return <Badge tone="info">{s.statusArchived}</Badge>;
  return <Badge tone="warning">{s.statusDraft}</Badge>;
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-text-muted">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500"
      />
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-text-muted">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-full rounded-[10px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500"
      />
    </label>
  );
}

export default function LandingBuilder({ catalogProducts, initialPages }: { catalogProducts: Product[]; initialPages: LandingPage[] }) {
  const { locale } = useLocale();
  const s = pick(locale, LANDING_STRINGS);
  const [pages, setPages] = useState<LandingPage[]>(() => clone(initialPages));
  const [selectedId, setSelectedId] = useState<string>(pages[0]?.id ?? "");
  const [paletteType, setPaletteType] = useState<LandingSectionType>("benefits");
  const [notice, setNotice] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const selected = pages.find((p) => p.id === selectedId) ?? null;
  const otherSlugs = useMemo(
    () => pages.filter((p) => p.id !== selectedId).map((p) => p.slug),
    [pages, selectedId],
  );
  const validation = useMemo(
    () => (selected ? validateLandingPage(selected, catalogProducts, otherSlugs) : null),
    [selected, otherSlugs],
  );
  const view = useMemo(
    () => (selected ? buildLandingViewModel(selected, catalogProducts) : null),
    [selected],
  );

  function updateSelected(mutator: (page: LandingPage) => LandingPage) {
    setDirty(true);
    setPages((prev) => prev.map((p) => (p.id === selectedId ? { ...mutator(p), updatedAt: new Date().toISOString() } : p)));
  }

  async function apiErrorMessage(res: Response): Promise<string> {
    const json = (await res.json().catch(() => null)) as { error?: { message?: string; details?: unknown } } | null;
    const details = Array.isArray(json?.error?.details) ? interpolate(s.problemsSuffix, { count: json.error.details.length }) : "";
    return `${json?.error?.message ?? `HTTP ${res.status}`}${details}`;
  }

  /** Persist the selected page: POST for a not-yet-saved local draft,
   *  full-body PATCH otherwise (the API validates + store.update()). */
  async function saveSelected() {
    if (!selected || saving) return;
    setSaving(true);
    try {
      const payload = {
        slug: selected.slug,
        titleBn: selected.titleBn,
        titleEn: selected.titleEn,
        status: selected.status,
        sections: selected.sections,
      };
      const isLocal = selected.id.startsWith("lp_local_");
      const res = isLocal
        ? await fetch("/api/v1/admin/landing", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, status: "DRAFT" }),
          })
        : await fetch(`/api/v1/admin/landing/${selected.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      if (!res.ok) {
        setNotice(interpolate(s.saveFailed, { msg: await apiErrorMessage(res) }));
        return;
      }
      const json = (await res.json()) as { data: { page: LandingPage } };
      setPages((prev) => prev.map((p) => (p.id === selected.id ? json.data.page : p)));
      setSelectedId(json.data.page.id);
      setDirty(false);
      setNotice(s.savedMsg);
    } catch {
      setNotice(s.saveFailedNetwork);
    } finally {
      setSaving(false);
    }
  }

  function updateSection(sectionId: string, mutator: (s: LandingSection) => LandingSection) {
    updateSelected((page) => ({
      ...page,
      sections: page.sections.map((s) => (s.id === sectionId ? mutator(s) : s)),
    }));
  }

  function moveSection(index: number, delta: number) {
    updateSelected((page) => {
      const sections = [...page.sections];
      const target = index + delta;
      if (target < 0 || target >= sections.length) return page;
      const [item] = sections.splice(index, 1);
      if (!item) return page;
      sections.splice(target, 0, item);
      return { ...page, sections };
    });
  }

  function createDraft() {
    const firstProduct = catalogProducts[0];
    const page: LandingPage = {
      id: `lp_local_${Date.now().toString(36)}`,
      slug: `new-campaign-${pages.length + 1}`,
      titleBn: "নতুন ক্যাম্পেইন",
      titleEn: "New Campaign",
      status: "DRAFT",
      sections: [
        { id: `sec_local_hero_${Date.now().toString(36)}`, type: "hero", titleBn: "নতুন অফার", titleEn: "New Offer", subtitleBn: "", subtitleEn: "", imageUrl: null, ctaLabelBn: "এখনই অর্ডার করুন", ctaLabelEn: "Order Now" },
        { id: `sec_local_offer_${Date.now().toString(36)}`, type: "product_offer", productId: firstProduct?.id ?? "", variantId: null, discountNoteBn: "", discountNoteEn: "", showCountdown: false, countdownEndsAt: null },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setPages((prev) => [page, ...prev]);
    setSelectedId(page.id);
    setDirty(true);
    setNotice(s.newDraftNotice);
  }

  async function changeStatus(to: LandingStatus) {
    if (!selected || saving) return;
    if (selected.id.startsWith("lp_local_")) {
      setNotice(s.notSavedNotice);
      return;
    }
    // Local transition check first (instant feedback, same rules the
    // API applies); the PATCH below is what actually persists.
    const result = transitionLandingStatus(selected, to, catalogProducts, otherSlugs);
    if (!result.ok) {
      setNotice(`⚠ ${result.messageBn}${result.validation ? interpolate(s.transitionProblems, { count: result.validation.errors.length }) : ""}`);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/admin/landing/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to }),
      });
      if (!res.ok) {
        setNotice(interpolate(s.statusFailed, { msg: await apiErrorMessage(res) }));
        return;
      }
      const json = (await res.json()) as { data: { page: LandingPage } };
      setPages((prev) => prev.map((p) => (p.id === selectedId ? json.data.page : p)));
      setNotice(to === "PUBLISHED" ? interpolate(s.publishedMsg, { slug: json.data.page.slug }) : s.statusChangedMsg);
    } catch {
      setNotice(s.statusFailedNetwork);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={createDraft}>{s.newPage}</Button>
        <Button type="button" variant="secondary" onClick={saveSelected} disabled={!selected || saving}>
          {saving ? s.saving : s.save}
        </Button>
        {dirty ? <span className="text-xs font-medium text-amber-600">{s.unsavedChanges}</span> : null}
      </div>
      {notice ? <p role="status" className="rounded-lg bg-surface-2 px-4 py-2 text-sm">{notice}</p> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-semibold">{s.pagesListTitle}</h2>
            <ul className="space-y-2">
              {pages.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm ${p.id === selectedId ? "border-brand-500 bg-brand-50" : "border-border bg-card"}`}
                  >
                    <span>
                      <span className="font-medium">{locale === "bn" ? p.titleBn : p.titleEn}</span>
                      <span className="block font-mono text-xs text-text-muted">
                        /lp/{p.slug} · {interpolate(s.sectionsSuffix, { count: p.sections.length })}{p.id.startsWith("lp_local_") ? s.localSuffix : ""}
                      </span>
                    </span>
                    {statusBadge(p.status, s)}
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {selected ? (
            <Card>
              <h2 className="mb-3 font-semibold">{s.pageSettings}</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label={s.titleBn} value={selected.titleBn} onChange={(v) => updateSelected((p) => ({ ...p, titleBn: v }))} />
                <TextField label={s.titleEn} value={selected.titleEn} onChange={(v) => updateSelected((p) => ({ ...p, titleEn: v }))} />
                <TextField label={s.slugLabel} value={selected.slug} onChange={(v) => updateSelected((p) => ({ ...p, slug: v }))} />
                <div>
                  <span className="mb-1 block text-xs font-medium text-text-muted">{s.statusLabel}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {statusBadge(selected.status, s)}
                    {selected.status !== "PUBLISHED" ? (
                      <Button type="button" size="sm" onClick={() => changeStatus("PUBLISHED")}>{s.publish}</Button>
                    ) : (
                      <>
                        <Button type="button" size="sm" variant="outline" onClick={() => changeStatus("DRAFT")}>{s.backToDraft}</Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => changeStatus("ARCHIVED")}>{s.archive}</Button>
                      </>
                    )}
                    {selected.status === "ARCHIVED" ? (
                      <Button type="button" size="sm" onClick={() => changeStatus("DRAFT")}>{s.restoreDraft}</Button>
                    ) : null}
                  </div>
                </div>
              </div>

              {validation && !validation.ok ? (
                <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  <p className="font-medium">{interpolate(s.validationProblems, { count: validation.errors.length })}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {validation.errors.map((e, i) => <li key={i}>{e.messageBn}</li>)}
                  </ul>
                </div>
              ) : (
                <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">{s.validationOk}</p>
              )}
            </Card>
          ) : null}

          {selected ? (
            <Card>
              <h2 className="mb-3 font-semibold">{s.sectionsTitle}</h2>
              <div className="mb-4 flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-text-muted">{s.paletteLabel}</span>
                  <select
                    value={paletteType}
                    onChange={(e) => setPaletteType(e.target.value as LandingSectionType)}
                    className="h-10 rounded-[10px] border border-border bg-card px-3 text-sm"
                  >
                    {SECTION_TYPES.map((t) => <option key={t} value={t}>{LANDING_SECTION_LABELS[t][locale]}</option>)}
                  </select>
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => updateSelected((p) => ({ ...p, sections: [...p.sections, createEmptySection(paletteType)] }))}
                >
                  {s.addSection}
                </Button>
              </div>

              <div className="space-y-4">
                {selected.sections.map((section, index) => (
                  <div key={section.id} className="rounded-lg border border-border p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{index + 1}. {LANDING_SECTION_LABELS[section.type][locale]}</span>
                      <span className="flex gap-1">
                        <Button type="button" size="sm" variant="ghost" onClick={() => moveSection(index, -1)}>↑</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => moveSection(index, 1)}>↓</Button>
                        <Button type="button" size="sm" variant="destructive" onClick={() => updateSelected((p) => ({ ...p, sections: p.sections.filter((s) => s.id !== section.id) }))}>{s.deleteBtn}</Button>
                      </span>
                    </div>

                    {section.type === "hero" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <TextField label={s.headingBn} value={section.titleBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "hero" ? { ...s, titleBn: v } : s))} />
                        <TextField label={s.headingEn} value={section.titleEn} onChange={(v) => updateSection(section.id, (s) => (s.type === "hero" ? { ...s, titleEn: v } : s))} />
                        <TextArea label={s.subtitleBn} value={section.subtitleBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "hero" ? { ...s, subtitleBn: v } : s))} />
                        <TextField label={s.ctaBn} value={section.ctaLabelBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "hero" ? { ...s, ctaLabelBn: v } : s))} />
                      </div>
                    ) : null}

                    {section.type === "product_offer" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-muted">{s.productLabel}</span>
                          <select
                            value={section.productId}
                            onChange={(e) => updateSection(section.id, (s) => (s.type === "product_offer" ? { ...s, productId: e.target.value, variantId: null } : s))}
                            className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm"
                          >
                            <option value="">{s.chooseProduct}</option>
                            {catalogProducts.map((p) => <option key={p.id} value={p.id}>{p.title[locale]} ({p.id})</option>)}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-muted">{s.variantLabel}</span>
                          <select
                            value={section.variantId ?? ""}
                            onChange={(e) => updateSection(section.id, (s) => (s.type === "product_offer" ? { ...s, variantId: e.target.value || null } : s))}
                            className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm"
                          >
                            <option value="">{s.autoVariant}</option>
                            {(catalogProducts.find((p) => p.id === section.productId)?.variants ?? []).map((v) => (
                              <option key={v.id} value={v.id}>{Object.values(v.attributes).join(" / ") || s.standardVariant} — {v.sku}</option>
                            ))}
                          </select>
                        </label>
                        <TextField label={s.discountNoteBn} value={section.discountNoteBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "product_offer" ? { ...s, discountNoteBn: v } : s))} />
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={section.showCountdown}
                            onChange={(e) => updateSection(section.id, (s) => (s.type === "product_offer" ? { ...s, showCountdown: e.target.checked } : s))}
                          />
                          {s.showCountdown}
                        </label>
                        {section.showCountdown ? (
                          <TextField label={s.offerEnds} value={section.countdownEndsAt ?? ""} onChange={(v) => updateSection(section.id, (s) => (s.type === "product_offer" ? { ...s, countdownEndsAt: v || null } : s))} placeholder="2026-11-15T23:59:59.000Z" />
                        ) : null}
                      </div>
                    ) : null}

                    {section.type === "quick_order" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <TextField label={s.titleBn} value={section.headingBn ?? ""} onChange={(v) => updateSection(section.id, (s) => (s.type === "quick_order" ? { ...s, headingBn: v } : s))} />
                        <TextField label={s.titleEn} value={section.headingEn ?? ""} onChange={(v) => updateSection(section.id, (s) => (s.type === "quick_order" ? { ...s, headingEn: v } : s))} />
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-muted">{s.productLabel}</span>
                          <select
                            value={section.productId ?? ""}
                            onChange={(e) => updateSection(section.id, (s) => (s.type === "quick_order" ? { ...s, productId: e.target.value, variantId: null } : s))}
                            className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm"
                          >
                            <option value="">{s.chooseProduct}</option>
                            {catalogProducts.map((p) => <option key={p.id} value={p.id}>{p.title[locale]} ({p.id})</option>)}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-muted">{s.defaultVariantLabel}</span>
                          <select
                            value={section.variantId ?? ""}
                            onChange={(e) => updateSection(section.id, (s) => (s.type === "quick_order" ? { ...s, variantId: e.target.value || null } : s))}
                            className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm"
                          >
                            <option value="">{s.autoVariant}</option>
                            {(catalogProducts.find((p) => p.id === section.productId)?.variants ?? []).map((v) => (
                              <option key={v.id} value={v.id}>{Object.values(v.attributes).join(" / ") || s.standardVariant} — {v.sku}</option>
                            ))}
                          </select>
                        </label>
                        <p className="text-xs leading-5 text-text-muted sm:col-span-2">
                          {s.quickOrderNote}
                        </p>
                      </div>
                    ) : null}

                    {section.type === "benefits" ? (
                      <div className="space-y-2">
                        {section.items.map((item, i) => (
                          <div key={i} className="flex gap-2">
                            <input value={item.icon} onChange={(e) => updateSection(section.id, (s) => (s.type === "benefits" ? { ...s, items: s.items.map((it, j) => (j === i ? { ...it, icon: e.target.value } : it)) } : s))} className="h-10 w-16 rounded-[10px] border border-border px-2 text-center" aria-label={s.iconAria} />
                            <input value={item.textBn} onChange={(e) => updateSection(section.id, (s) => (s.type === "benefits" ? { ...s, items: s.items.map((it, j) => (j === i ? { ...it, textBn: e.target.value } : it)) } : s))} className="h-10 flex-1 rounded-[10px] border border-border px-3 text-sm" placeholder={s.benefitPlaceholder} />
                            <Button type="button" size="sm" variant="ghost" onClick={() => updateSection(section.id, (s) => (s.type === "benefits" ? { ...s, items: s.items.filter((_, j) => j !== i) } : s))}>✕</Button>
                          </div>
                        ))}
                        <Button type="button" size="sm" variant="outline" onClick={() => updateSection(section.id, (s) => (s.type === "benefits" ? { ...s, items: [...s.items, { icon: "✅", textBn: "", textEn: "" }] } : s))}>{s.addBenefit}</Button>
                      </div>
                    ) : null}

                    {section.type === "how_to_order" ? (
                      <div className="space-y-2">
                        {section.steps.map((step, i) => (
                          <input key={i} value={step.textBn} onChange={(e) => updateSection(section.id, (s) => (s.type === "how_to_order" ? { ...s, steps: s.steps.map((st, j) => (j === i ? { ...st, textBn: e.target.value } : st)) } : s))} className="h-10 w-full rounded-[10px] border border-border px-3 text-sm" placeholder={interpolate(s.stepPlaceholder, { n: i + 1 })} />
                        ))}
                        <Button type="button" size="sm" variant="outline" onClick={() => updateSection(section.id, (s) => (s.type === "how_to_order" ? { ...s, steps: [...s.steps, { textBn: "", textEn: "" }] } : s))}>{s.addStep}</Button>
                      </div>
                    ) : null}

                    {section.type === "faq" ? (
                      <div className="space-y-3">
                        {section.items.map((item, i) => (
                          <div key={i} className="grid gap-2 sm:grid-cols-2">
                            <TextField label={interpolate(s.questionLabel, { n: i + 1 })} value={item.questionBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "faq" ? { ...s, items: s.items.map((it, j) => (j === i ? { ...it, questionBn: v } : it)) } : s))} />
                            <TextField label={interpolate(s.answerLabel, { n: i + 1 })} value={item.answerBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "faq" ? { ...s, items: s.items.map((it, j) => (j === i ? { ...it, answerBn: v } : it)) } : s))} />
                          </div>
                        ))}
                        <Button type="button" size="sm" variant="outline" onClick={() => updateSection(section.id, (s) => (s.type === "faq" ? { ...s, items: [...s.items, { questionBn: "", questionEn: "", answerBn: "", answerEn: "" }] } : s))}>{s.addQuestion}</Button>
                      </div>
                    ) : null}

                    {section.type === "order_form_note" || section.type === "footer_note" ? (
                      <TextArea label={s.textBn} value={section.textBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "order_form_note" || s.type === "footer_note" ? { ...s, textBn: v } : s))} />
                    ) : null}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>

        <div>
          <Card className="sticky top-4">
            <h2 className="mb-1 font-semibold">{s.livePreview}</h2>
            <p className="mb-3 text-xs text-text-muted">
              {s.previewNote}{" "}
              {selected ? <span className="font-mono">/lp/{selected.slug}</span> : null}
              {selected && selected.status !== "PUBLISHED" ? s.previewDraftSuffix : ""}
            </p>
            <div className="overflow-hidden rounded-xl border border-border">
              {view ? <LandingView view={view} /> : <p className="p-4 text-sm text-text-muted">{s.noPageSelected}</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
