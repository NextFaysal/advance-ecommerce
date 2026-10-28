"use client";

/**
 * Warehouse client — ADV-21 (doc 22).
 *
 * Scanner-first UI: three big tabs (পিক লিস্ট / প্যাক / শিপ স্ক্যান),
 * 56px+ touch targets, monospace code inputs with autofocus and
 * Enter-to-submit. Camera scanning (wave 54-1, BarcodeScanner —
 * BarcodeDetector where the browser offers it, typed code
 * everywhere) ticks pack items by SKU/barcode and resolves ship
 * codes through the same endpoints the typed inputs use. All state lives server-side (orders, shipments,
 * the pick-list Setting doc, order timeline notes) — this component
 * only renders and calls /api/v1/admin/warehouse/*; it keeps no
 * fulfilment state of its own, so a reload never loses a packer's
 * place.
 *
 * Copy discipline (honesty): pick-list completion is labelled a
 * staff attestation that moves no stock; the handover button is
 * labelled "(ম্যানুয়াল)" everywhere and its caption states it only
 * writes a timeline note.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BarcodeScanner } from "@/components/admin/barcode-scanner";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { formatBdt } from "@/checkout/pricing";
import type { PickList } from "@/warehouse/pick-lists";
import type { ConfirmedQueue } from "@/warehouse/queue";
import type { ScanResolution } from "@/warehouse/ship-scan";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick } from "@/i18n/locale";
import { WAREHOUSE_STRINGS } from "./strings";

type Tab = "pick" | "pack" | "ship";

interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: ApiError };
  if (!res.ok || body.error) {
    throw new Error(body.error?.message ?? `Request failed (${res.status})`);
  }
  return body.data as T;
}

const tabBtn =
  "min-h-14 flex-1 rounded-xl border px-4 text-lg font-semibold transition ";
const tabActive = "border-primary bg-primary text-white";
const tabIdle = "border-border bg-card text-text-main hover:border-primary";
const bigBtn =
  "inline-flex min-h-14 items-center justify-center rounded-xl bg-primary px-6 text-lg font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtn =
  "inline-flex min-h-14 items-center justify-center rounded-xl border border-border bg-card px-5 text-base font-semibold text-text-main focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:cursor-not-allowed disabled:opacity-50";

function Notice({ text, tone }: { text: string; tone: "error" | "ok" }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl border px-4 py-3 text-base ${
        tone === "error"
          ? "border-danger/30 bg-danger-soft text-danger"
          : "border-success-solid/30 bg-success-soft text-success-solid"
      }`}
    >
      {text}
    </p>
  );
}

export function WarehouseClient({
  initialQueue,
  initialLists,
}: {
  initialQueue: ConfirmedQueue;
  initialLists: PickList[];
}) {
  const { locale } = useLocale();
  const s = pick(locale, WAREHOUSE_STRINGS);
  const [tab, setTab] = useState<Tab>("pick");
  const [queue, setQueue] = useState(initialQueue);
  const [lists, setLists] = useState(initialLists);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [packListId, setPackListId] = useState<string | null>(
    initialLists.find((l) => l.status === "OPEN")?.id ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "error" | "ok" } | null>(null);

  const refresh = useCallback(async () => {
    const [q, l] = await Promise.all([
      api<ConfirmedQueue>("/api/v1/admin/warehouse/queue"),
      api<{ lists: PickList[] }>("/api/v1/admin/warehouse/pick-lists"),
    ]);
    setQueue(q);
    setLists(l.lists);
  }, []);

  const run = useCallback(
    async (fn: () => Promise<string | void>) => {
      setBusy(true);
      setNotice(null);
      try {
        const ok = await fn();
        await refresh();
        if (ok) setNotice({ text: ok, tone: "ok" });
      } catch (e) {
        setNotice({ text: e instanceof Error ? e.message : s.errorFallback, tone: "error" });
      } finally {
        setBusy(false);
      }
    },
    [refresh, s],
  );

  const selectableToday = queue.todayOrderIds.filter((id) => {
    const row = queue.rows.find((r) => r.orderId === id);
    return row && !row.openPickListId;
  });

  const createList = (orderIds: string[]) =>
    run(async () => {
      await api<{ list: PickList }>("/api/v1/admin/warehouse/pick-lists", {
        method: "POST",
        body: JSON.stringify({ orderIds }),
      });
      setSelected(new Set());
      return interpolate(s.pickListCreated, { count: orderIds.length });
    });

  const completeList = (list: PickList) =>
    run(async () => {
      await api<{ list: PickList }>(`/api/v1/admin/warehouse/pick-lists/${list.id}/complete`, {
        method: "POST",
      });
      return s.pickListCompleted;
    });

  const toggleSelect = (orderId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });

  const activePackList = lists.find((l) => l.id === packListId) ?? null;

  const tick = (list: PickList, orderId: string, orderItemId: string, packed: boolean) =>
    run(async () => {
      const res = await api<{ list: PickList; orderPackCompleted: boolean }>(
        `/api/v1/admin/warehouse/pick-lists/${list.id}/pack`,
        { method: "POST", body: JSON.stringify({ orderId, orderItemId, packed }) },
      );
      setLists((prev) => prev.map((l) => (l.id === res.list.id ? res.list : l)));
      if (res.orderPackCompleted) {
        return s.packOrderCompleted;
      }
    });

  /** Scan-to-tick (wave 54-1): a scanned/typed code matches a pack
   *  item by SKU or by the barcode stamped on the item at list
   *  creation. Each scan ticks ONE matching unpacked item (the same
   *  variant can sit in several orders — the physical piece in hand
   *  belongs to the first unticked one). Manual checkbox ticking
   *  stays fully available alongside. */
  const scanTick = (code: string) => {
    const list = activePackList;
    if (!list || list.status !== "OPEN") return;
    const needle = code.trim();
    let alreadyPacked = false;
    for (const order of list.orders) {
      if (order.packCompletedAt) continue;
      for (const item of order.items) {
        if (item.sku !== needle && item.barcode !== needle) continue;
        if (item.packed) {
          alreadyPacked = true;
          continue;
        }
        void tick(list, order.orderId, item.orderItemId, true);
        return;
      }
    }
    setNotice({
      text: alreadyPacked
        ? interpolate(s.scanAlreadyTicked, { code: needle })
        : interpolate(s.scanNotFound, { code: needle }),
      tone: "error",
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex gap-2" role="tablist" aria-label={s.tabsAria}>
        <button type="button" role="tab" aria-selected={tab === "pick"} className={tabBtn + (tab === "pick" ? tabActive : tabIdle)} onClick={() => setTab("pick")}>
          {s.tabPick}
        </button>
        <button type="button" role="tab" aria-selected={tab === "pack"} className={tabBtn + (tab === "pack" ? tabActive : tabIdle)} onClick={() => setTab("pack")}>
          {s.tabPack}
        </button>
        <button type="button" role="tab" aria-selected={tab === "ship"} className={tabBtn + (tab === "ship" ? tabActive : tabIdle)} onClick={() => setTab("ship")}>
          {s.tabShip}
        </button>
      </div>

      {notice ? <Notice text={notice.text} tone={notice.tone} /> : null}

      {tab === "pick" ? (
        <section className="space-y-6">
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold">{interpolate(s.queueTitle, { count: queue.rows.length })}</h2>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={ghostBtn} disabled={busy || selectableToday.length === 0}
                  onClick={() => setSelected(new Set(selectableToday))}>
                  {interpolate(s.selectToday, { count: selectableToday.length })}
                </button>
                <button type="button" className={bigBtn} disabled={busy || selected.size === 0}
                  onClick={() => createList([...selected])}>
                  {interpolate(s.createList, { count: selected.size })}
                </button>
              </div>
            </div>
            {queue.rows.length === 0 ? (
              <EmptyState title={s.queueEmptyTitle} description={s.queueEmptyDesc} />
            ) : (
              <ul className="divide-y divide-border">
                {queue.rows.map((row) => {
                  const blocked = row.openPickListId !== null;
                  return (
                    <li key={row.orderId} className="flex items-center gap-4 py-3">
                      <input
                        type="checkbox"
                        className="h-8 w-8 shrink-0 accent-primary"
                        checked={selected.has(row.orderId)}
                        disabled={blocked || busy}
                        onChange={() => toggleSelect(row.orderId)}
                        aria-label={interpolate(s.selectAria, { orderNo: row.orderNo })}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="tnum font-mono text-lg font-bold">{row.orderNo}</p>
                        <p className="text-sm text-text-muted">
                          {interpolate(s.rowMeta, {
                            customer: row.customerName,
                            district: row.district ?? "",
                            itemCount: row.itemCount,
                            totalQty: row.totalQuantity,
                            total: formatBdt(row.totalPoisha),
                          })}
                        </p>
                      </div>
                      {row.packedPickListId ? (
                        <span className="rounded-full bg-success-soft px-3 py-1 text-sm font-semibold text-success-solid">{s.packedDoneBadge}</span>
                      ) : blocked ? (
                        <span className="rounded-full bg-warning-soft px-3 py-1 text-sm font-semibold text-warning-solid">{s.inPickListBadge}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          <div className="space-y-4">
            {lists.map((list) => (
              <Card key={list.id} className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg font-bold">
                    {s.pickListWord} <span className="font-mono">{list.id.slice(0, 8)}</span>{" "}
                    <span className={list.status === "OPEN" ? "text-warning-solid" : "text-success-solid"}>
                      {list.status === "OPEN" ? s.statusOpenSuffix : s.statusDoneSuffix}
                    </span>
                  </h3>
                  <div className="flex gap-2">
                    <button type="button" className={ghostBtn} disabled={busy}
                      onClick={() => { setPackListId(list.id); setTab("pack"); }}>
                      {s.packBtn}
                    </button>
                    {list.status === "OPEN" ? (
                      <button type="button" className={bigBtn} disabled={busy} onClick={() => completeList(list)}>
                        {s.completeBtn}
                      </button>
                    ) : null}
                  </div>
                </div>
                <p className="mb-3 text-sm text-text-muted">
                  {interpolate(s.listMetaOrders, {
                    count: list.orders.length,
                    created: new Date(list.createdAt).toLocaleString(intlLocale(locale)),
                  })}
                  {list.completedAt
                    ? interpolate(s.listMetaCompleted, { date: new Date(list.completedAt).toLocaleString(intlLocale(locale)) })
                    : ""}
                  <br />
                  {s.attestationNote}
                </p>
                <div className="space-y-3 md:hidden">
                  {list.lines.map((line) => (
                    <div key={line.variantId} className="rounded-xl border border-border bg-surface-2/40 p-3">
                      <p className="text-base font-medium">{line.productName}</p>
                      <p className="mt-1 font-mono text-sm text-text-muted">
                        {line.sku} · {line.binLocation ?? "—"}
                      </p>
                      <p className="tnum mt-1 text-base font-bold">× {line.totalQuantity}</p>
                      <span className="mt-2 flex flex-wrap gap-1.5">
                        {line.perOrder.map((p) => (
                          <span key={p.orderId} className="tnum rounded-full bg-surface-2 px-2.5 py-1 font-mono text-sm text-text-main">
                            {p.orderNo}: {p.quantity}
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="hidden overflow-x-auto md:block">
                  <table className="w-full min-w-[560px] text-left text-base">
                    <thead>
                      <tr className="border-b border-border text-sm text-text-muted">
                        <th className="py-2 pr-3">{s.colProduct}</th>
                        <th className="py-2 pr-3">{s.colSku}</th>
                        <th className="py-2 pr-3">{s.colBin}</th>
                        <th className="py-2 pr-3">{s.colTotal}</th>
                        <th className="py-2">{s.colPerOrder}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.lines.map((line) => (
                        <tr key={line.variantId} className="border-b border-border/60">
                          <td className="py-2 pr-3 font-medium">{line.productName}</td>
                          <td className="py-2 pr-3 font-mono">{line.sku}</td>
                          <td className="py-2 pr-3 font-mono">{line.binLocation ?? "—"}</td>
                          <td className="tnum py-2 pr-3 font-bold">× {line.totalQuantity}</td>
                          <td className="py-2">
                            <span className="flex flex-wrap gap-1.5">
                              {line.perOrder.map((p) => (
                                <span key={p.orderId} className="tnum rounded-full bg-surface-2 px-2.5 py-1 font-mono text-sm text-text-main">
                                  {p.orderNo}: {p.quantity}
                                </span>
                              ))}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ))}
            {lists.length === 0 ? <EmptyState title={s.listsEmptyTitle} description={s.listsEmptyDesc} /> : null}
          </div>
        </section>
      ) : null}

      {tab === "pack" ? (
        <section className="space-y-6">
          <div className="flex flex-wrap gap-2">
            {lists.filter((l) => l.status === "OPEN").map((l) => (
              <button key={l.id} type="button" onClick={() => setPackListId(l.id)}
                className={ghostBtn + (packListId === l.id ? " border-primary font-bold" : "")}>
                {interpolate(s.packListBtn, { id: l.id.slice(0, 8), count: l.orders.length })}
              </button>
            ))}
            {lists.every((l) => l.status !== "OPEN") ? (
              <div className="w-full"><EmptyState title={s.openListEmptyTitle} description={s.openListEmptyDesc} /></div>
            ) : null}
          </div>

          {activePackList && activePackList.status === "OPEN" ? (
            <Card className="p-4">
              <h3 className="mb-3 text-lg font-bold">{s.scanTickTitle}</h3>
              <BarcodeScanner onScan={scanTick} disabled={busy} />
              <p className="mt-2 text-sm text-text-muted">{s.scanTickDesc}</p>
            </Card>
          ) : null}

          {activePackList && activePackList.status === "OPEN"
            ? activePackList.orders.map((order) => {
                const doneCount = order.items.filter((i) => i.packed).length;
                const locked = order.packCompletedAt !== null;
                return (
                  <Card key={order.orderId} className="p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="tnum font-mono text-lg font-bold">{order.orderNo}</h3>
                      {locked ? (
                        <span className="rounded-full bg-success-soft px-3 py-1 text-sm font-semibold text-success-solid">
                          {s.packDoneNote}
                        </span>
                      ) : (
                        <span className="text-base font-semibold">{interpolate(s.tickCount, { done: doneCount, total: order.items.length })}</span>
                      )}
                    </div>
                    <p className="mb-3 text-sm text-text-muted">{order.customerName} · {order.district}</p>
                    <ul className="space-y-2">
                      {order.items.map((item) => (
                        <li key={item.orderItemId}>
                          <label className={`flex min-h-14 cursor-pointer items-center gap-4 rounded-xl border px-4 py-2 ${item.packed ? "border-success-solid/40 bg-success-soft" : "border-border"}`}>
                            <input
                              type="checkbox"
                              className="h-8 w-8 shrink-0 accent-success-solid"
                              checked={item.packed}
                              disabled={locked || busy}
                              onChange={(e) => tick(activePackList, order.orderId, item.orderItemId, e.target.checked)}
                            />
                            <span className="flex-1 text-base font-medium">{item.productName}</span>
                            <span className="font-mono text-sm text-text-muted">
                              {item.sku}
                              {item.barcode ? ` · ${item.barcode}` : ""}
                            </span>
                            <span className="tnum text-lg font-bold">× {item.quantity}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    {locked ? (
                      <p className="mt-2 text-sm text-text-muted">{s.tickLockedNote}</p>
                    ) : null}
                  </Card>
                );
              })
            : null}
        </section>
      ) : null}

      {tab === "ship" ? <ShipScan /> : null}
    </div>
  );
}

function ShipScan() {
  const { locale } = useLocale();
  const s = pick(locale, WAREHOUSE_STRINGS);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<ScanResolution | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ text: string; tone: "error" | "ok" } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const resolve = async (value: string) => {
    setBusy(true);
    setNotice(null);
    setResult(null);
    try {
      const data = await api<ScanResolution>(
        `/api/v1/admin/warehouse/ship/resolve?code=${encodeURIComponent(value)}`,
      );
      setResult(data);
      if (data.state === "not_found") {
        setNotice({ text: interpolate(s.shipNotFound, { code: data.code }), tone: "error" });
      }
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : s.errorFallback, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const handover = async (shipmentId: string) => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await api<{ recorded: boolean; alreadyRecorded: boolean }>(
        "/api/v1/admin/warehouse/ship/handover",
        { method: "POST", body: JSON.stringify({ shipmentId }) },
      );
      setNotice({
        text: res.alreadyRecorded ? s.handoverAlready : s.handoverRecorded,
        tone: "ok",
      });
      await resolve(code);
      inputRef.current?.focus();
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : s.errorFallback, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-6">
      <BarcodeScanner
        typedFallback={false}
        disabled={busy}
        onScan={(scanned) => {
          setCode(scanned);
          void resolve(scanned);
        }}
      />
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim()) void resolve(code.trim());
        }}
      >
        <input
          ref={inputRef}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={s.shipScanPlaceholder}
          className="min-h-14 flex-1 rounded-xl border border-border bg-card px-4 font-mono text-xl"
          aria-label={s.shipScanAria}
        />
        <button type="submit" className={bigBtn} disabled={busy || !code.trim()}>
          {s.searchBtn}
        </button>
      </form>

      {notice ? <Notice text={notice.text} tone={notice.tone} /> : null}

      {result?.state === "found" ? (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="tnum font-mono text-xl font-bold">{result.shipment.trackingId ?? result.shipment.shipmentId}</h3>
            <span className="rounded-full bg-surface-2 px-3 py-1 font-semibold text-text-main">{result.shipment.status}</span>
          </div>
          <dl className="grid gap-1 text-base sm:grid-cols-2">
            <div>{s.labelCourier} <strong>{result.shipment.provider}</strong></div>
            <div>
              {s.labelOrder}{" "}
              <a className="font-mono font-bold underline" href={`/admin/orders/${result.order.orderId}`}>
                {result.order.orderNo}
              </a>{" "}
              ({result.order.orderStatus})
            </div>
            <div>{s.labelCustomer} {result.order.customerName} · {result.order.district}</div>
            <div>COD: <strong className="tnum">{formatBdt(result.shipment.codAmountPoisha)}</strong></div>
          </dl>
          {result.shipment.packedPickListId ? (
            <p className="mt-3 rounded-xl bg-success-soft px-4 py-2 font-semibold text-success-solid">
              {interpolate(s.packedRecord, { id: result.shipment.packedPickListId.slice(0, 8) })}
            </p>
          ) : (
            <p className="mt-3 rounded-xl bg-warning-soft px-4 py-2 font-semibold text-warning-solid">
              {s.noPackedRecord}
            </p>
          )}
          <div className="mt-4">
            {result.shipment.canHandover ? (
              <>
                <button type="button" className={bigBtn} disabled={busy}
                  onClick={() => void handover(result.shipment.shipmentId)}>
                  {s.handoverBtn}
                </button>
                <p className="mt-2 text-sm text-text-muted">{s.handoverNote}</p>
              </>
            ) : result.shipment.handoverAt ? (
              <p className="font-semibold text-success-solid">
                {interpolate(s.handoverRecordedAt, {
                  date: new Date(result.shipment.handoverAt).toLocaleString(intlLocale(locale)),
                })}
              </p>
            ) : (
              <p className="font-semibold">
                {interpolate(s.handoverNotNeeded, { status: result.shipment.status })}
              </p>
            )}
          </div>
        </Card>
      ) : null}

      {result?.state === "not_booked" ? (
        <article className="rounded-2xl border border-warning-solid/40 bg-warning-soft p-5">
          <h3 className="tnum mb-1 font-mono text-xl font-bold">{result.order.orderNo}</h3>
          <p className="mb-4 text-base">
            {interpolate(s.notBookedDesc, { customer: result.order.customerName, district: result.order.district ?? "" })}
          </p>
          <a className={bigBtn} href={result.workspacePath}>
            {s.bookInWorkspace}
          </a>
        </article>
      ) : null}
    </section>
  );
}
