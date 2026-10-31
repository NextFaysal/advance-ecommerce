"use client";

/**
 * Related-products picker (Wave 14-2, doc 16 §P6) — rendered by the
 * product EDIT page BELOW the shared ProductEditor. The merchant
 * searches the catalog (admin list API, all statuses), builds an
 * ordered pick list, and saves it wholesale via
 * PUT /api/v1/admin/products/[id]/related.
 *
 * The PDP shows these picks first (only the ones still live), then
 * fills from the same category — so saving a non-ACTIVE pick is
 * allowed on purpose (it goes live when the pick does), and the
 * status badge next to each pick says exactly that.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { PRODUCTS_STRINGS } from "../strings";

export interface RelatedPick {
  id: string;
  titleBn: string;
  titleEn: string;
  slug: string;
  status: string;
  missing?: boolean;
}

interface SearchHit {
  id: string;
  slug: string;
  titleBn: string;
  status: string;
}

const MAX_PICKS = 20;

type RelStrings = (typeof PRODUCTS_STRINGS)["bn"];
const statusLabel = (s: RelStrings, status: string): string =>
  status === "ACTIVE" ? s.relStatusPublished : status === "DRAFT" ? s.relStatusDraft : status === "ARCHIVED" ? s.relStatusArchived : status;

export function RelatedPicker({
  productId,
  initialPicks,
}: {
  productId: string;
  initialPicks: RelatedPick[];
}) {
  const { locale } = useLocale();
  const s = pick(locale, PRODUCTS_STRINGS);
  const [picks, setPicks] = useState<RelatedPick[]>(initialPicks);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    try {
      const params = new URLSearchParams({ q: q.trim(), status: "ALL", page: "1", pageSize: "10" });
      const res = await fetch(`/api/v1/admin/products?${params.toString()}`);
      const json = (await res.json().catch(() => ({}))) as {
        data?: Array<{ id: string; slug: string; status: string; title: { bn: string; en: string } }>;
      };
      setHits(
        (json.data ?? [])
          .filter((p) => p.id !== productId)
          .map((p) => ({ id: p.id, slug: p.slug, status: p.status, titleBn: p.title.bn })),
      );
    } catch {
      setHits([]);
    } finally {
      setSearching(false);
    }
  }, [productId]);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void search(query), 250);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [query, search]);

  function add(hit: SearchHit) {
    setNotice(null);
    setPicks((prev) => {
      if (prev.some((p) => p.id === hit.id)) return prev;
      if (prev.length >= MAX_PICKS) return prev;
      return [...prev, { id: hit.id, titleBn: hit.titleBn, titleEn: "", slug: hit.slug, status: hit.status }];
    });
  }

  function move(index: number, delta: -1 | 1) {
    setNotice(null);
    setPicks((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      const [item] = next.splice(index, 1);
      if (!item) return prev;
      next.splice(target, 0, item);
      return next;
    });
  }

  function remove(id: string) {
    setNotice(null);
    setPicks((prev) => prev.filter((p) => p.id !== id));
  }

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/v1/admin/products/${encodeURIComponent(productId)}/related`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relatedIds: picks.map((p) => p.id) }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!res.ok) {
        setNotice({ tone: "err", text: json.error?.message ?? s.relSaveFail });
        return;
      }
      setNotice({ tone: "ok", text: s.relSaved });
    } catch {
      setNotice({ tone: "err", text: s.relSaveNetFail });
    } finally {
      setSaving(false);
    }
  }

  const pickedIds = new Set(picks.map((p) => p.id));

  return (
    <section className="mt-6 rounded-2xl border border-border/60 bg-card p-4 shadow-xs sm:p-5">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink shadow-xs ring-1 ring-inset ring-black/5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-h3">{s.relTitle}</h2>
          <p className="mt-1 text-small leading-relaxed text-text-muted">
            {interpolate(s.relDesc, { max: MAX_PICKS })}
          </p>
        </div>
        <span className="bg-brand-soft shrink-0 rounded-full px-3 py-1.5 text-xs font-bold tabular-nums text-brand-ink shadow-md">
          {picks.length}/{MAX_PICKS}
        </span>
      </div>

      {/* Search */}
      <div className="mt-5">
        <label htmlFor="related-search" className="text-small font-semibold text-text-main">
          {s.relSearchLabel}
        </label>
        <div className="relative mt-1.5">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-text-subtle">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            id="related-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={s.relSearchPh}
            className="h-12 w-full rounded-xl border border-border bg-card pl-10 pr-3 text-sm text-text-main shadow-xs outline-none transition duration-base ease-smooth focus:border-brand-ink focus:ring-[3px] focus:ring-brand-ink/15 hover:border-brand-200"
          />
        </div>
        {searching ? <p className="mt-2 text-small text-text-muted">{s.relSearching}</p> : null}
        {hits.length > 0 ? (
          <ul className="anim-fade-in mt-2.5 divide-y divide-border/60 rounded-2xl border border-border/60 bg-card px-3 shadow-xs">
            {hits.map((hit) => (
              <li key={hit.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-text-main">{hit.titleBn}</span>
                  <span className="block truncate text-caption text-text-subtle">
                    {hit.slug} · {statusLabel(s, hit.status)}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={pickedIds.has(hit.id) || picks.length >= MAX_PICKS}
                  onClick={() => add(hit)}
                  className="inline-flex min-h-[44px] shrink-0 items-center rounded-xl bg-brand-600 px-3.5 text-sm font-semibold text-white shadow-xs transition duration-fast ease-smooth hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {pickedIds.has(hit.id) ? s.relAdded : s.relAdd}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Current picks */}
      <h3 className="mt-6 text-small font-semibold text-text-main">{interpolate(s.relSelected, { count: picks.length })}</h3>
      {picks.length === 0 ? (
        <p className="mt-2 rounded-2xl border border-dashed border-border px-4 py-5 text-center text-small text-text-muted">
          {s.relEmpty}
        </p>
      ) : (
        <ol className="mt-2.5 space-y-2">
          {picks.map((pick, i) => {
            const chipCls = pick.missing
              ? "bg-danger-soft text-danger ring-danger/20"
              : pick.status === "ACTIVE"
                ? "bg-success-soft text-success-solid ring-success-solid/20"
                : pick.status === "DRAFT"
                  ? "bg-warning-soft text-warning-solid ring-warning-solid/20"
                  : "bg-surface-2 text-text-muted ring-black/5";
            return (
              <li key={pick.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-surface-2/40 px-3 py-2.5">
                <span aria-hidden="true" className="bg-brand-soft flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold tnum text-brand-ink shadow-xs">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-text-main">
                    {pick.missing ? s.relDeleted : pick.titleBn}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-text-subtle">
                    <span className="truncate font-mono">{pick.slug}</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${chipCls}`}>
                      {pick.missing ? s.relNotFound : statusLabel(s, pick.status)}
                    </span>
                    {pick.status !== "ACTIVE" && !pick.missing ? <span>{s.relLiveNote}</span> : null}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={s.relMoveUp}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-border bg-card text-text-muted shadow-xs transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-soft disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={s.relMoveDown}
                    disabled={i === picks.length - 1}
                    onClick={() => move(i, 1)}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-border bg-card text-text-muted shadow-xs transition duration-fast ease-smooth hover:border-brand-300 hover:bg-brand-soft disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(pick.id)}
                    className="inline-flex min-h-[44px] items-center rounded-xl border border-border bg-card px-3.5 text-sm font-semibold text-danger shadow-xs transition duration-fast ease-smooth hover:border-danger/30 hover:bg-danger-soft"
                  >
                    {s.relRemove}
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border/60 pt-4">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="brand-gradient inline-flex min-h-[44px] items-center rounded-xl px-5 text-sm font-semibold text-white shadow-md transition duration-fast ease-smooth hover:brightness-105 disabled:opacity-50"
        >
          {saving ? s.saving : s.relSaveBtn}
        </button>
        {notice ? (
          <p
            role="status"
            className={`anim-fade-in rounded-full px-3.5 py-2 text-small font-semibold ring-1 ring-inset ${
              notice.tone === "ok"
                ? "bg-success-soft text-success-solid ring-success-solid/20"
                : "bg-danger-soft text-danger ring-danger/20"
            }`}
          >
            {notice.text}
          </p>
        ) : null}
      </div>
    </section>
  );
}
