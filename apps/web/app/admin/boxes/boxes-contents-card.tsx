"use client";

/**
 * Box cycle-contents editor — self-fetching client card (ADV-23
 * vertical 4, wave 56). Edits the Setting doc
 * `boxes.contents.<variantId>` through /api/v1/admin/boxes/contents
 * (settings.edit + reason, audited server-side).
 *
 * Item rows come from REAL variants: the search box queries
 * /api/v1/admin/boxes/variants (SKU / product title) and a row can
 * only be added from a result. The server re-resolves every item
 * at save time and snapshots name/SKU/label into the doc — what is
 * stored can never point at a phantom variant.
 *
 * Cycle keys: monthly cycles are "YYYY-MM", weekly cycles are ISO
 * weeks "YYYY-Www" — the quick-fill buttons compute them with the
 * same helpers the generator uses (src/boxes/cycles.ts).
 */
import { useCallback, useEffect, useState } from "react";
import { dhakaYmdOf, shiftYmd } from "@/lib/dhaka-date";
import { isoWeekKeyOfYmd } from "@/boxes/cycles";
import type { BoxVariantOption, BoxVariantSummary } from "@/boxes/service";
import type { BoxContentItem } from "@/boxes/contents";

interface CycleDraft {
  cycleKey: string;
  noteBn: string;
  noteEn: string;
  items: BoxContentItem[];
}

interface ContentsResponse {
  data?: { doc: { cycles: CycleDraft[] } | null };
  error?: { message?: string };
}

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-main";
const SMALL_BUTTON =
  "inline-flex items-center rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-main transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";

function nextMonthKey(): string {
  const ymd = dhakaYmdOf(new Date());
  const date = new Date(`${ymd}T00:00:00.000Z`);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 7);
}

