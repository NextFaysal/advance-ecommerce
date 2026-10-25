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

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "প্রকাশিত",
  DRAFT: "খসড়া",
  ARCHIVED: "আর্কাইভ",
};

export function RelatedPicker({
  productId,
  initialPicks,
}: {
  productId: string;
  initialPicks: RelatedPick[];
}) {
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
        setNotice({ tone: "err", text: json.error?.message ?? "সেভ করা যায়নি — আবার চেষ্টা করুন।" });
        return;
      }
      setNotice({ tone: "ok", text: "সম্পর্কিত পণ্যের তালিকা সেভ হয়েছে।" });
    } catch {
      setNotice({ tone: "err", text: "সেভ করা যায়নি — নেটওয়ার্ক সমস্যা হতে পারে।" });
    } finally {
      setSaving(false);
    }
  }

  const pickedIds = new Set(picks.map((p) => p.id));

  return (
    <section className="mt-6 rounded-lg border border-border bg-card p-5 shadow-card">
      <h2 className="text-h3">সম্পর্কিত পণ্য</h2>
      <p className="mt-1 text-small leading-relaxed text-text-muted">
        পণ্যের পেজে "সম্পর্কিত পণ্য" অংশে এগুলো আগে দেখাবে (শুধু প্রকাশিত ও সময় হলে লাইভগুলো)। বাকি জায়গা
        একই ক্যাটাগরির সেরা রেটিংয়ের পণ্য দিয়ে নিজে নিজে পূরণ হবে। সর্বোচ্চ {MAX_PICKS}টি।
      </p>

      {/* Search */}
      <div className="mt-4">
        <label htmlFor="related-search" className="text-small font-semibold text-text-main">
          পণ্য খুঁজে যোগ করুন
        </label>
        <input
          id="related-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="নাম বা slug লিখুন (কমপক্ষে ২ অক্ষর)"
          className="mt-1.5 h-11 w-full rounded-[10px] border border-border bg-card px-3 text-sm text-text-main outline-none focus:border-brand-500"
        />
        {searching ? <p className="mt-2 text-small text-text-muted">খোঁজা হচ্ছে…</p> : null}
        {hits.length > 0 ? (
          <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
            {hits.map((hit) => (
              <li key={hit.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-text-main">{hit.titleBn}</span>
                  <span className="block truncate text-caption text-text-subtle">
                    {hit.slug} · {STATUS_LABEL[hit.status] ?? hit.status}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={pickedIds.has(hit.id) || picks.length >= MAX_PICKS}
                  onClick={() => add(hit)}
                  className="min-h-[36px] shrink-0 rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {pickedIds.has(hit.id) ? "যোগ হয়েছে" : "যোগ করুন"}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Current picks */}
      <h3 className="mt-5 text-small font-semibold text-text-main">নির্বাচিত ({picks.length})</h3>
      {picks.length === 0 ? (
        <p className="mt-2 text-small text-text-muted">
          এখনো কিছু বাছাই করেননি — পণ্যের পেজে তখন একই ক্যাটাগরির সেরা পণ্যগুলো নিজে নিজে দেখাবে।
        </p>
      ) : (
        <ol className="mt-2 divide-y divide-border rounded-lg border border-border">
          {picks.map((pick, i) => (
            <li key={pick.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-text-main">
                  {pick.missing ? "(মুছে ফেলা পণ্য)" : pick.titleBn}
                </span>
                <span className="block truncate text-caption text-text-subtle">
                  {pick.slug} · {pick.missing ? "পাওয়া যাচ্ছে না" : STATUS_LABEL[pick.status] ?? pick.status}
                  {pick.status !== "ACTIVE" && !pick.missing ? " — প্রকাশিত হলেই পেজে দেখাবে" : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label="উপরে নিন"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-border text-text-muted transition hover:bg-surface-2 disabled:opacity-40"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label="নিচে নিন"
                  disabled={i === picks.length - 1}
                  onClick={() => move(i, 1)}
                  className="flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-border text-text-muted transition hover:bg-surface-2 disabled:opacity-40"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(pick.id)}
                  className="min-h-[36px] rounded-lg border border-border px-3 text-sm font-medium text-rose-600 transition hover:bg-rose-50"
                >
                  সরান
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="min-h-[44px] rounded-[10px] bg-brand-600 px-5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {saving ? "সেভ হচ্ছে…" : "সম্পর্কিত পণ্য সেভ করুন"}
        </button>
        {notice ? (
          <p role="status" className={`text-small ${notice.tone === "ok" ? "text-emerald-700" : "text-rose-600"}`}>
            {notice.text}
          </p>
        ) : null}
      </div>
    </section>
  );
}
