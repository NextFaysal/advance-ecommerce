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

const SECTION_TYPES = Object.keys(LANDING_SECTION_LABELS) as LandingSectionType[];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function statusBadge(status: LandingStatus) {
  if (status === "PUBLISHED") return <Badge tone="success">প্রকাশিত</Badge>;
  if (status === "ARCHIVED") return <Badge tone="info">আর্কাইভ</Badge>;
  return <Badge tone="warning">খসড়া</Badge>;
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
    const details = Array.isArray(json?.error?.details) ? ` (${json.error.details.length}টি সমস্যা)` : "";
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
        setNotice(`⚠ সংরক্ষণ ব্যর্থ: ${await apiErrorMessage(res)}`);
        return;
      }
      const json = (await res.json()) as { data: { page: LandingPage } };
      setPages((prev) => prev.map((p) => (p.id === selected.id ? json.data.page : p)));
      setSelectedId(json.data.page.id);
      setDirty(false);
      setNotice("✓ ডাটাবেসে সংরক্ষিত হয়েছে।");
    } catch {
      setNotice("⚠ সংরক্ষণ ব্যর্থ — নেটওয়ার্ক সমস্যা, আবার চেষ্টা করুন।");
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
    setNotice("নতুন খসড়া ল্যান্ডিং পেজ তৈরি হয়েছে — 'সংরক্ষণ করুন' চাপলে ডাটাবেসে সেভ হবে।");
  }

  async function changeStatus(to: LandingStatus) {
    if (!selected || saving) return;
    if (selected.id.startsWith("lp_local_")) {
      setNotice("⚠ এই পেজটি এখনো ডাটাবেসে সেভ হয়নি — আগে 'সংরক্ষণ করুন' চাপুন, তারপর অবস্থা বদলান।");
      return;
    }
    // Local transition check first (instant feedback, same rules the
    // API applies); the PATCH below is what actually persists.
    const result = transitionLandingStatus(selected, to, catalogProducts, otherSlugs);
    if (!result.ok) {
      setNotice(`⚠ ${result.messageBn}${result.validation ? ` (${result.validation.errors.length}টি সমস্যা নিচে দেখুন)` : ""}`);
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
        setNotice(`⚠ অবস্থা বদল ব্যর্থ: ${await apiErrorMessage(res)}`);
        return;
      }
      const json = (await res.json()) as { data: { page: LandingPage } };
      setPages((prev) => prev.map((p) => (p.id === selectedId ? json.data.page : p)));
      setNotice(to === "PUBLISHED" ? "প্রকাশ হয়েছে — পাবলিক URL: /lp/" + json.data.page.slug : "অবস্থা বদল হয়েছে (ডাটাবেসে সংরক্ষিত)।");
    } catch {
      setNotice("⚠ অবস্থা বদল ব্যর্থ — নেটওয়ার্ক সমস্যা, আবার চেষ্টা করুন।");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={createDraft}>+ নতুন ল্যান্ডিং পেজ</Button>
        <Button type="button" variant="secondary" onClick={saveSelected} disabled={!selected || saving}>
          {saving ? "সংরক্ষণ হচ্ছে…" : "সংরক্ষণ করুন"}
        </Button>
        {dirty ? <span className="text-xs font-medium text-amber-600">অসংরক্ষিত পরিবর্তন আছে</span> : null}
      </div>
      {notice ? <p role="status" className="rounded-lg bg-surface-2 px-4 py-2 text-sm">{notice}</p> : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-semibold">ল্যান্ডিং পেজসমূহ (ডাটাবেস)</h2>
            <ul className="space-y-2">
              {pages.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(p.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm ${p.id === selectedId ? "border-brand-500 bg-brand-50" : "border-border bg-card"}`}
                  >
                    <span>
                      <span className="font-medium">{p.titleBn}</span>
                      <span className="block font-mono text-xs text-text-muted">
                        /lp/{p.slug} · {p.sections.length} সেকশন{p.id.startsWith("lp_local_") ? " · অসংরক্ষিত (লোকাল)" : ""}
                      </span>
                    </span>
                    {statusBadge(p.status)}
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {selected ? (
            <Card>
              <h2 className="mb-3 font-semibold">পেজ সেটিংস</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="শিরোনাম (বাংলা)" value={selected.titleBn} onChange={(v) => updateSelected((p) => ({ ...p, titleBn: v }))} />
                <TextField label="শিরোনাম (ইংরেজি)" value={selected.titleEn} onChange={(v) => updateSelected((p) => ({ ...p, titleEn: v }))} />
                <TextField label="স্লাগ (kebab-case) — /lp/<slug>" value={selected.slug} onChange={(v) => updateSelected((p) => ({ ...p, slug: v }))} />
                <div>
                  <span className="mb-1 block text-xs font-medium text-text-muted">অবস্থা</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {statusBadge(selected.status)}
                    {selected.status !== "PUBLISHED" ? (
                      <Button type="button" size="sm" onClick={() => changeStatus("PUBLISHED")}>প্রকাশ করুন</Button>
                    ) : (
                      <>
                        <Button type="button" size="sm" variant="outline" onClick={() => changeStatus("DRAFT")}>খসড়ায় ফেরত</Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => changeStatus("ARCHIVED")}>আর্কাইভ</Button>
                      </>
                    )}
                    {selected.status === "ARCHIVED" ? (
                      <Button type="button" size="sm" onClick={() => changeStatus("DRAFT")}>খসড়া হিসেবে ফেরত আনুন</Button>
                    ) : null}
                  </div>
                </div>
              </div>

              {validation && !validation.ok ? (
                <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                  <p className="font-medium">যাচাইয়ে সমস্যা ({validation.errors.length}টি):</p>
                  <ul className="mt-1 list-disc pl-5">
                    {validation.errors.map((e, i) => <li key={i}>{e.messageBn}</li>)}
                  </ul>
                </div>
              ) : (
                <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">✓ যাচাই ঠিক আছে — প্রকাশের জন্য প্রস্তুত।</p>
              )}
            </Card>
          ) : null}

          {selected ? (
            <Card>
              <h2 className="mb-3 font-semibold">সেকশনসমূহ</h2>
              <div className="mb-4 flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-text-muted">ব্লক প্যালেট</span>
                  <select
                    value={paletteType}
                    onChange={(e) => setPaletteType(e.target.value as LandingSectionType)}
                    className="h-10 rounded-[10px] border border-border bg-card px-3 text-sm"
                  >
                    {SECTION_TYPES.map((t) => <option key={t} value={t}>{LANDING_SECTION_LABELS[t].bn} ({LANDING_SECTION_LABELS[t].en})</option>)}
                  </select>
                </label>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => updateSelected((p) => ({ ...p, sections: [...p.sections, createEmptySection(paletteType)] }))}
                >
                  + সেকশন যোগ করুন
                </Button>
              </div>

              <div className="space-y-4">
                {selected.sections.map((section, index) => (
                  <div key={section.id} className="rounded-lg border border-border p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{index + 1}. {LANDING_SECTION_LABELS[section.type].bn}</span>
                      <span className="flex gap-1">
                        <Button type="button" size="sm" variant="ghost" onClick={() => moveSection(index, -1)}>↑</Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => moveSection(index, 1)}>↓</Button>
                        <Button type="button" size="sm" variant="destructive" onClick={() => updateSelected((p) => ({ ...p, sections: p.sections.filter((s) => s.id !== section.id) }))}>মুছুন</Button>
                      </span>
                    </div>

                    {section.type === "hero" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <TextField label="শিরোনাম (বাংলা)" value={section.titleBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "hero" ? { ...s, titleBn: v } : s))} />
                        <TextField label="শিরোনাম (ইংরেজি)" value={section.titleEn} onChange={(v) => updateSection(section.id, (s) => (s.type === "hero" ? { ...s, titleEn: v } : s))} />
                        <TextArea label="উপ-শিরোনাম (বাংলা)" value={section.subtitleBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "hero" ? { ...s, subtitleBn: v } : s))} />
                        <TextField label="বোতামের লেখা (বাংলা)" value={section.ctaLabelBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "hero" ? { ...s, ctaLabelBn: v } : s))} />
                      </div>
                    ) : null}

                    {section.type === "product_offer" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-muted">পণ্য (আসল ক্যাটালগ — ডাটাবেস)</span>
                          <select
                            value={section.productId}
                            onChange={(e) => updateSection(section.id, (s) => (s.type === "product_offer" ? { ...s, productId: e.target.value, variantId: null } : s))}
                            className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm"
                          >
                            <option value="">— পণ্য বেছে নিন —</option>
                            {catalogProducts.map((p) => <option key={p.id} value={p.id}>{p.title.bn} ({p.id})</option>)}
                          </select>
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-muted">ভেরিয়েন্ট</span>
                          <select
                            value={section.variantId ?? ""}
                            onChange={(e) => updateSection(section.id, (s) => (s.type === "product_offer" ? { ...s, variantId: e.target.value || null } : s))}
                            className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm"
                          >
                            <option value="">প্রথম স্টক-থাকা ভেরিয়েন্ট (অটো)</option>
                            {(catalogProducts.find((p) => p.id === section.productId)?.variants ?? []).map((v) => (
                              <option key={v.id} value={v.id}>{Object.values(v.attributes).join(" / ") || "স্ট্যান্ডার্ড"} — {v.sku}</option>
                            ))}
                          </select>
                        </label>
                        <TextField label="ছাড়ের নোট (বাংলা)" value={section.discountNoteBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "product_offer" ? { ...s, discountNoteBn: v } : s))} />
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={section.showCountdown}
                            onChange={(e) => updateSection(section.id, (s) => (s.type === "product_offer" ? { ...s, showCountdown: e.target.checked } : s))}
                          />
                          কাউন্টডাউন দেখান
                        </label>
                        {section.showCountdown ? (
                          <TextField label="অফার শেষ (তারিখ-সময়)" value={section.countdownEndsAt ?? ""} onChange={(v) => updateSection(section.id, (s) => (s.type === "product_offer" ? { ...s, countdownEndsAt: v || null } : s))} placeholder="2026-11-15T23:59:59.000Z" />
                        ) : null}
                      </div>
                    ) : null}

                    {section.type === "benefits" ? (
                      <div className="space-y-2">
                        {section.items.map((item, i) => (
                          <div key={i} className="flex gap-2">
                            <input value={item.icon} onChange={(e) => updateSection(section.id, (s) => (s.type === "benefits" ? { ...s, items: s.items.map((it, j) => (j === i ? { ...it, icon: e.target.value } : it)) } : s))} className="h-10 w-16 rounded-[10px] border border-border px-2 text-center" aria-label="আইকন" />
                            <input value={item.textBn} onChange={(e) => updateSection(section.id, (s) => (s.type === "benefits" ? { ...s, items: s.items.map((it, j) => (j === i ? { ...it, textBn: e.target.value } : it)) } : s))} className="h-10 flex-1 rounded-[10px] border border-border px-3 text-sm" placeholder="সুবিধার লেখা (বাংলা)" />
                            <Button type="button" size="sm" variant="ghost" onClick={() => updateSection(section.id, (s) => (s.type === "benefits" ? { ...s, items: s.items.filter((_, j) => j !== i) } : s))}>✕</Button>
                          </div>
                        ))}
                        <Button type="button" size="sm" variant="outline" onClick={() => updateSection(section.id, (s) => (s.type === "benefits" ? { ...s, items: [...s.items, { icon: "✅", textBn: "", textEn: "" }] } : s))}>+ সুবিধা</Button>
                      </div>
                    ) : null}

                    {section.type === "how_to_order" ? (
                      <div className="space-y-2">
                        {section.steps.map((step, i) => (
                          <input key={i} value={step.textBn} onChange={(e) => updateSection(section.id, (s) => (s.type === "how_to_order" ? { ...s, steps: s.steps.map((st, j) => (j === i ? { ...st, textBn: e.target.value } : st)) } : s))} className="h-10 w-full rounded-[10px] border border-border px-3 text-sm" placeholder={`ধাপ ${i + 1} (বাংলা)`} />
                        ))}
                        <Button type="button" size="sm" variant="outline" onClick={() => updateSection(section.id, (s) => (s.type === "how_to_order" ? { ...s, steps: [...s.steps, { textBn: "", textEn: "" }] } : s))}>+ ধাপ</Button>
                      </div>
                    ) : null}

                    {section.type === "faq" ? (
                      <div className="space-y-3">
                        {section.items.map((item, i) => (
                          <div key={i} className="grid gap-2 sm:grid-cols-2">
                            <TextField label={`প্রশ্ন ${i + 1} (বাংলা)`} value={item.questionBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "faq" ? { ...s, items: s.items.map((it, j) => (j === i ? { ...it, questionBn: v } : it)) } : s))} />
                            <TextField label={`উত্তর ${i + 1} (বাংলা)`} value={item.answerBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "faq" ? { ...s, items: s.items.map((it, j) => (j === i ? { ...it, answerBn: v } : it)) } : s))} />
                          </div>
                        ))}
                        <Button type="button" size="sm" variant="outline" onClick={() => updateSection(section.id, (s) => (s.type === "faq" ? { ...s, items: [...s.items, { questionBn: "", questionEn: "", answerBn: "", answerEn: "" }] } : s))}>+ প্রশ্ন</Button>
                      </div>
                    ) : null}

                    {section.type === "order_form_note" || section.type === "footer_note" ? (
                      <TextArea label="লেখা (বাংলা)" value={section.textBn} onChange={(v) => updateSection(section.id, (s) => (s.type === "order_form_note" || s.type === "footer_note" ? { ...s, textBn: v } : s))} />
                    ) : null}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}
        </div>

        <div>
          <Card className="sticky top-4">
            <h2 className="mb-1 font-semibold">লাইভ প্রিভিউ</h2>
            <p className="mb-3 text-xs text-text-muted">
              প্রিভিউ আর পাবলিক পেজ একই রেন্ডারার (LandingView) ব্যবহার করে —{" "}
              {selected ? <span className="font-mono">/lp/{selected.slug}</span> : null}
              {selected && selected.status !== "PUBLISHED" ? " · এই পেজটি খসড়া/আর্কাইভ — পাবলিক URL-এ এখন 404 দেখাবে।" : ""}
            </p>
            <div className="overflow-hidden rounded-xl border border-border">
              {view ? <LandingView view={view} /> : <p className="p-4 text-sm text-text-muted">কোনো পেজ বেছে নেওয়া হয়নি।</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
