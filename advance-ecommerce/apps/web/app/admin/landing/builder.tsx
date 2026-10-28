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
  LANDING_SECTION_LABELS, LANDING_TRUST_PRESETS, createEmptySection,
  type LandingPage, type LandingProductSource, type LandingSection, type LandingSectionType, type LandingStatus, type TrustPresetKey,
} from "@/landing/types";
import { transitionLandingStatus, validateLandingPage } from "@/landing/validate";
import { buildLandingViewModel, type LandingBlockExtras } from "@/landing/render";
import { LandingView } from "@/landing/components/LandingView";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick, type Locale } from "@/i18n/locale";
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
        className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs outline-none transition focus:border-brand-500"
      />
    </label>
  );
}

function TextArea({ label, value, onChange, rows = 2 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-text-muted">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm shadow-xs outline-none transition focus:border-brand-500"
      />
    </label>
  );
}

/**
 * Client-side collection resolution for the builder (doc 34 L2):
 * manual / category / tag / new_arrivals resolve from the builder's
 * own catalog list, so a not-yet-saved section previews and
 * validates instantly; best_sellers needs sales data the client
 * does not hold, so it is left to the server-resolved extras (saved
 * pages) — the merge in the component prefers the server record
 * per section, exactly like L3's reviews/bundle convention.
 */
function resolveCollectionsClient(page: LandingPage, products: Product[]): Record<string, Product[]> {
  const out: Record<string, Product[]> = {};
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const section of page.sections) {
    if (section.type !== "product_grid" && section.type !== "product_carousel") continue;
    const src = section.source;
    let list: Product[] | null = null;
    switch (src.kind) {
      case "manual":
        list = src.productIds.map((id) => byId.get(id)).filter((p): p is Product => Boolean(p));
        break;
      case "category":
        list = products.filter((p) => p.categorySlug === src.slug);
        break;
      case "tag":
        list = products.filter((p) => p.tags.includes(src.tag));
        break;
      case "new_arrivals":
        list = [...products].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        break;
      case "best_sellers":
        list = null;
        break;
    }
    if (list) out[section.id] = list.slice(0, section.limit);
  }
  return out;
}

/** The shared dynamic-source editor for product_grid /
 *  product_carousel (doc 34 L2): kind picker + per-kind control. */
