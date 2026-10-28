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
import { Card } from "@/components/ui/card";
import { dhakaYmdOf, shiftYmd } from "@/lib/dhaka-date";
import { isoWeekKeyOfYmd } from "@/boxes/cycles";
import type { BoxVariantOption, BoxVariantSummary } from "@/boxes/service";
import type { BoxContentItem } from "@/boxes/contents";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { BOXES_STRINGS } from "./strings";

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
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300";
const SMALL_BUTTON =
  "inline-flex min-h-11 items-center rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-text-main transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-50 md:min-h-0";

function nextMonthKey(): string {
  const ymd = dhakaYmdOf(new Date());
  const date = new Date(`${ymd}T00:00:00.000Z`);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 7);
}

export function BoxesContentsCard() {
  const { locale } = useLocale();
  const s = pick(locale, BOXES_STRINGS);
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
        setError(json?.error?.message ?? s.contentsLoadFailed);
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
      setError(s.contentsLoadNetwork);
    }
  }, [s]);

  const loadBoxes = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/boxes/contents", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as {
        data?: { boxes: BoxVariantSummary[] };
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.data) {
        setError(json?.error?.message ?? s.boxesLoadFailed);
        return;
      }
      setBoxes(json.data.boxes);
      setVariantId((prev) => {
        const next = prev !== "" ? prev : (json.data?.boxes[0]?.variantId ?? "");
        if (next !== prev) void loadDoc(next);
        return next;
      });
    } catch {
      setError(s.boxesLoadNetwork);
    }
  }, [loadDoc, s]);

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
        setError(json?.error?.message ?? s.contentsSaveFailed);
        return;
      }
      setNotice(s.contentsSaved);
      setReason("");
      await loadBoxes();
      await loadDoc(variantId);
    } catch {
      setError(s.contentsSaveNetwork);
    } finally {
      setBusy(false);
    }
  }

  const today = dhakaYmdOf(new Date());
  const quickKeys: { label: string; key: string }[] = [
    { label: s.quickThisMonth, key: today.slice(0, 7) },
    { label: s.quickNextMonth, key: nextMonthKey() },
    { label: s.quickThisWeek, key: isoWeekKeyOfYmd(today) },
    { label: s.quickNextWeek, key: isoWeekKeyOfYmd(shiftYmd(today, 7)) },
  ];
  const selectedSummary = boxes?.find((b) => b.variantId === variantId) ?? null;

  return (
    <Card className="p-4 sm:p-5">
      <h2 className="font-display text-base font-semibold text-text-main">{s.contentsTitle}</h2>
      <p className="mt-1 text-sm leading-6 text-text-muted">{s.contentsIntro}</p>

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-3 text-sm font-medium text-success-solid">
          {notice}
        </p>
      ) : null}

      {boxes === null ? (
        <p className="mt-3 text-sm text-text-muted">{s.loading}</p>
      ) : boxes.length === 0 ? (
        <p className="mt-3 text-sm text-text-muted">{s.noBoxesNote}</p>
      ) : (
        <div className="mt-4 grid gap-4">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-text-main">{s.variantLabel}</span>
            <select
              className={INPUT_CLASS}
              value={variantId}
              onChange={(e) => {
                setVariantId(e.target.value);
                void loadDoc(e.target.value);
              }}
              aria-label={s.variantLabel}
            >
              {boxes.map((b) => (
                <option key={b.variantId} value={b.variantId}>
                  {b.productName ?? s.productMissing} — {b.variantLabel ?? ""} ({b.sku ?? b.variantId})
                </option>
              ))}
            </select>
            {selectedSummary && selectedSummary.definedCycleKeys.length > 0 ? (
              <span className="text-xs text-text-muted">
                {interpolate(s.definedCycles, { keys: selectedSummary.definedCycleKeys.join(", ") })}
              </span>
            ) : (
              <span className="text-xs text-text-muted">{s.noCyclesYet}</span>
            )}
          </label>

          {cycles.map((cycle, ci) => (
            <div key={ci} className="rounded-xl border border-border bg-card p-3.5">
              <div className="flex flex-wrap items-end gap-2.5">
                <label className="grid flex-1 gap-1 text-sm" style={{ minWidth: 160 }}>
                  <span className="font-medium text-text-main">{s.cycleKeyLabel}</span>
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
                  className={SMALL_BUTTON + " border-danger/40 text-danger hover:bg-danger-soft"}
                  onClick={() => setCycles((prev) => prev.filter((_, i) => i !== ci))}
                >
                  {s.deleteCycle}
                </button>
              </div>

              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-text-main">{s.noteBnLabel}</span>
                  <input
                    className={INPUT_CLASS}
                    value={cycle.noteBn}
                    onChange={(e) => patchCycle(ci, { noteBn: e.target.value })}
                    placeholder={s.noteBnPlaceholder}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium text-text-main">{s.noteEnLabel}</span>
                  <input
                    className={INPUT_CLASS}
                    value={cycle.noteEn}
                    onChange={(e) => patchCycle(ci, { noteEn: e.target.value })}
                    placeholder={s.noteEnPlaceholder}
                  />
                </label>
              </div>

              <div className="mt-3">
                <p className="text-sm font-medium text-text-main">{s.itemsHeading}</p>
                {cycle.items.length === 0 ? (
                  <p className="mt-1 text-sm text-text-muted">{s.noItems}</p>
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
                          aria-label={s.quantityAria}
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
                          {s.removeBtn}
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
                    placeholder={s.searchPlaceholder}
                    aria-label={s.searchAria}
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
                              ({r.sku} · {interpolate(s.stockPart, { stock: r.stock })})
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
              {s.addCycle}
            </button>
          </div>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-text-main">{s.reasonLabel}</span>
            <input
              className={INPUT_CLASS}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={s.reasonPlaceholderContents}
            />
          </label>

          <div>
            <button
              type="button"
              disabled={busy || reason.trim() === "" || variantId === ""}
              onClick={save}
              className="inline-flex items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? s.saving : s.saveContents}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