export function BoxesContentsCard() {
  const [boxes, setBoxes] = useState<BoxVariantSummary[] | null>(null);
  const [variantId, setVariantId] = useState("");
  const [cycles, setCycles] = useState<CycleDraft[]>([]);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Per-cycle item search state: which cycle index is searching +
  // the query + results (one open search at a time keeps it simple).
  const [searchCycle, setSearchCycle] = useState<number | null>(null);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<BoxVariantOption[]>([]);

  const loadDoc = useCallback(async (id: string) => {
    if (id === "") {
      setCycles([]);
      return;
    }
    try {
      const res = await fetch(`/api/v1/admin/boxes/contents?variantId=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as ContentsResponse | null;
      if (!res.ok) {
        setError(json?.error?.message ?? "তালিকা লোড করা যায়নি।");
        return;
      }
      setCycles(
        (json?.data?.doc?.cycles ?? []).map((c) => ({
          cycleKey: c.cycleKey,
          noteBn: c.noteBn ?? "",
          noteEn: c.noteEn ?? "",
          items: c.items,
        })),
      );
      setError(null);
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — তালিকা লোড করা যায়নি।");
    }
  }, []);

  const loadBoxes = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/boxes/contents", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as {
        data?: { boxes: BoxVariantSummary[] };
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.data) {
        setError(json?.error?.message ?? "বক্সের তালিকা লোড করা যায়নি।");
        return;
      }
      setBoxes(json.data.boxes);
      setVariantId((prev) => {
        const next = prev !== "" ? prev : (json.data?.boxes[0]?.variantId ?? "");
        if (next !== prev) void loadDoc(next);
        return next;
      });
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — বক্সের তালিকা লোড করা যায়নি।");
    }
  }, [loadDoc]);

  useEffect(() => {
    void loadBoxes();
  }, [loadBoxes]);

  useEffect(() => {
    if (searchCycle === null || searchText.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/v1/admin/boxes/variants?q=${encodeURIComponent(searchText.trim())}`,
            { cache: "no-store" },
          );
          const json = (await res.json().catch(() => null)) as {
            data?: { variants: BoxVariantOption[] };
          } | null;
          if (!cancelled) setSearchResults(json?.data?.variants ?? []);
        } catch {
          if (!cancelled) setSearchResults([]);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchCycle, searchText]);

  function patchCycle(index: number, patch: Partial<CycleDraft>) {
    setCycles((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function addItem(cycleIndex: number, option: BoxVariantOption) {
    setCycles((prev) =>
      prev.map((c, i) => {
        if (i !== cycleIndex) return c;
        if (c.items.some((it) => it.variantId === option.variantId)) return c;
        return {
          ...c,
          items: [
            ...c.items,
            {
              variantId: option.variantId,
              quantity: 1,
              productName: option.productName,
              sku: option.sku,
              variantLabel: option.variantLabel,
            },
          ],
        };
      }),
    );
    setSearchText("");
    setSearchResults([]);
  }

  async function save() {
    if (variantId === "") return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/admin/boxes/contents", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          variantId,
          cycles: cycles.map((c) => ({
            cycleKey: c.cycleKey.trim(),
            ...(c.noteBn.trim() !== "" ? { noteBn: c.noteBn.trim() } : {}),
            ...(c.noteEn.trim() !== "" ? { noteEn: c.noteEn.trim() } : {}),
            items: c.items.map((it) => ({ variantId: it.variantId, quantity: it.quantity })),
          })),
          reason,
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: { message?: string; details?: unknown };
      } | null;
      if (!res.ok) {
        setError(json?.error?.message ?? "তালিকা সংরক্ষণ করা যায়নি।");
        return;
      }
      setNotice("সাইকেলের তালিকা সংরক্ষিত হয়েছে।");
      setReason("");
      await loadBoxes();
      await loadDoc(variantId);
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — তালিকা সংরক্ষণ করা যায়নি।");
    } finally {
      setBusy(false);
    }
  }

  const today = dhakaYmdOf(new Date());
  const quickKeys: { label: string; key: string }[] = [
    { label: "এই মাস", key: today.slice(0, 7) },
    { label: "পরের মাস", key: nextMonthKey() },
    { label: "এই সপ্তাহ", key: isoWeekKeyOfYmd(today) },
    { label: "পরের সপ্তাহ", key: isoWeekKeyOfYmd(shiftYmd(today, 7)) },
  ];
  const selectedSummary = boxes?.find((b) => b.variantId === variantId) ?? null;

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <h2 className="font-display text-base font-bold text-text-main">সাইকেল অনুযায়ী বাক্সের তালিকা</h2>
      <p className="mt-1 text-sm leading-6 text-text-muted">
        প্রতি সাইকেলে বাক্সে কী কী থাকবে তা এখানে নির্ধারণ করুন। যে সাইকেলের তালিকা নেই, সেই
        চক্রে অর্ডার তৈরি হবে না — আগের সাইকেলের তালিকা কখনো নিজে থেকে পুনরায় ব্যবহার হবে না।
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      ) : null}

      {boxes === null ? (
        <p className="mt-3 text-sm text-text-muted">লোড হচ্ছে…</p>
      ) : boxes.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">
          আগে নিচের বক্স কনফিগে অন্তত একটি বক্স ভ্যারিয়েন্ট যোগ করুন — তারপর এখানে সাইকেলের
          তালিকা দেওয়া যাবে।
        </p>
      ) : (
        <div className="mt-4 grid gap-4">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-text-main">বক্স ভ্যারিয়েন্ট</span>
            <select
              className={INPUT_CLASS}
              value={variantId}
              onChange={(e) => {
                setVariantId(e.target.value);
                void loadDoc(e.target.value);
              }}
              aria-label="বক্স ভ্যারিয়েন্ট"
            >
              {boxes.map((b) => (
                <option key={b.variantId} value={b.variantId}>
                  {b.productName ?? "(পণ্য পাওয়া যায়নি)"} — {b.variantLabel ?? ""} ({b.sku ?? b.variantId})
                </option>
              ))}
            </select>
            {selectedSummary && selectedSummary.definedCycleKeys.length > 0 ? (
              <span className="text-xs text-text-muted">
                তালিকা আছে: {selectedSummary.definedCycleKeys.join(", ")}
              </span>
            ) : (
              <span className="text-xs text-text-muted">এই বক্সের কোনো সাইকেলের তালিকা এখনো নেই।</span>
            )}
          </label>

          {cycles.map((cycle, ci) => (
            <div key={ci} className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex flex-wrap items-end gap-2.5">
                <label className="grid flex-1 gap-1 text-sm" style={{ minWidth: 160 }}>
                  <span className="font-medium text-text-main">সাইকেল কী (YYYY-MM অথবা YYYY-Www)</span>
                  <input
                    className={INPUT_CLASS + " font-mono"}
                    value={cycle.cycleKey}
                    onChange={(e) => patchCycle(ci, { cycleKey: e.target.value })}
                    placeholder="2026-11"
                  />
                </label>
                <div className="flex flex-wrap gap-1.5 pb-0.5">
                  {quickKeys.map((q) => (
                    <button
                      key={q.label}
                      type="button"
                      className={SMALL_BUTTON}
                      onClick={() => patchCycle(ci, { cycleKey: q.key })}
                    >
                      {q.label}: {q.key}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className={SMALL_BUTTON + " border-red-300 text-red-700 hover:bg-red-50 dark:border-red-400/30 dark:text-red-300 dark:hover:bg-red-500/10"}
                  onClick={() => setCycles((prev) => prev.filter((_, i) => i !== ci))}
                >
                  সাইকেল মুছুন
                </button>
              </div>

              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-text-main">থিম/নোট (বাংলা, ঐচ্ছিক)</span>
                  <input
                    className={INPUT_CLASS}
                    value={cycle.noteBn}
                    onChange={(e) => patchCycle(ci, { noteBn: e.target.value })}
                    placeholder="যেমন: শীতের যত্ন বক্স"
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-text-main">Theme/note (English, optional)</span>
                  <input
                    className={INPUT_CLASS}
                    value={cycle.noteEn}
                    onChange={(e) => patchCycle(ci, { noteEn: e.target.value })}
                    placeholder="e.g. Winter care box"
                  />
                </label>
              </div>

              <div className="mt-3">
                <p className="text-sm font-medium text-text-main">বাক্সের পণ্যসমূহ (প্রতি বাক্সে)</p>
                {cycle.items.length === 0 ? (
                  <p className="mt-1 text-sm text-text-muted">এখনো কোনো পণ্য যোগ হয়নি।</p>
                ) : (
                  <ul className="mt-2 space-y-1.5">
                    {cycle.items.map((item) => (
                      <li key={item.variantId} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="flex-1" style={{ minWidth: 180 }}>
                          {item.productName} — {item.variantLabel}
                          <span className="text-text-muted"> ({item.sku})</span>
                        </span>
                        <input
                          className={INPUT_CLASS + " w-24"}
                          type="number"
                          min={0.001}
                          step={0.5}
                          value={item.quantity}
                          onChange={(e) =>
                            patchCycle(ci, {
                              items: cycle.items.map((it) =>
                                it.variantId === item.variantId
                                  ? { ...it, quantity: Number(e.target.value) }
                                  : it,
                              ),
                            })
                          }
                          aria-label="পরিমাণ"
                        />
                        <button
                          type="button"
                          className={SMALL_BUTTON}
                          onClick={() =>
                            patchCycle(ci, {
                              items: cycle.items.filter((it) => it.variantId !== item.variantId),
                            })
                          }
                        >
                          সরান
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="relative mt-2.5">
                  <input
                    className={INPUT_CLASS}
                    value={searchCycle === ci ? searchText : ""}
                    onFocus={() => {
                      setSearchCycle(ci);
                      setSearchText("");
                      setSearchResults([]);
                    }}
                    onChange={(e) => {
                      setSearchCycle(ci);
                      setSearchText(e.target.value);
                    }}
                    placeholder="পণ্য যোগ করুন — SKU বা পণ্যের নাম লিখে খুঁজুন…"
                    aria-label="পণ্য খুঁজুন"
                  />
                  {searchCycle === ci && searchResults.length > 0 ? (
                    <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-border bg-card shadow-lg">
                      {searchResults.map((r) => (
                        <li key={r.variantId}>
                          <button
                            type="button"
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2"
                            onClick={() => addItem(ci, r)}
                          >
                            {r.productName} — {r.variantLabel}
                            <span className="text-text-muted">
                              {" "}
                              ({r.sku} · স্টক {r.stock})
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              className={SMALL_BUTTON}
              onClick={() =>
                setCycles((prev) => [...prev, { cycleKey: "", noteBn: "", noteEn: "", items: [] }])
              }
            >
              + নতুন সাইকেল যোগ করুন
            </button>
          </div>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-text-main">পরিবর্তনের কারণ (বাধ্যতামূলক)</span>
            <input
              className={INPUT_CLASS}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="যেমন: নভেম্বর সাইকেলের তালিকা"
            />
          </label>

          <div>
            <button
              type="button"
              disabled={busy || reason.trim() === "" || variantId === ""}
              onClick={save}
              className="inline-flex items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "সংরক্ষণ হচ্ছে…" : "তালিকা সংরক্ষণ করুন"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
