"use client";
// Site content editor — header/footer menu builder + homepage hero
// slides (CMS backlog #13/#15). Seeded from the DB-backed store via
// the server parent's props (src/cms/site-content.ts — Setting table,
// cms.* keys) and saved as ONE document through
// PUT /api/v1/admin/site-content. Sections the owner has never saved
// arrive as the built-in defaults and are labelled as such
// (configured: false) — saving is what makes them owner content.
// Array order IS display order; ↑/↓ buttons reorder. No drag-drop.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  newSiteContentId,
  type FooterMenuGroup,
  type HeroSlide,
  type SiteContent,
  type SiteContentConfigured,
  type SiteMenuChild,
  type SiteMenuItem,
} from "@/cms/site-content-types";

const inputCls = "h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500";
const areaCls = "w-full rounded-[10px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500";

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-text-muted">{label}</span>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputCls} />
    </label>
  );
}

function RowControls({ onUp, onDown, onDelete }: { onUp: () => void; onDown: () => void; onDelete: () => void }) {
  return (
    <span className="flex shrink-0 gap-1">
      <Button type="button" size="sm" variant="ghost" onClick={onUp} aria-label="উপরে নিন">↑</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onDown} aria-label="নিচে নিন">↓</Button>
      <Button type="button" size="sm" variant="destructive" onClick={onDelete}>মুছুন</Button>
    </span>
  );
}

function VisibleToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function move<T>(arr: T[], index: number, delta: number): T[] {
  const next = [...arr];
  const target = index + delta;
  if (target < 0 || target >= next.length) return arr;
  const [item] = next.splice(index, 1);
  if (!item) return arr;
  next.splice(target, 0, item);
  return next;
}

function DefaultsNote({ configured, what }: { configured: boolean; what: string }) {
  if (configured) return null;
  return (
    <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
      এখনো নিজের {what} সেভ করেননি — স্টোরফ্রন্টে বিল্ট-ইন ডিফল্ট দেখাচ্ছে (মেনুর ক্ষেত্রে নিচের তালিকাটিই সেই ডিফল্ট)।
      সেভ করলেই আপনার {what} লাইভ হবে।
    </p>
  );
}