function SourceEditor({
  source, s, locale, catalogProducts, categories, onChange,
}: {
  source: LandingProductSource;
  s: LandingStrings;
  locale: Locale;
  catalogProducts: Product[];
  categories: { slug: string; name: { bn: string; en: string } }[];
  onChange: (source: LandingProductSource) => void;
}) {
  const [pickId, setPickId] = useState("");
  const kindLabels: Record<LandingProductSource["kind"], string> = {
    manual: s.sourceManual,
    category: s.sourceCategory,
    tag: s.sourceTag,
    best_sellers: s.sourceBest,
    new_arrivals: s.sourceNew,
  };
  function switchKind(kind: LandingProductSource["kind"]) {
    if (kind === source.kind) return;
    switch (kind) {
      case "manual": onChange({ kind: "manual", productIds: [] }); break;
      case "category": onChange({ kind: "category", slug: "" }); break;
      case "tag": onChange({ kind: "tag", tag: "" }); break;
      case "best_sellers": onChange({ kind: "best_sellers" }); break;
      case "new_arrivals": onChange({ kind: "new_arrivals" }); break;
    }
  }
  const selectClass = "h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs";
  return (
    <div className="space-y-2 sm:col-span-2">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-text-muted">{s.sourceLabel}</span>
        <select value={source.kind} onChange={(e) => switchKind(e.target.value as LandingProductSource["kind"])} className={selectClass}>
          {(Object.keys(kindLabels) as LandingProductSource["kind"][]).map((k) => (
            <option key={k} value={k}>{kindLabels[k]}</option>
          ))}
        </select>
      </label>
      {source.kind === "manual" ? (
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <label className="block flex-1">
              <span className="mb-1 block text-xs font-medium text-text-muted">{s.productLabel}</span>
              <select value={pickId} onChange={(e) => setPickId(e.target.value)} className={selectClass}>
                <option value="">{s.chooseProduct}</option>
                {catalogProducts.filter((p) => !source.productIds.includes(p.id)).map((p) => (
                  <option key={p.id} value={p.id}>{p.title[locale]} ({p.id})</option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={!pickId}
              onClick={() => { onChange({ kind: "manual", productIds: [...source.productIds, pickId] }); setPickId(""); }}
            >
              {s.addPickedProduct}
            </Button>
          </div>
          {source.productIds.length === 0 ? (
            <p className="text-xs text-text-muted">{s.pickedEmpty}</p>
          ) : (
            <ul className="space-y-1">
              {source.productIds.map((id) => (
                <li key={id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card px-3 py-1.5 text-sm">
                  <span>
                    {catalogProducts.find((p) => p.id === id)?.title[locale] ?? id}{" "}
                    <span className="font-mono text-xs text-text-muted">({id})</span>
                  </span>
                  <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ kind: "manual", productIds: source.productIds.filter((x) => x !== id) })}>✕</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
      {source.kind === "category" ? (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">{s.sourceCategory}</span>
          <select value={source.slug} onChange={(e) => onChange({ kind: "category", slug: e.target.value })} className={selectClass}>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name[locale]} ({c.slug})</option>
            ))}
          </select>
        </label>
      ) : null}
      {source.kind === "tag" ? (
        <TextField label={s.sourceTag} value={source.tag} onChange={(v) => onChange({ kind: "tag", tag: v })} placeholder={s.tagPlaceholder} />
      ) : null}
      {source.kind === "best_sellers" || source.kind === "new_arrivals" ? (
        <p className="text-xs leading-5 text-text-muted">{s.sourceAutoHint}</p>
      ) : null}
    </div>
  );
}

export default function LandingBuilder({
  catalogProducts,
  initialPages,
  initialExtras,
  categories = [],
}: {
  catalogProducts: Product[];
  initialPages: LandingPage[];
  /** L3 block extras (reviews/bundle data) resolved server-side per
   *  saved page — feeds the preview so those blocks render with the
   *  same data as the public page. */
  initialExtras?: Record<string, LandingBlockExtras>;
  /** Catalog categories for the product_grid / product_carousel
   *  category-source picker (doc 34 L2). */
  categories?: { slug: string; name: { bn: string; en: string } }[];
}) {
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
  // L2 collections: client-side fill (instant for unsaved sections)
  // merged UNDER the server-resolved extras — the server record wins
  // per section (it carries best-sellers and the live gate).
  const clientCollections = useMemo(
    () => (selected ? resolveCollectionsClient(selected, catalogProducts) : {}),
    [selected, catalogProducts],
  );
  const mergedCollections = useMemo(
    () => ({ ...clientCollections, ...(selected ? initialExtras?.[selected.id]?.collections ?? {} : {}) }),
    [clientCollections, selected, initialExtras],
  );
  const validation = useMemo(
    () => (selected ? validateLandingPage(selected, catalogProducts, otherSlugs, mergedCollections) : null),
    [selected, otherSlugs, catalogProducts, mergedCollections],
  );
  const view = useMemo(
    () =>
      selected
        ? buildLandingViewModel(selected, catalogProducts, { ...(initialExtras?.[selected.id] ?? {}), collections: mergedCollections })
        : null,
    [selected, catalogProducts, initialExtras, mergedCollections],
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
    const result = transitionLandingStatus(selected, to, catalogProducts, otherSlugs, mergedCollections);
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
        {dirty ? <span className="text-xs font-medium text-warning-solid">{s.unsavedChanges}</span> : null}
      </div>
      {notice ? <p role="status" className="rounded-xl bg-surface-2 px-4 py-3 text-sm">{notice}</p> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-display text-base font-semibold text-text-main">{s.pagesListTitle}</h2>
            <ul className="space-y-2">
              {pages.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left text-sm shadow-xs transition ${p.id === selectedId ? "border-brand-500 bg-brand-soft" : "border-border bg-card hover:bg-surface-2"}`}
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
              <h2 className="mb-3 font-display text-base font-semibold text-text-main">{s.pageSettings}</h2>
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
                <div className="mt-4 rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-danger">
                  <p className="font-medium">{interpolate(s.validationProblems, { count: validation.errors.length })}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {validation.errors.map((e, i) => <li key={i}>{e.messageBn}</li>)}
                  </ul>
                </div>
              ) : (
                <p className="mt-4 rounded-xl bg-success-soft p-4 text-sm text-success-solid">{s.validationOk}</p>
              )}
            </Card>
          ) : null}

          {selected ? (
            <Card>
              <h2 className="mb-3 font-display text-base font-semibold text-text-main">{s.sectionsTitle}</h2>
              <div className="mb-4 flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-text-muted">{s.paletteLabel}</span>
                  <select
                    value={paletteType}
                    onChange={(e) => setPaletteType(e.target.value as LandingSectionType)}
                    className="h-11 rounded-xl border border-border bg-card px-3 text-sm shadow-xs"
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
                  <div key={section.id} className="rounded-2xl border border-border/60 bg-surface-2/40 p-4">
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
                        <div className="sm:col-span-2">
                          <TextField
                            label={s.heroImageUrl}
                            value={section.imageUrl ?? ""}
                            onChange={(v) => updateSection(section.id, (s) => (s.type === "hero" ? { ...s, imageUrl: v.trim() ? v.trim() : null } : s))}
                            placeholder="https://…"
                          />
                          <p className="mt-1 text-xs leading-5 text-text-muted">{s.heroImageHint}</p>
                        </div>
                      </div>
                    ) : null}

                    {section.type === "product_offer" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-muted">{s.productLabel}</span>
                          <select
                            value={section.productId}
                            onChange={(e) => updateSection(section.id, (s) => (s.type === "product_offer" ? { ...s, productId: e.target.value, variantId: null } : s))}
                            className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs"
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
                            className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs"
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
                            className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs"
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
                            className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs"
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
                            <input value={item.icon} onChange={(e) => updateSection(section.id, (s) => (s.type === "benefits" ? { ...s, items: s.items.map((it, j) => (j === i ? { ...it, icon: e.target.value } : it)) } : s))} className="h-11 w-16 rounded-xl border border-border bg-card px-2 text-center shadow-xs" aria-label={s.iconAria} />
                            <input value={item.textBn} onChange={(e) => updateSection(section.id, (s) => (s.type === "benefits" ? { ...s, items: s.items.map((it, j) => (j === i ? { ...it, textBn: e.target.value } : it)) } : s))} className="h-11 flex-1 rounded-xl border border-border bg-card px-3 text-sm shadow-xs" placeholder={s.benefitPlaceholder} />
                            <Button type="button" size="sm" variant="ghost" onClick={() => updateSection(section.id, (s) => (s.type === "benefits" ? { ...s, items: s.items.filter((_, j) => j !== i) } : s))}>✕</Button>
                          </div>
                        ))}
                        <Button type="button" size="sm" variant="outline" onClick={() => updateSection(section.id, (s) => (s.type === "benefits" ? { ...s, items: [...s.items, { icon: "✅", textBn: "", textEn: "" }] } : s))}>{s.addBenefit}</Button>
                      </div>
                    ) : null}

                    {section.type === "how_to_order" ? (
                      <div className="space-y-2">
                        {section.steps.map((step, i) => (
                          <input key={i} value={step.textBn} onChange={(e) => updateSection(section.id, (s) => (s.type === "how_to_order" ? { ...s, steps: s.steps.map((st, j) => (j === i ? { ...st, textBn: e.target.value } : st)) } : s))} className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs" placeholder={interpolate(s.stepPlaceholder, { n: i + 1 })} />
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

                    {section.type === "reviews" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex items-center gap-2 text-sm sm:col-span-2">
                          <input
                            type="checkbox"
                            checked={section.usePrimaryOffer}
                            onChange={(e) => updateSection(section.id, (s) => (s.type === "reviews" ? { ...s, usePrimaryOffer: e.target.checked } : s))}
                          />
                          {s.usePrimaryOffer}
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-muted">{s.productLabel}</span>
                          <select
                            value={section.productId}
                            disabled={section.usePrimaryOffer}
                            onChange={(e) => updateSection(section.id, (s) => (s.type === "reviews" ? { ...s, productId: e.target.value } : s))}
                            className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs disabled:opacity-50"
                          >
                            <option value="">{s.chooseProduct}</option>
                            {catalogProducts.map((p) => <option key={p.id} value={p.id}>{p.title[locale]} ({p.id})</option>)}
                          </select>
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="mb-1 block text-xs font-medium text-text-muted">{s.limitLabel}</span>
                            <input
                              type="number"
                              min={1}
                              max={20}
                              value={section.limit}
                              onChange={(e) => updateSection(section.id, (s) => (s.type === "reviews" ? { ...s, limit: Math.min(20, Math.max(1, Number(e.target.value) || 1)) } : s))}
                              className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs outline-none transition focus:border-brand-500"
                            />
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-medium text-text-muted">{s.minRatingLabel}</span>
                            <select
                              value={section.minRating}
                              onChange={(e) => updateSection(section.id, (s) => (s.type === "reviews" ? { ...s, minRating: Number(e.target.value) } : s))}
                              className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs"
                            >
                              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}★+</option>)}
                            </select>
                          </label>
                        </div>
                        <p className="text-xs leading-5 text-text-muted sm:col-span-2">{s.reviewsNote}</p>
                      </div>
                    ) : null}

                    {section.type === "gallery" ? (
                      <div className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <TextField label={s.headingBn} value={section.headingBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "gallery" ? { ...s, headingBn: v } : s))} />
                          <TextField label={s.headingEn} value={section.headingEn} onChange={(v) => updateSection(section.id, (s) => (s.type === "gallery" ? { ...s, headingEn: v } : s))} />
                          <label className="block">
                            <span className="mb-1 block text-xs font-medium text-text-muted">{s.layoutLabel}</span>
                            <select
                              value={section.layout}
                              onChange={(e) => updateSection(section.id, (s) => (s.type === "gallery" ? { ...s, layout: e.target.value as "grid" | "carousel" } : s))}
                              className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs"
                            >
                              <option value="grid">{s.layoutGrid}</option>
                              <option value="carousel">{s.layoutCarousel}</option>
                            </select>
                          </label>
                        </div>
                        {section.images.map((img, i) => (
                          <div key={i} className="grid gap-2 rounded-xl border border-border/60 bg-card p-3 sm:grid-cols-[1fr_1fr_auto]">
                            <TextField label={s.imageUrlLabel} value={img.url} onChange={(v) => updateSection(section.id, (s) => (s.type === "gallery" ? { ...s, images: s.images.map((it, j) => (j === i ? { ...it, url: v } : it)) } : s))} placeholder="https://…" />
                            <TextField label={s.altBnLabel} value={img.altBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "gallery" ? { ...s, images: s.images.map((it, j) => (j === i ? { ...it, altBn: v } : it)) } : s))} />
                            <div className="flex items-end gap-2">
                              <TextField label={s.altEnLabel} value={img.altEn} onChange={(v) => updateSection(section.id, (s) => (s.type === "gallery" ? { ...s, images: s.images.map((it, j) => (j === i ? { ...it, altEn: v } : it)) } : s))} />
                              <Button type="button" size="sm" variant="ghost" onClick={() => updateSection(section.id, (s) => (s.type === "gallery" ? { ...s, images: s.images.filter((_, j) => j !== i) } : s))}>✕</Button>
                            </div>
                          </div>
                        ))}
                        <Button type="button" size="sm" variant="outline" onClick={() => updateSection(section.id, (s) => (s.type === "gallery" ? { ...s, images: [...s.images, { url: "", altBn: "", altEn: "" }] } : s))}>{s.addImage}</Button>
                      </div>
                    ) : null}

                    {section.type === "image_banner" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <TextField label={s.headingBn} value={section.headingBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "image_banner" ? { ...s, headingBn: v } : s))} />
                        <TextField label={s.headingEn} value={section.headingEn} onChange={(v) => updateSection(section.id, (s) => (s.type === "image_banner" ? { ...s, headingEn: v } : s))} />
                        <div className="sm:col-span-2">
                          <TextField label={s.imageUrlLabel} value={section.imageUrl} onChange={(v) => updateSection(section.id, (s) => (s.type === "image_banner" ? { ...s, imageUrl: v } : s))} placeholder="https://…" />
                        </div>
                        <TextField label={s.altBnLabel} value={section.altBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "image_banner" ? { ...s, altBn: v } : s))} />
                        <TextField label={s.altEnLabel} value={section.altEn} onChange={(v) => updateSection(section.id, (s) => (s.type === "image_banner" ? { ...s, altEn: v } : s))} />
                        <div className="sm:col-span-2">
                          <TextField label={s.linkUrlLabel} value={section.linkUrl ?? ""} onChange={(v) => updateSection(section.id, (s) => (s.type === "image_banner" ? { ...s, linkUrl: v.trim() ? v.trim() : null } : s))} placeholder="https://… বা /shop" />
                        </div>
                      </div>
                    ) : null}

                    {section.type === "video" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <TextField label={s.headingBn} value={section.headingBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "video" ? { ...s, headingBn: v } : s))} />
                        <TextField label={s.headingEn} value={section.headingEn} onChange={(v) => updateSection(section.id, (s) => (s.type === "video" ? { ...s, headingEn: v } : s))} />
                        <div className="sm:col-span-2">
                          <TextField label={s.videoIdLabel} value={section.videoId} onChange={(v) => updateSection(section.id, (s) => (s.type === "video" ? { ...s, videoId: v.trim() } : s))} placeholder="dQw4w9WgXcQ" />
                          <p className="mt-1 text-xs leading-5 text-text-muted">{s.videoIdHint}</p>
                        </div>
                      </div>
                    ) : null}

                    {section.type === "rich_text" ? (
                      <div className="space-y-3">
                        <TextArea label={s.bodyBnLabel} value={section.bodyBn} rows={6} onChange={(v) => updateSection(section.id, (s) => (s.type === "rich_text" ? { ...s, bodyBn: v } : s))} />
                        <TextArea label={s.bodyEnLabel} value={section.bodyEn} rows={6} onChange={(v) => updateSection(section.id, (s) => (s.type === "rich_text" ? { ...s, bodyEn: v } : s))} />
                        <p className="text-xs leading-5 text-text-muted">{s.richTextHint}</p>
                      </div>
                    ) : null}

                    {section.type === "bundle_offer" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-muted">{s.productLabel}</span>
                          <select
                            value={section.productId}
                            onChange={(e) => updateSection(section.id, (s) => (s.type === "bundle_offer" ? { ...s, productId: e.target.value, variantId: null } : s))}
                            className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs"
                          >
                            <option value="">{s.chooseProduct}</option>
                            {catalogProducts.map((p) => <option key={p.id} value={p.id}>{p.title[locale]} ({p.id})</option>)}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-muted">{s.variantLabel}</span>
                          <select
                            value={section.variantId ?? ""}
                            onChange={(e) => updateSection(section.id, (s) => (s.type === "bundle_offer" ? { ...s, variantId: e.target.value || null } : s))}
                            className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs"
                          >
                            <option value="">{s.autoVariant}</option>
                            {(catalogProducts.find((p) => p.id === section.productId)?.variants ?? []).map((v) => (
                              <option key={v.id} value={v.id}>{Object.values(v.attributes).join(" / ") || s.standardVariant} — {v.sku}</option>
                            ))}
                          </select>
                        </label>
                        <TextField label={s.headingBn} value={section.headingBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "bundle_offer" ? { ...s, headingBn: v } : s))} />
                        <TextField label={s.headingEn} value={section.headingEn} onChange={(v) => updateSection(section.id, (s) => (s.type === "bundle_offer" ? { ...s, headingEn: v } : s))} />
                        <label className="flex items-center gap-2 text-sm sm:col-span-2">
                          <input
                            type="checkbox"
                            checked={section.ctaToOrderForm}
                            onChange={(e) => updateSection(section.id, (s) => (s.type === "bundle_offer" ? { ...s, ctaToOrderForm: e.target.checked } : s))}
                          />
                          {s.ctaToOrderFormLabel}
                        </label>
                        <p className="text-xs leading-5 text-text-muted sm:col-span-2">{s.bundleNote}</p>
                      </div>
                    ) : null}

                    {section.type === "product_grid" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <TextField label={s.headingBn} value={section.headingBn} onChange={(v) => updateSection(section.id, (sec) => (sec.type === "product_grid" ? { ...sec, headingBn: v } : sec))} />
                        <TextField label={s.headingEn} value={section.headingEn} onChange={(v) => updateSection(section.id, (sec) => (sec.type === "product_grid" ? { ...sec, headingEn: v } : sec))} />
                        <SourceEditor source={section.source} s={s} locale={locale} catalogProducts={catalogProducts} categories={categories} onChange={(source) => updateSection(section.id, (sec) => (sec.type === "product_grid" ? { ...sec, source } : sec))} />
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-muted">{s.limitLabel}</span>
                          <input
                            type="number"
                            min={4}
                            max={24}
                            value={section.limit}
                            onChange={(e) => updateSection(section.id, (sec) => (sec.type === "product_grid" ? { ...sec, limit: Math.min(24, Math.max(4, Number(e.target.value) || 4)) } : sec))}
                            className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs outline-none transition focus:border-brand-500"
                          />
                        </label>
                        <div className="grid grid-cols-2 gap-3">
                          <label className="block">
                            <span className="mb-1 block text-xs font-medium text-text-muted">{s.columnsMobileLabel}</span>
                            <select
                              value={section.columnsMobile}
                              onChange={(e) => updateSection(section.id, (sec) => (sec.type === "product_grid" ? { ...sec, columnsMobile: Number(e.target.value) as 1 | 2 } : sec))}
                              className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs"
                            >
                              {[1, 2].map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                          </label>
                          <label className="block">
                            <span className="mb-1 block text-xs font-medium text-text-muted">{s.columnsDesktopLabel}</span>
                            <select
                              value={section.columnsDesktop}
                              onChange={(e) => updateSection(section.id, (sec) => (sec.type === "product_grid" ? { ...sec, columnsDesktop: Number(e.target.value) as 2 | 3 | 4 } : sec))}
                              className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs"
                            >
                              {[2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                          </label>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={section.showPrice}
                            onChange={(e) => updateSection(section.id, (sec) => (sec.type === "product_grid" ? { ...sec, showPrice: e.target.checked } : sec))}
                          />
                          {s.showPriceLabel}
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={section.showAddButton}
                            onChange={(e) => updateSection(section.id, (sec) => (sec.type === "product_grid" ? { ...sec, showAddButton: e.target.checked } : sec))}
                          />
                          {s.showAddButtonLabel}
                        </label>
                      </div>
                    ) : null}

                    {section.type === "product_carousel" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <TextField label={s.headingBn} value={section.headingBn} onChange={(v) => updateSection(section.id, (sec) => (sec.type === "product_carousel" ? { ...sec, headingBn: v } : sec))} />
                        <TextField label={s.headingEn} value={section.headingEn} onChange={(v) => updateSection(section.id, (sec) => (sec.type === "product_carousel" ? { ...sec, headingEn: v } : sec))} />
                        <SourceEditor source={section.source} s={s} locale={locale} catalogProducts={catalogProducts} categories={categories} onChange={(source) => updateSection(section.id, (sec) => (sec.type === "product_carousel" ? { ...sec, source } : sec))} />
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-muted">{s.limitLabel}</span>
                          <input
                            type="number"
                            min={4}
                            max={24}
                            value={section.limit}
                            onChange={(e) => updateSection(section.id, (sec) => (sec.type === "product_carousel" ? { ...sec, limit: Math.min(24, Math.max(4, Number(e.target.value) || 4)) } : sec))}
                            className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs outline-none transition focus:border-brand-500"
                          />
                        </label>
                        <div className="flex flex-col gap-2">
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={section.autoplay}
                              onChange={(e) => updateSection(section.id, (sec) => (sec.type === "product_carousel" ? { ...sec, autoplay: e.target.checked } : sec))}
                            />
                            {s.autoplayLabel}
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={section.showPrice}
                              onChange={(e) => updateSection(section.id, (sec) => (sec.type === "product_carousel" ? { ...sec, showPrice: e.target.checked } : sec))}
                            />
                            {s.showPriceLabel}
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={section.showAddButton}
                              onChange={(e) => updateSection(section.id, (sec) => (sec.type === "product_carousel" ? { ...sec, showAddButton: e.target.checked } : sec))}
                            />
                            {s.showAddButtonLabel}
                          </label>
                        </div>
                      </div>
                    ) : null}

                    {section.type === "countdown" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <TextField label={s.headingBn} value={section.headingBn} onChange={(v) => updateSection(section.id, (sec) => (sec.type === "countdown" ? { ...sec, headingBn: v } : sec))} />
                        <TextField label={s.headingEn} value={section.headingEn} onChange={(v) => updateSection(section.id, (sec) => (sec.type === "countdown" ? { ...sec, headingEn: v } : sec))} />
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-muted">{s.countdownTargetLabel}</span>
                          <select
                            value={section.target.kind}
                            onChange={(e) =>
                              updateSection(section.id, (sec) =>
                                sec.type === "countdown"
                                  ? {
                                      ...sec,
                                      target:
                                        e.target.value === "flash_sale"
                                          ? { kind: "flash_sale" as const }
                                          : { kind: "datetime" as const, endsAt: sec.target.kind === "datetime" ? sec.target.endsAt : "" },
                                    }
                                  : sec,
                              )
                            }
                            className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs"
                          >
                            <option value="datetime">{s.targetDateTime}</option>
                            <option value="flash_sale">{s.targetFlashSale}</option>
                          </select>
                        </label>
                        {section.target.kind === "datetime" ? (
                          <TextField
                            label={s.offerEnds}
                            value={section.target.endsAt}
                            onChange={(v) => updateSection(section.id, (sec) => (sec.type === "countdown" && sec.target.kind === "datetime" ? { ...sec, target: { kind: "datetime", endsAt: v } } : sec))}
                            placeholder="2026-11-15T23:59:59.000Z"
                          />
                        ) : null}
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-muted">{s.expiredBehaviorLabel}</span>
                          <select
                            value={section.expiredBehavior}
                            onChange={(e) => updateSection(section.id, (sec) => (sec.type === "countdown" ? { ...sec, expiredBehavior: e.target.value as "hide" | "show_text" } : sec))}
                            className="h-11 w-full rounded-xl border border-border bg-card px-3 text-sm shadow-xs"
                          >
                            <option value="hide">{s.expiredHide}</option>
                            <option value="show_text">{s.expiredShowText}</option>
                          </select>
                        </label>
                        {section.expiredBehavior === "show_text" ? (
                          <>
                            <TextField label={s.expiredTextBn} value={section.expiredTextBn} onChange={(v) => updateSection(section.id, (sec) => (sec.type === "countdown" ? { ...sec, expiredTextBn: v } : sec))} />
                            <TextField label={s.expiredTextEn} value={section.expiredTextEn} onChange={(v) => updateSection(section.id, (sec) => (sec.type === "countdown" ? { ...sec, expiredTextEn: v } : sec))} />
                          </>
                        ) : null}
                      </div>
                    ) : null}

                    {section.type === "trust_strip" ? (
                      <div className="space-y-2">
                        {section.items.map((item, i) => (
                          <div key={i} className="flex flex-wrap gap-2">
                            <label className="block">
                              <span className="sr-only">{s.trustPresetLabel}</span>
                              <select
                                value={item.preset}
                                onChange={(e) => {
                                  const preset = e.target.value as TrustPresetKey | "custom";
                                  updateSection(section.id, (sec) =>
                                    sec.type === "trust_strip"
                                      ? {
                                          ...sec,
                                          items: sec.items.map((it, j) => {
                                            if (j !== i) return it;
                                            if (preset === "custom") return { ...it, preset: "custom" as const };
                                            const p = LANDING_TRUST_PRESETS[preset];
                                            return { preset, icon: p.icon, textBn: p.textBn, textEn: p.textEn };
                                          }),
                                        }
                                      : sec,
                                  );
                                }}
                                className="h-11 rounded-xl border border-border bg-card px-2 text-sm shadow-xs"
                              >
                                <option value="custom">{s.trustCustom}</option>
                                {(Object.keys(LANDING_TRUST_PRESETS) as TrustPresetKey[]).map((k) => (
                                  <option key={k} value={k}>{locale === "en" ? LANDING_TRUST_PRESETS[k].textEn : LANDING_TRUST_PRESETS[k].textBn}</option>
                                ))}
                              </select>
                            </label>
                            <input value={item.icon} onChange={(e) => updateSection(section.id, (sec) => (sec.type === "trust_strip" ? { ...sec, items: sec.items.map((it, j) => (j === i ? { ...it, icon: e.target.value } : it)) } : sec))} className="h-11 w-16 rounded-xl border border-border bg-card px-2 text-center shadow-xs" aria-label={s.iconAria} />
                            <input value={item.textBn} onChange={(e) => updateSection(section.id, (sec) => (sec.type === "trust_strip" ? { ...sec, items: sec.items.map((it, j) => (j === i ? { ...it, textBn: e.target.value } : it)) } : sec))} className="h-11 min-w-40 flex-1 rounded-xl border border-border bg-card px-3 text-sm shadow-xs" placeholder={s.trustTextBnPlaceholder} />
                            <input value={item.textEn} onChange={(e) => updateSection(section.id, (sec) => (sec.type === "trust_strip" ? { ...sec, items: sec.items.map((it, j) => (j === i ? { ...it, textEn: e.target.value } : it)) } : sec))} className="h-11 min-w-40 flex-1 rounded-xl border border-border bg-card px-3 text-sm shadow-xs" placeholder={s.trustTextEnPlaceholder} />
                            <Button type="button" size="sm" variant="ghost" onClick={() => updateSection(section.id, (sec) => (sec.type === "trust_strip" ? { ...sec, items: sec.items.filter((_, j) => j !== i) } : sec))}>✕</Button>
                          </div>
                        ))}
                        <Button type="button" size="sm" variant="outline" onClick={() => updateSection(section.id, (sec) => (sec.type === "trust_strip" ? { ...sec, items: [...sec.items, { preset: "custom" as const, icon: "✅", textBn: "", textEn: "" }] } : sec))}>{s.addTrustItem}</Button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>

        <div>
          <Card className="sticky top-4">
            <h2 className="mb-1 font-display text-base font-semibold text-text-main">{s.livePreview}</h2>
            <p className="mb-3 text-xs text-text-muted">
              {s.previewNote}{" "}
              {selected ? <span className="font-mono">/lp/{selected.slug}</span> : null}
              {selected && selected.status !== "PUBLISHED" ? s.previewDraftSuffix : ""}
            </p>
            <div className="overflow-hidden rounded-2xl border border-border/60 shadow-xs">
              {view ? <LandingView view={view} locale={locale} /> : <p className="p-4 text-sm text-text-muted">{s.noPageSelected}</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
