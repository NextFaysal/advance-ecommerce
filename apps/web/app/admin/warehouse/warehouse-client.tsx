"use client";

/**
 * Warehouse client — ADV-21 (doc 22).
 *
 * Scanner-first UI: three big tabs (পিক লিস্ট / প্যাক / শিপ স্ক্যান),
 * 56px+ touch targets, monospace code inputs with autofocus and
 * Enter-to-submit. All state lives server-side (orders, shipments,
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
import { formatBdt } from "@/checkout/pricing";
import type { PickList } from "@/warehouse/pick-lists";
import type { ConfirmedQueue } from "@/warehouse/queue";
import type { ScanResolution } from "@/warehouse/ship-scan";

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
  "inline-flex min-h-14 items-center justify-center rounded-xl bg-primary px-6 text-lg font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtn =
  "inline-flex min-h-14 items-center justify-center rounded-xl border border-border bg-card px-5 text-base font-semibold text-text-main disabled:cursor-not-allowed disabled:opacity-50";

function Notice({ text, tone }: { text: string; tone: "error" | "ok" }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl border px-4 py-3 text-base ${
        tone === "error"
          ? "border-red-300 bg-red-50 text-red-800"
          : "border-emerald-300 bg-emerald-50 text-emerald-800"
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
        setNotice({ text: e instanceof Error ? e.message : "ত্রুটি হয়েছে", tone: "error" });
      } finally {
        setBusy(false);
      }
    },
    [refresh],
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
      return `পিক লিস্ট তৈরি হয়েছে — ${orderIds.length}টি অর্ডার।`;
    });

  const completeList = (list: PickList) =>
    run(async () => {
      await api<{ list: PickList }>(`/api/v1/admin/warehouse/pick-lists/${list.id}/complete`, {
        method: "POST",
      });
      return "পিক লিস্ট সম্পন্ন হিসেবে চিহ্নিত হয়েছে (কর্মীর নিশ্চিতকরণ — স্টক নড়েনি)।";
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
        return "এই অর্ডারের প্যাক সম্পন্ন — টাইমলাইনে নোট লেখা হয়েছে।";
      }
    });

  return (
    <div className="space-y-5">
      <div className="flex gap-2" role="tablist" aria-label="ওয়্যারহাউস ধাপ">
        <button type="button" role="tab" aria-selected={tab === "pick"} className={tabBtn + (tab === "pick" ? tabActive : tabIdle)} onClick={() => setTab("pick")}>
          ১ · পিক লিস্ট
        </button>
        <button type="button" role="tab" aria-selected={tab === "pack"} className={tabBtn + (tab === "pack" ? tabActive : tabIdle)} onClick={() => setTab("pack")}>
          ২ · প্যাক
        </button>
        <button type="button" role="tab" aria-selected={tab === "ship"} className={tabBtn + (tab === "ship" ? tabActive : tabIdle)} onClick={() => setTab("ship")}>
          ৩ · শিপ স্ক্যান
        </button>
      </div>

      {notice ? <Notice text={notice.text} tone={notice.tone} /> : null}

      {tab === "pick" ? (
        <section className="space-y-5">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-bold">কনফার্মড অর্ডারের কিউ ({queue.rows.length})</h2>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={ghostBtn} disabled={busy || selectableToday.length === 0}
                  onClick={() => setSelected(new Set(selectableToday))}>
                  আজকের সব কনফার্মড ({selectableToday.length})
                </button>
                <button type="button" className={bigBtn} disabled={busy || selected.size === 0}
                  onClick={() => createList([...selected])}>
                  পিক লিস্ট তৈরি ({selected.size})
                </button>
              </div>
            </div>
            {queue.rows.length === 0 ? (
              <p className="text-text-muted">এখন কোনো CONFIRMED অর্ডার অপেক্ষা করছে না।</p>
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
                        aria-label={`${row.orderNo} সিলেক্ট`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-lg font-bold">{row.orderNo}</p>
                        <p className="text-sm text-text-muted">
                          {row.customerName} · {row.district} · {row.itemCount} আইটেম, মোট {row.totalQuantity} পিস · {formatBdt(row.totalPoisha)}
                        </p>
                      </div>
                      {row.packedPickListId ? (
                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">প্যাক সম্পন্ন</span>
                      ) : blocked ? (
                        <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-800">পিক লিস্টে আছে</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="space-y-4">
            {lists.map((list) => (
              <article key={list.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="text-lg font-bold">
                    পিক লিস্ট <span className="font-mono">{list.id.slice(0, 8)}</span>{" "}
                    <span className={list.status === "OPEN" ? "text-amber-600" : "text-emerald-600"}>
                      {list.status === "OPEN" ? "· চলমান" : "· সম্পন্ন"}
                    </span>
                  </h3>
                  <div className="flex gap-2">
                    <button type="button" className={ghostBtn} disabled={busy}
                      onClick={() => { setPackListId(list.id); setTab("pack"); }}>
                      প্যাক করুন
                    </button>
                    {list.status === "OPEN" ? (
                      <button type="button" className={bigBtn} disabled={busy} onClick={() => completeList(list)}>
                        সম্পন্ন করুন
                      </button>
                    ) : null}
                  </div>
                </div>
                <p className="mb-3 text-sm text-text-muted">
                  {list.orders.length}টি অর্ডার · তৈরি: {new Date(list.createdAt).toLocaleString("bn-BD")}
                  {list.completedAt ? ` · সম্পন্ন: ${new Date(list.completedAt).toLocaleString("bn-BD")}` : ""}
                  <br />
                  সম্পন্ন করা শুধু কর্মীর নিশ্চিতকরণ — এতে স্টক নড়ে না; স্টক অর্ডার তৈরির সময়ই রিজার্ভ হয়েছে।
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-base">
                    <thead>
                      <tr className="border-b border-border text-sm text-text-muted">
                        <th className="py-2 pr-3">পণ্য</th>
                        <th className="py-2 pr-3">SKU</th>
                        <th className="py-2 pr-3">বিন</th>
                        <th className="py-2 pr-3">মোট</th>
                        <th className="py-2">অর্ডার অনুযায়ী ভাগ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.lines.map((line) => (
                        <tr key={line.variantId} className="border-b border-border/60">
                          <td className="py-2 pr-3 font-medium">{line.productName}</td>
                          <td className="py-2 pr-3 font-mono">{line.sku}</td>
                          <td className="py-2 pr-3 font-mono">{line.binLocation ?? "—"}</td>
                          <td className="py-2 pr-3 font-bold">× {line.totalQuantity}</td>
                          <td className="py-2">
                            <span className="flex flex-wrap gap-1.5">
                              {line.perOrder.map((p) => (
                                <span key={p.orderId} className="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-sm">
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
              </article>
            ))}
            {lists.length === 0 ? <p className="text-text-muted">এখনো কোনো পিক লিস্ট তৈরি হয়নি।</p> : null}
          </div>
        </section>
      ) : null}

      {tab === "pack" ? (
        <section className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {lists.filter((l) => l.status === "OPEN").map((l) => (
              <button key={l.id} type="button" onClick={() => setPackListId(l.id)}
                className={ghostBtn + (packListId === l.id ? " border-primary font-bold" : "")}>
                পিক লিস্ট {l.id.slice(0, 8)} ({l.orders.length} অর্ডার)
              </button>
            ))}
            {lists.every((l) => l.status !== "OPEN") ? (
              <p className="text-text-muted">কোনো চলমান পিক লিস্ট নেই — আগে পিক লিস্ট ট্যাব থেকে একটি তৈরি করুন।</p>
            ) : null}
          </div>

          {activePackList && activePackList.status === "OPEN"
            ? activePackList.orders.map((order) => {
                const doneCount = order.items.filter((i) => i.packed).length;
                const locked = order.packCompletedAt !== null;
                return (
                  <article key={order.orderId} className="rounded-2xl border border-border bg-card p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-mono text-lg font-bold">{order.orderNo}</h3>
                      {locked ? (
                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-800">
                          প্যাক সম্পন্ন — টাইমলাইনে নোট লেখা হয়েছে
                        </span>
                      ) : (
                        <span className="text-base font-semibold">{doneCount}/{order.items.length} টিক</span>
                      )}
                    </div>
                    <p className="mb-3 text-sm text-text-muted">{order.customerName} · {order.district}</p>
                    <ul className="space-y-2">
                      {order.items.map((item) => (
                        <li key={item.orderItemId}>
                          <label className={`flex min-h-14 cursor-pointer items-center gap-4 rounded-xl border px-4 py-2 ${item.packed ? "border-emerald-300 bg-emerald-50" : "border-border"}`}>
                            <input
                              type="checkbox"
                              className="h-8 w-8 shrink-0 accent-emerald-600"
                              checked={item.packed}
                              disabled={locked || busy}
                              onChange={(e) => tick(activePackList, order.orderId, item.orderItemId, e.target.checked)}
                            />
                            <span className="flex-1 text-base font-medium">{item.productName}</span>
                            <span className="font-mono text-sm text-text-muted">{item.sku}</span>
                            <span className="text-lg font-bold">× {item.quantity}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    {locked ? (
                      <p className="mt-2 text-sm text-text-muted">
                        এই অর্ডারের টিক এখন লক — প্যাক সম্পন্নের নোট অর্ডার টাইমলাইনে স্থায়ী রেকর্ড।
                      </p>
                    ) : null}
                  </article>
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
        setNotice({ text: `“${data.code}” দিয়ে কোনো শিপমেন্ট বা অর্ডার পাওয়া যায়নি।`, tone: "error" });
      }
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : "ত্রুটি হয়েছে", tone: "error" });
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
        text: res.alreadyRecorded
          ? "ম্যানুয়াল হস্তান্তর আগেই রেকর্ড করা আছে।"
          : "কুরিয়ারে হস্তান্তর (ম্যানুয়াল) টাইমলাইনে রেকর্ড হয়েছে।",
        tone: "ok",
      });
      await resolve(code);
      inputRef.current?.focus();
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : "ত্রুটি হয়েছে", tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5">
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
          placeholder="ট্র্যাকিং কোড / অর্ডার নম্বর স্ক্যান করুন"
          className="min-h-14 flex-1 rounded-xl border border-border bg-card px-4 font-mono text-xl"
          aria-label="ট্র্যাকিং কোড বা অর্ডার নম্বর"
        />
        <button type="submit" className={bigBtn} disabled={busy || !code.trim()}>
          খুঁজুন
        </button>
      </form>

      {notice ? <Notice text={notice.text} tone={notice.tone} /> : null}

      {result?.state === "found" ? (
        <article className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-mono text-xl font-bold">{result.shipment.trackingId ?? result.shipment.shipmentId}</h3>
            <span className="rounded-full bg-slate-100 px-3 py-1 font-semibold">{result.shipment.status}</span>
          </div>
          <dl className="grid gap-1 text-base sm:grid-cols-2">
            <div>কুরিয়ার: <strong>{result.shipment.provider}</strong></div>
            <div>
              অর্ডার:{" "}
              <a className="font-mono font-bold underline" href={`/admin/orders/${result.order.orderId}`}>
                {result.order.orderNo}
              </a>{" "}
              ({result.order.orderStatus})
            </div>
            <div>গ্রাহক: {result.order.customerName} · {result.order.district}</div>
            <div>COD: <strong>{formatBdt(result.shipment.codAmountPoisha)}</strong></div>
          </dl>
          {result.shipment.packedPickListId ? (
            <p className="mt-3 rounded-xl bg-emerald-50 px-4 py-2 font-semibold text-emerald-800">
              ✓ এই অর্ডারের প্যাক সম্পন্ন (পিক লিস্ট {result.shipment.packedPickListId.slice(0, 8)})
            </p>
          ) : (
            <p className="mt-3 rounded-xl bg-amber-50 px-4 py-2 font-semibold text-amber-800">
              ⚠ এই অর্ডারের প্যাক সম্পন্নের রেকর্ড নেই
            </p>
          )}
          <div className="mt-4">
            {result.shipment.canHandover ? (
              <>
                <button type="button" className={bigBtn} disabled={busy}
                  onClick={() => void handover(result.shipment.shipmentId)}>
                  কুরিয়ারে হস্তান্তর (ম্যানুয়াল)
                </button>
                <p className="mt-2 text-sm text-text-muted">
                  এটি শুধু অর্ডার টাইমলাইনে একটি ম্যানুয়াল নোট লিখবে — কুরিয়ারের সিস্টেমে কোনো
                  ইভেন্ট পাঠানো হয় না। আসল পিক-আপ স্ট্যাটাস কুরিয়ার সিঙ্ক থেকেই আসবে।
                </p>
              </>
            ) : result.shipment.handoverAt ? (
              <p className="font-semibold text-emerald-700">
                ম্যানুয়াল হস্তান্তর রেকর্ড আছে — {new Date(result.shipment.handoverAt).toLocaleString("bn-BD")}
              </p>
            ) : (
              <p className="font-semibold">
                কুরিয়ার ইতিমধ্যে পিক করেছে বা শিপমেন্ট এগিয়ে গেছে (স্ট্যাটাস: {result.shipment.status}) —
                ম্যানুয়াল হস্তান্তর লাগবে না।
              </p>
            )}
          </div>
        </article>
      ) : null}

      {result?.state === "not_booked" ? (
        <article className="rounded-2xl border border-amber-300 bg-amber-50 p-5">
          <h3 className="mb-1 font-mono text-xl font-bold">{result.order.orderNo}</h3>
          <p className="mb-4 text-base">
            এই অর্ডারের এখনো কোনো শিপমেন্ট বুকিং হয়নি ({result.order.customerName} · {result.order.district})।
            বুকিং এখানে হয় না — অর্ডার ওয়ার্কস্পেসের শিপমেন্ট প্যানেল থেকে বুক করুন।
          </p>
          <a className={bigBtn} href={result.workspacePath}>
            অর্ডার ওয়ার্কস্পেসে বুকিং করুন →
          </a>
        </article>
      ) : null}
    </section>
  );
}