export default function SiteContentEditor({
  initial,
  configured: initialConfigured,
}: {
  initial: SiteContent;
  configured: SiteContentConfigured;
}) {
  const [headerMenu, setHeaderMenu] = useState<SiteMenuItem[]>(() => structuredClone(initial.headerMenu));
  const [footerMenu, setFooterMenu] = useState<FooterMenuGroup[]>(() => structuredClone(initial.footerMenu));
  const [heroSlides, setHeroSlides] = useState<HeroSlide[]>(() => structuredClone(initial.heroSlides));
  const [configured, setConfigured] = useState<SiteContentConfigured>(initialConfigured);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/v1/admin/site-content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headerMenu, footerMenu, heroSlides }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: { message?: string; details?: unknown } } | null;
        const details = Array.isArray(json?.error?.details) ? ` (${json.error.details.length}টি সমস্যা)` : "";
        setNotice(`⚠ সংরক্ষণ ব্যর্থ: ${json?.error?.message ?? `HTTP ${res.status}`}${details}`);
        return;
      }
      const json = (await res.json()) as { data: SiteContent & { configured: SiteContentConfigured } };
      setHeaderMenu(json.data.headerMenu);
      setFooterMenu(json.data.footerMenu);
      setHeroSlides(json.data.heroSlides);
      setConfigured(json.data.configured);
      setNotice("✓ ডাটাবেসে সংরক্ষিত হয়েছে — স্টোরফ্রন্টে এখনই লাইভ।");
    } catch {
      setNotice("⚠ সংরক্ষণ ব্যর্থ — নেটওয়ার্ক সমস্যা, আবার চেষ্টা করুন।");
    } finally {
      setSaving(false);
    }
  }

  const patchHeader = (i: number, patch: Partial<SiteMenuItem>) =>
    setHeaderMenu((prev) => prev.map((it, j) => (j === i ? { ...it, ...patch } : it)));
  const patchHeaderChild = (i: number, k: number, patch: Partial<SiteMenuChild>) =>
    setHeaderMenu((prev) =>
      prev.map((it, j) => (j === i ? { ...it, children: it.children.map((c, m) => (m === k ? { ...c, ...patch } : c)) } : it)),
    );
  const patchFooterGroup = (i: number, patch: Partial<FooterMenuGroup>) =>
    setFooterMenu((prev) => prev.map((g, j) => (j === i ? { ...g, ...patch } : g)));
  const patchFooterLink = (i: number, k: number, patch: Partial<SiteMenuChild>) =>
    setFooterMenu((prev) =>
      prev.map((g, j) => (j === i ? { ...g, links: g.links.map((l, m) => (m === k ? { ...l, ...patch } : l)) } : g)),
    );
  const patchSlide = (i: number, patch: Partial<HeroSlide>) =>
    setHeroSlides((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={save} disabled={saving}>
          {saving ? "সংরক্ষণ হচ্ছে…" : "সব সংরক্ষণ করুন"}
        </Button>
        <span className="text-xs text-text-muted">মেনু ও স্লাইড একসাথে সেভ হয় (ডাটাবেস — Setting টেবিল)।</span>
      </div>
      {notice ? <p role="status" className="rounded-lg bg-surface-2 px-4 py-2 text-sm">{notice}</p> : null}

      {/* ---------------- Header menu ---------------- */}
      <Card>
        <h3 className="mb-1 font-semibold">হেডার মেনু</h3>
        <p className="mb-3 text-sm text-text-muted">
          স্টোরফ্রন্ট হেডারের প্রধান নেভিগেশন। সাব-আইটেম থাকলে ডেস্কটপে ড্রপডাউন, মোবাইলে ইনডেন্ট হয়ে দেখাবে।
          লিংক: ভেতরের পেজ হলে <code>/shop</code>-এর মতো, বাইরের হলে পুরো <code>https://…</code> URL।
        </p>
        <DefaultsNote configured={configured.headerMenu} what="হেডার মেনু" />
        <div className="space-y-3">
          {headerMenu.map((item, i) => (
            <div key={item.id} className="rounded-lg border border-border p-3">
              <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
                <TextField label="লেবেল (বাংলা)" value={item.labelBn} onChange={(v) => patchHeader(i, { labelBn: v })} />
                <TextField label="লেবেল (ইংরেজি)" value={item.labelEn} onChange={(v) => patchHeader(i, { labelEn: v })} />
                <TextField label="লিংক (URL)" value={item.href} onChange={(v) => patchHeader(i, { href: v })} />
                <VisibleToggle label="দৃশ্যমান" checked={item.visible} onChange={(v) => patchHeader(i, { visible: v })} />
                <RowControls
                  onUp={() => setHeaderMenu((p) => move(p, i, -1))}
                  onDown={() => setHeaderMenu((p) => move(p, i, 1))}
                  onDelete={() => setHeaderMenu((p) => p.filter((_, j) => j !== i))}
                />
              </div>
              <div className="mt-3 space-y-2 border-l-2 border-border pl-4">
                {item.children.map((child, k) => (
                  <div key={child.id} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
                    <TextField label="সাব-লেবেল (বাংলা)" value={child.labelBn} onChange={(v) => patchHeaderChild(i, k, { labelBn: v })} />
                    <TextField label="সাব-লেবেল (ইংরেজি)" value={child.labelEn} onChange={(v) => patchHeaderChild(i, k, { labelEn: v })} />
                    <TextField label="লিংক (URL)" value={child.href} onChange={(v) => patchHeaderChild(i, k, { href: v })} />
                    <VisibleToggle label="দৃশ্যমান" checked={child.visible} onChange={(v) => patchHeaderChild(i, k, { visible: v })} />
                    <RowControls
                      onUp={() => patchHeader(i, { children: move(item.children, k, -1) })}
                      onDown={() => patchHeader(i, { children: move(item.children, k, 1) })}
                      onDelete={() => patchHeader(i, { children: item.children.filter((_, m) => m !== k) })}
                    />
                  </div>
                ))}
                <Button
                  type="button" size="sm" variant="outline"
                  onClick={() => patchHeader(i, { children: [...item.children, { id: newSiteContentId("hmc"), labelBn: "", labelEn: "", href: "/", visible: true }] })}
                >
                  + সাব-আইটেম
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Button
          type="button" variant="secondary" className="mt-3"
          onClick={() => setHeaderMenu((p) => [...p, { id: newSiteContentId("hm"), labelBn: "", labelEn: "", href: "/", visible: true, children: [] }])}
        >
          + মেনু আইটেম
        </Button>
      </Card>

      {/* ---------------- Footer menu ---------------- */}
      <Card>
        <h3 className="mb-1 font-semibold">ফুটার মেনু</h3>
        <p className="mb-3 text-sm text-text-muted">
          স্টোরফ্রন্ট ফুটারের লিংক-গ্রুপ। গ্রুপের শিরোনামসহ প্রতিটি লিংক আলাদাভাবে লুকানো যায়;
          সব লিংক লুকানো গ্রুপ ফুটারে দেখাবে না।
        </p>
        <DefaultsNote configured={configured.footerMenu} what="ফুটার মেনু" />
        <div className="space-y-3">
          {footerMenu.map((group, i) => (
            <div key={group.id} className="rounded-lg border border-border p-3">
              <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto_auto]">
                <TextField label="গ্রুপ শিরোনাম (বাংলা)" value={group.headingBn} onChange={(v) => patchFooterGroup(i, { headingBn: v })} />
                <TextField label="গ্রুপ শিরোনাম (ইংরেজি)" value={group.headingEn} onChange={(v) => patchFooterGroup(i, { headingEn: v })} />
                <VisibleToggle label="দৃশ্যমান" checked={group.visible} onChange={(v) => patchFooterGroup(i, { visible: v })} />
                <RowControls
                  onUp={() => setFooterMenu((p) => move(p, i, -1))}
                  onDown={() => setFooterMenu((p) => move(p, i, 1))}
                  onDelete={() => setFooterMenu((p) => p.filter((_, j) => j !== i))}
                />
              </div>
              <div className="mt-3 space-y-2 border-l-2 border-border pl-4">
                {group.links.map((link, k) => (
                  <div key={link.id} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_1fr_auto_auto]">
                    <TextField label="লেবেল (বাংলা)" value={link.labelBn} onChange={(v) => patchFooterLink(i, k, { labelBn: v })} />
                    <TextField label="লেবেল (ইংরেজি)" value={link.labelEn} onChange={(v) => patchFooterLink(i, k, { labelEn: v })} />
                    <TextField label="লিংক (URL)" value={link.href} onChange={(v) => patchFooterLink(i, k, { href: v })} />
                    <VisibleToggle label="দৃশ্যমান" checked={link.visible} onChange={(v) => patchFooterLink(i, k, { visible: v })} />
                    <RowControls
                      onUp={() => patchFooterGroup(i, { links: move(group.links, k, -1) })}
                      onDown={() => patchFooterGroup(i, { links: move(group.links, k, 1) })}
                      onDelete={() => patchFooterGroup(i, { links: group.links.filter((_, m) => m !== k) })}
                    />
                  </div>
                ))}
                <Button
                  type="button" size="sm" variant="outline"
                  onClick={() => patchFooterGroup(i, { links: [...group.links, { id: newSiteContentId("fml"), labelBn: "", labelEn: "", href: "/", visible: true }] })}
                >
                  + লিংক
                </Button>
              </div>
            </div>
          ))}
        </div>
        <Button
          type="button" variant="secondary" className="mt-3"
          onClick={() => setFooterMenu((p) => [...p, { id: newSiteContentId("fm"), headingBn: "", headingEn: "", visible: true, links: [] }])}
        >
          + গ্রুপ
        </Button>
      </Card>

      {/* ---------------- Hero slides ---------------- */}
      <Card>
        <h3 className="mb-1 font-semibold">হোমপেজ হিরো স্লাইড (ক্যাম্পেইন)</h3>
        <p className="mb-3 text-sm text-text-muted">
          কমপক্ষে একটি <strong>সক্রিয়</strong> স্লাইড থাকলে হোমপেজের হিরোতে স্লাইডার দেখাবে (৬ সেকেন্ডে অটো বদল,
          হোভারে থামে)। একটিও সক্রিয় না থাকলে আগের স্থির হিরোই দেখাবে — কোনো বদল হবে না। ছবির URL না দিলে
          অরোরা ডিজাইনটাই থাকবে।
        </p>
        <DefaultsNote configured={configured.heroSlides} what="হিরো স্লাইড" />
        <div className="space-y-3">
          {heroSlides.map((slide, i) => (
            <div key={slide.id} className="rounded-lg border border-border p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-semibold">স্লাইড {i + 1}</span>
                <span className="flex items-center gap-3">
                  <VisibleToggle label="সক্রিয়" checked={slide.active} onChange={(v) => patchSlide(i, { active: v })} />
                  <RowControls
                    onUp={() => setHeroSlides((p) => move(p, i, -1))}
                    onDown={() => setHeroSlides((p) => move(p, i, 1))}
                    onDelete={() => setHeroSlides((p) => p.filter((_, j) => j !== i))}
                  />
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <TextField label="হেডলাইন (বাংলা)" value={slide.headlineBn} onChange={(v) => patchSlide(i, { headlineBn: v })} />
                <TextField label="হেডলাইন (ইংরেজি)" value={slide.headlineEn} onChange={(v) => patchSlide(i, { headlineEn: v })} />
                <TextField label="উপ-লেখা (বাংলা)" value={slide.subtextBn} onChange={(v) => patchSlide(i, { subtextBn: v })} />
                <TextField label="উপ-লেখা (ইংরেজি)" value={slide.subtextEn} onChange={(v) => patchSlide(i, { subtextEn: v })} />
                <TextField label="বোতামের লেখা (বাংলা)" value={slide.ctaLabelBn} onChange={(v) => patchSlide(i, { ctaLabelBn: v })} />
                <TextField label="বোতামের লেখা (ইংরেজি)" value={slide.ctaLabelEn} onChange={(v) => patchSlide(i, { ctaLabelEn: v })} />
                <TextField label="বোতামের লিংক" value={slide.ctaHref} onChange={(v) => patchSlide(i, { ctaHref: v })} placeholder="/shop" />
                <TextField
                  label="ছবির URL (ঐচ্ছিক)" value={slide.imageUrl ?? ""}
                  onChange={(v) => patchSlide(i, { imageUrl: v.trim() === "" ? null : v })}
                  placeholder="https://…"
                />
              </div>
            </div>
          ))}
          {heroSlides.length === 0 ? (
            <p className="text-sm text-text-muted">এখনো কোনো স্লাইড নেই — হোমপেজে স্থির হিরো দেখাচ্ছে।</p>
          ) : null}
        </div>
        <Button
          type="button" variant="secondary" className="mt-3"
          onClick={() =>
            setHeroSlides((p) => [
              ...p,
              {
                id: newSiteContentId("hs"), headlineBn: "", headlineEn: "", subtextBn: "", subtextEn: "",
                ctaLabelBn: "এখনই কিনুন", ctaLabelEn: "Shop Now", ctaHref: "/shop", imageUrl: null, active: true,
              },
            ])
          }
        >
          + স্লাইড
        </Button>
      </Card>
    </div>
  );
}
