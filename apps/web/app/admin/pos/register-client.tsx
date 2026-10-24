"use client";

/**
 * POS register screen — Agent 38, on the src/pos contracts (Agent 14).
 *
 * Shifts open/close through the real API (/api/v1/admin/pos/shift ->
 * src/pos/store.ts); the server page seeds the current shift + its
 * recorded sales from the DB. Sale MATH stays pure register logic
 * (saleTotal / createSale / expectedCashPoisha / buildPosReceipt).
 *
 * Offline sync is REAL, not a design note: completing a sale writes it
 * to the durable browser queue (src/pos/offline-queue.ts, localStorage)
 * with its client idempotency key, then flushes to POST
 * /api/v1/admin/pos/sale (src/pos/sync.ts). Online, the flush lands
 * immediately and the sale shows SYNCED; offline, it stays
 * QUEUED_OFFLINE in the queue — across reloads — and syncs when the
 * network returns (auto-flush on mount + on the `online` event + a
 * manual button). The server dedupes on the idempotencyKey, so a
 * retry after a lost response can never double-record. A shift cannot
 * be closed while its sales are still queued: the server counts
 * expected cash from its own records, and a queued sale is not in
 * them yet. A POS sale is a DB record — it does NOT create a
 * storefront Order (a walk-in sale has no customer phone/address).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Money, formatPoisha } from "@/components/ui/money";
import { DataTable } from "@/components/ui/table";
import {
  buildPosReceipt,
  changeDue,
  createSale,
  expectedCashPoisha,
  saleTotal,
} from "@/pos/register";
import { enqueuePosSale, loadQueuedPosSales } from "@/pos/offline-queue";
import { flushQueuedPosSales } from "@/pos/sync";
import type {
  CreatePosSaleInput,
  PosPaymentMethod,
  PosReceiptData,
  PosSale,
  PosSaleLine,
  PosShift,
} from "@/pos/types";

export interface PosCatalogEntry {
  variantId: string;
  sku: string;
  productName: string;
  pricePoisha: number;
  stock: number;
}

const PAYMENT_METHODS: { id: PosPaymentMethod; labelBn: string }[] = [
  { id: "CASH", labelBn: "নগদ" },
  { id: "BKASH", labelBn: "বিকাশ" },
  { id: "NAGAD", labelBn: "নগদ (মোবাইল)" },
  { id: "CARD", labelBn: "কার্ড / ম্যানুয়াল" },
];

/** "123.45" -> 12345 poisha with integer math only. Null when invalid. */
function takaInputToPoisha(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const taka = Number(match[1]);
  const paisa = Number((match[2] ?? "").padEnd(2, "0") || "0");
  return taka * 100 + paisa;
}

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // UUID-v4 fallback: the sale API validates idempotencyKey as a UUID,
  // so a non-UUID fallback key would make the sale unsyncable forever.
  const bytes = new Uint8Array(16);
  (crypto as unknown as Crypto).getRandomValues(bytes);
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function dhakaTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit" });
}

export default function PosRegisterClient({
  register,
  catalog,
  initialShift,
  initialSales,
}: {
  register: { id: string; name: string };
  catalog: PosCatalogEntry[];
  initialShift: PosShift | null;
  initialSales: PosSale[];
}) {
  const [shift, setShift] = useState<PosShift | null>(initialShift);
  const [sales, setSales] = useState<PosSale[]>(initialSales);
  // Offline queue mirror: localStorage (src/pos/offline-queue.ts) is
  // the source of truth; this state is its render copy — locally built
  // display sales with QUEUED_OFFLINE status, hydrated on mount.
  const [pendingSales, setPendingSales] = useState<PosSale[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const syncingRef = useRef(false);
  const [lastClosedShift, setLastClosedShift] = useState<PosShift | null>(null);
  const [lines, setLines] = useState<PosSaleLine[]>([]);
  const [query, setQuery] = useState("");
  const [scanCode, setScanCode] = useState("");
  const [discountTaka, setDiscountTaka] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>("CASH");
  const [tenderedTaka, setTenderedTaka] = useState("");
  const [floatTaka, setFloatTaka] = useState("1000");
  const [countedTaka, setCountedTaka] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [receipt, setReceipt] = useState<PosReceiptData | null>(null);
  const [lastChangePoisha, setLastChangePoisha] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stockOf = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of catalog) map.set(item.variantId, item.stock);
    return map;
  }, [catalog]);

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (item) => item.sku.toLowerCase().includes(q) || item.productName.toLowerCase().includes(q),
    );
  }, [catalog, query]);

  const discountPoisha = takaInputToPoisha(discountTaka) ?? 0;
  const totalsInput: CreatePosSaleInput = {
    shiftId: shift?.id ?? "none",
    registerId: register.id,
    idempotencyKey: "00000000-0000-4000-8000-000000000000",
    lines,
    discountPoisha,
    paymentMethod,
    offline: true,
  };
  const totals = lines.length > 0 ? saleTotal(totalsInput) : null;
  const totalPoisha = totals?.ok ? totals.totalPoisha : 0;
  const subtotalPoisha = totals?.ok ? totals.subtotalPoisha : 0;
  const tenderedPoisha = takaInputToPoisha(tenderedTaka);
  const change =
    paymentMethod === "CASH" && tenderedPoisha !== null && lines.length > 0
      ? changeDue(totalPoisha, tenderedPoisha)
      : null;

  function flashError(text: string) {
    setError(text);
    setMessage(null);
  }

  function refreshPending() {
    setPendingSales(loadQueuedPosSales().map((q) => q.sale));
  }

  /**
   * Flush the offline queue to the sale API. Server-confirmed sales
   * (fresh or idempotent duplicates) move into `sales` as SYNCED;
   * failures stay queued and the first error is surfaced in the sync
   * panel. Re-entrant calls collapse into the running flush.
   */
  async function flushQueue(): Promise<void> {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const report = await flushQueuedPosSales();
      if (report.synced.length > 0) {
        setSales((prev) => {
          const byKey = new Map(prev.map((s) => [s.idempotencyKey, s]));
          for (const entry of report.synced) byKey.set(entry.sale.idempotencyKey, entry.sale);
          return [...byKey.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        });
      }
      setSyncError(report.failed.length > 0 ? (report.failed[0]?.message ?? null) : null);
      refreshPending();
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }

  // Mount-once: hydrate the queue mirror, flush whatever a previous
  // session left behind, and keep flushing on reconnect. The closure
  // only touches stable setters and live localStorage reads, so the
  // first-render instance stays correct for the component's lifetime.
  useEffect(() => {
    refreshPending();
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    void flushQueue();
    const onOnline = () => {
      setOnline(true);
      void flushQueue();
    };
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addItem(item: PosCatalogEntry) {
    setError(null);
    if (item.stock <= 0) {
      flashError(`"${item.productName}" — স্টক নেই, কার্টে যোগ করা যাবে না।`);
      return;
    }
    setLines((prev) => {
      const existing = prev.find((l) => l.variantId === item.variantId);
      if (existing) {
        if (existing.quantity >= item.stock) {
          flashError(`"${item.productName}" — স্টকের বেশি যোগ করা যাবে না (স্টক ${item.stock})।`);
          return prev;
        }
        return prev.map((l) => (l.variantId === item.variantId ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        { variantId: item.variantId, sku: item.sku, productName: item.productName, quantity: 1, unitPricePoisha: item.pricePoisha },
      ];
    });
  }

  function handleScan() {
    const code = scanCode.trim();
    if (!code) return;
    const item = catalog.find((c) => c.sku === code);
    if (!item) {
      flashError(`SKU "${code}" ক্যাটালগে পাওয়া যায়নি — হাতে এন্ট্রি দিন।`);
      return;
    }
    addItem(item);
    setScanCode("");
  }

  function setQuantity(variantId: string, quantity: number) {
    const stock = stockOf.get(variantId) ?? 0;
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.variantId !== variantId)
        : prev.map((l) => (l.variantId === variantId ? { ...l, quantity: Math.min(quantity, Math.max(stock, 1)) } : l)),
    );
  }

  async function completeSale() {
    if (!shift) {
      flashError("আগে শিফট খুলুন — খোলা শিফট ছাড়া বিক্রি হবে না।");
      return;
    }
    if (lines.length === 0) {
      flashError("কার্ট খালি — আগে পণ্য যোগ করুন।");
      return;
    }
    if (takaInputToPoisha(discountTaka) === null) {
      flashError("ছাড়ের পরিমাণ ঠিকমতো লিখুন (যেমন 50 বা 50.50)।");
      return;
    }
    const input: CreatePosSaleInput = {
      shiftId: shift.id,
      registerId: register.id,
      idempotencyKey: newIdempotencyKey(),
      lines,
      discountPoisha,
      paymentMethod,
      tenderedPoisha: paymentMethod === "CASH" ? (tenderedPoisha ?? undefined) : undefined,
      offline: true,
    };
    const result = createSale(input, {
      id: `pos_local_${input.idempotencyKey}`,
      createdAt: new Date().toISOString(),
    });
    if (!result.ok) {
      flashError(result.error);
      return;
    }
    // Durable FIRST: the sale lands in the localStorage queue before
    // any network attempt, so going offline (or the tab closing) at
    // this exact moment can never lose a completed sale.
    enqueuePosSale({ input, sale: result.sale });
    refreshPending();
    setReceipt(buildPosReceipt(result.sale));
    setLastChangePoisha(
      paymentMethod === "CASH" && tenderedPoisha !== null ? tenderedPoisha - result.sale.totalPoisha : null,
    );
    setLines([]);
    setDiscountTaka("");
    setTenderedTaka("");
    setError(null);
    await flushQueue();
    const stillQueued = loadQueuedPosSales().some((q) => q.input.idempotencyKey === input.idempotencyKey);
    setMessage(
      stillQueued
        ? `বিক্রি অফলাইনে জমা হয়েছে — মোট ${formatPoisha(result.sale.totalPoisha)}। নেটওয়ার্ক ফিরলেই সিঙ্ক হবে।`
        : `বিক্রি সম্পন্ন ও সিঙ্ক হয়েছে — মোট ${formatPoisha(result.sale.totalPoisha)}।`,
    );
  }

  async function openShift() {
    const floatPoisha = takaInputToPoisha(floatTaka);
    if (floatPoisha === null) {
      flashError("শুরুর ফ্লোট ঠিকমতো লিখুন।");
      return;
    }
    try {
      const res = await fetch("/api/v1/admin/pos/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "open", registerId: register.id, openingFloatPoisha: floatPoisha }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { shift?: PosShift };
        error?: { message?: string };
      };
      if (!res.ok || !body.data?.shift) {
        flashError(body.error?.message ?? "শিফট খোলা যায়নি — আবার চেষ্টা করুন।");
        return;
      }
      setShift(body.data.shift);
      setSales([]);
      setLastClosedShift(null);
      setError(null);
      setMessage(`শিফট খোলা হয়েছে — ফ্লোট ${formatPoisha(floatPoisha)}।`);
    } catch {
      flashError(
        "সার্ভারে পৌঁছানো যাচ্ছে না — শিফট খুলতে নেটওয়ার্ক লাগবে (বিক্রি অফলাইনে জমা হয়, কিন্তু শিফট সার্ভারেই খোলে)।",
      );
    }
  }

  async function closeCurrentShift() {
    if (!shift) return;
    const counted = takaInputToPoisha(countedTaka);
    if (counted === null) {
      flashError("গণনা করা নগদ ঠিকমতো লিখুন।");
      return;
    }
    // The server counts expected cash from ITS records; a sale still
    // sitting in this browser's queue is invisible to it. Flush first,
    // and refuse to close while this shift has queued sales — closing
    // anyway would misstate the drawer.
    await flushQueue();
    const stillPending = loadQueuedPosSales().filter((q) => q.input.shiftId === shift.id);
    if (stillPending.length > 0) {
      flashError(
        `এই শিফটের ${stillPending.length}টি বিক্রি এখনো সিঙ্ক হয়নি — আগে সিঙ্ক করুন (নেটওয়ার্ক দেখুন), তারপর শিফট বন্ধ করুন।`,
      );
      return;
    }
    try {
      const res = await fetch("/api/v1/admin/pos/shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "close",
          shiftId: shift.id,
          countedCashPoisha: counted,
          note: closeNote || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { shift?: PosShift };
        error?: { message?: string };
      };
      if (!res.ok || !body.data?.shift) {
        flashError(body.error?.message ?? "শিফট বন্ধ করা যায়নি — আবার চেষ্টা করুন।");
        return;
      }
      setLastClosedShift(body.data.shift);
      setShift(null);
      setCountedTaka("");
      setCloseNote("");
      setError(null);
      setMessage("শিফট বন্ধ হয়েছে — হিসাব নিচে দেখুন। পার্থক্য থাকলে তা যেমন ছিল তেমনই রিপোর্ট করা হয়েছে, মিলিয়ে দেওয়া হয়নি।");
    } catch {
      flashError("সার্ভারে পৌঁছানো যাচ্ছে না — শিফট বন্ধ করতে নেটওয়ার্ক লাগবে।");
    }
  }

  // Server-recorded sales + still-queued local sales (deduped by
  // idempotencyKey — a just-flushed sale appears in both for one
  // render). Queued sales count toward expected cash: the money is in
  // the drawer whether or not the server has seen it yet.
  const displaySales = useMemo(() => {
    const serverKeys = new Set(sales.map((s) => s.idempotencyKey));
    const queued = pendingSales.filter((p) => !serverKeys.has(p.idempotencyKey));
    return [...sales, ...queued].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [sales, pendingSales]);

  const expectedCash = shift ? expectedCashPoisha(shift, displaySales) : 0;
  const cashSalesPoisha = shift ? expectedCash - shift.openingFloatPoisha : 0;

  const saleRows = displaySales.map((sale) => ({
    time: dhakaTime(sale.createdAt),
    items: String(sale.lines.reduce((sum, l) => sum + l.quantity, 0)),
    method: PAYMENT_METHODS.find((m) => m.id === sale.paymentMethod)?.labelBn ?? sale.paymentMethod,
    total: <Money poisha={sale.totalPoisha} />,
    status: (
      <Badge tone={sale.status === "QUEUED_OFFLINE" ? "warning" : sale.status === "VOIDED" ? "danger" : "success"}>
        {sale.status === "QUEUED_OFFLINE" ? "সিঙ্ক বাকি" : sale.status === "VOIDED" ? "বাতিল" : "সিঙ্ক হয়েছে"}
      </Badge>
    ),
  }));

  return (
    <div>
      {message ? (
        <p role="status" className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>
      ) : null}
      {error ? (
        <p role="alert" className="mb-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ---- Product picker + cart ---- */}
        <Card className="p-4 lg:col-span-2">
          <h2 className="text-lg font-semibold">{register.name} — পণ্য খুঁজুন / স্ক্যান করুন</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <div className="min-w-52 flex-1">
              <Input label="বারকোড / SKU স্ক্যান" placeholder="SKU লিখে Enter চাপুন" value={scanCode}
                onChange={(e) => setScanCode(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleScan(); }} />
            </div>
            <div className="min-w-52 flex-1">
              <Input label="নাম বা SKU দিয়ে খুঁজুন" placeholder="যেমন: শাড়ি / JAMDANI" value={query}
                onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3">
            {filteredCatalog.map((item) => (
              <button key={item.variantId} type="button" onClick={() => addItem(item)}
                className="rounded-md border border-border p-3 text-left hover:bg-surface-2 disabled:opacity-50"
                disabled={item.stock <= 0}>
                <span className="block text-sm font-medium">{item.productName}</span>
                <span className="mt-1 block font-mono text-xs text-text-muted">{item.sku}</span>
                <span className="mt-1 flex items-center justify-between">
                  <Money poisha={item.pricePoisha} />
                  <span className="text-xs text-text-muted">{item.stock > 0 ? `স্টক ${item.stock}` : "স্টক নেই"}</span>
                </span>
              </button>
            ))}
          </div>
          {filteredCatalog.length === 0 ? (
            <p className="mt-3 text-sm text-text-muted">কোনো পণ্য মিলছে না — অন্য নাম বা SKU দিয়ে চেষ্টা করুন।</p>
          ) : null}

          <h3 className="mt-6 text-base font-semibold">বর্তমান বিক্রি</h3>
          {lines.length === 0 ? (
            <EmptyState title="কার্ট খালি" description="উপরের তালিকা থেকে পণ্যে চাপ দিলে বা SKU স্ক্যান করলে এখানে যোগ হবে।" />
          ) : (
            <div className="mt-2 space-y-2">
              {lines.map((line) => (
                <div key={line.variantId} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2">
                  <span className="min-w-40 flex-1">
                    <span className="block text-sm font-medium">{line.productName}</span>
                    <span className="font-mono text-xs text-text-muted">{line.sku}</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <Button size="sm" variant="outline" onClick={() => setQuantity(line.variantId, line.quantity - 1)}>−</Button>
                    <span className="w-8 text-center font-mono tabular-nums">{line.quantity}</span>
                    <Button size="sm" variant="outline" onClick={() => setQuantity(line.variantId, line.quantity + 1)}>+</Button>
                  </span>
                  <Money poisha={line.unitPricePoisha * line.quantity} />
                  <Button size="sm" variant="ghost" onClick={() => setQuantity(line.variantId, 0)}>সরান</Button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Input label="ছাড় (টাকা)" placeholder="0" value={discountTaka} onChange={(e) => setDiscountTaka(e.target.value)} />
            <div>
              <span className="mb-1 block text-xs font-medium text-text-muted">পেমেন্ট মাধ্যম</span>
              <div className="flex flex-wrap gap-1">
                {PAYMENT_METHODS.map((method) => (
                  <Button key={method.id} size="sm" variant={paymentMethod === method.id ? "primary" : "outline"}
                    onClick={() => setPaymentMethod(method.id)}>
                    {method.labelBn}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {paymentMethod === "CASH" ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Input label="ক্রেতার দেওয়া নগদ (টাকা)" placeholder="যেমন 1000" value={tenderedTaka}
                onChange={(e) => setTenderedTaka(e.target.value)} />
              <p className="self-end text-sm">
                ফেরত: {change?.ok ? <Money poisha={change.changePoisha} /> : change ? <span className="text-rose-600">{change.error}</span> : "—"}
              </p>
            </div>
          ) : null}

          <div className="mt-4 space-y-1 border-t border-border pt-3 text-sm">
            <p className="flex justify-between"><span>উপমোট</span><Money poisha={subtotalPoisha} /></p>
            <p className="flex justify-between"><span>ছাড়</span><span>− <Money poisha={discountPoisha} /></span></p>
            <p className="flex justify-between text-base font-bold"><span>মোট</span><Money poisha={totalPoisha} /></p>
            {totals && !totals.ok ? <p className="text-rose-600">{totals.error}</p> : null}
          </div>
          <Button variant="gradient" className="mt-3 w-full" onClick={completeSale} disabled={!shift || lines.length === 0}>
            বিক্রি সম্পন্ন করুন {!shift ? "(আগে শিফট খুলুন)" : ""}
          </Button>
          {lastChangePoisha !== null ? (
            <p className="mt-2 text-sm">শেষ বিক্রিতে ফেরত: <Money poisha={lastChangePoisha} /></p>
          ) : null}
        </Card>

        {/* ---- Shift panel + receipt ---- */}
        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="text-lg font-semibold">শিফট</h2>
            {shift ? (
              <div className="mt-2 space-y-1 text-sm">
                <p className="flex justify-between"><span>অবস্থা</span><Badge tone="success">খোলা</Badge></p>
                <p className="flex justify-between"><span>খোলা হয়েছে</span><span>{dhakaTime(shift.openedAt)} (ঢাকা)</span></p>
                <p className="flex justify-between"><span>শুরুর ফ্লোট</span><Money poisha={shift.openingFloatPoisha} /></p>
                <p className="flex justify-between"><span>নগদ বিক্রি</span><Money poisha={cashSalesPoisha} /></p>
                <p className="flex justify-between font-semibold"><span>প্রত্যাশিত নগদ</span><Money poisha={expectedCash} /></p>
                <div className="pt-2">
                  <Input label="গণনা করা নগদ (টাকা)" placeholder="ড্রয়ার গুনে লিখুন" value={countedTaka}
                    onChange={(e) => setCountedTaka(e.target.value)} />
                </div>
                <div className="pt-2">
                  <Input label="নোট (পার্থক্য থাকলে আবশ্যক)" placeholder="কম/বেশি হলে কারণ লিখুন" value={closeNote}
                    onChange={(e) => setCloseNote(e.target.value)} />
                </div>
                <Button variant="secondary" className="mt-2 w-full" onClick={closeCurrentShift}>শিফট বন্ধ করুন</Button>
                <p className="text-xs text-text-muted">পার্থক্য থাকলে তা কখনো মিলিয়ে দেওয়া হয় না — গণনা করা অঙ্কই সংরক্ষিত হয়, পার্থক্য রিপোর্টে দেখা যায়।</p>
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                <p className="text-sm text-text-muted">কোনো শিফট খোলা নেই।</p>
                <Input label="শুরুর ফ্লোট (টাকা)" value={floatTaka} onChange={(e) => setFloatTaka(e.target.value)} />
                <Button className="w-full" onClick={openShift}>শিফট খুলুন</Button>
              </div>
            )}
            {lastClosedShift ? (
              <div className="mt-3 rounded-md bg-surface-2 p-3 text-sm">
                <p className="font-semibold">সর্বশেষ বন্ধ শিফটের হিসাব</p>
                <p className="flex justify-between"><span>প্রত্যাশিত</span><Money poisha={lastClosedShift.expectedCashPoisha ?? 0} /></p>
                <p className="flex justify-between"><span>গণনা করা</span><Money poisha={lastClosedShift.countedCashPoisha ?? 0} /></p>
                <p className="flex justify-between">
                  <span>পার্থক্য</span>
                  {(lastClosedShift.variancePoisha ?? 0) !== 0 ? (
                    <span className="font-semibold text-rose-600"><Money poisha={lastClosedShift.variancePoisha ?? 0} /> ⚠ ফ্ল্যাগ করা</span>
                  ) : (
                    <Money poisha={0} />
                  )}
                </p>
              </div>
            ) : null}
          </Card>

          <Card className="p-4">
            <h2 className="text-lg font-semibold">রসিদ প্রিভিউ</h2>
            {receipt ? (
              <div className="mx-auto mt-3 max-w-60 bg-white p-3 font-mono text-xs text-black shadow-sm">
                <p className="text-center font-bold">{receipt.orderNo}</p>
                <p className="text-center">{receipt.customerName}</p>
                <div className="my-2 border-t border-dashed" />
                {receipt.itemsText.map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
                <div className="my-2 border-t border-dashed" />
                <p className="flex justify-between font-bold"><span>মোট</span><span>{receipt.totalText}</span></p>
                <p className="mt-2 text-center">{receipt.barcodeValue}</p>
              </div>
            ) : (
              <p className="mt-2 text-sm text-text-muted">বিক্রি সম্পন্ন হলে রসিদ এখানে দেখা যাবে (shared PrintData — invoice / THERMAL_80)।</p>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">সিঙ্ক অবস্থা</h2>
              <Badge tone={online ? "success" : "danger"}>{online ? "অনলাইন" : "অফলাইন"}</Badge>
            </div>
            {pendingSales.length > 0 ? (
              <p className="mt-2 text-sm text-amber-700">
                সিঙ্ক বাকি: {pendingSales.length}টি বিক্রি এই ডিভাইসের কিউতে আছে — নেটওয়ার্ক ফিরলেই পাঠিয়ে দেওয়া হবে।
              </p>
            ) : (
              <p className="mt-2 text-sm text-emerald-700">সব বিক্রি সিঙ্ক হয়েছে।</p>
            )}
            {syncError ? <p className="mt-1 text-sm text-rose-600">শেষ সিঙ্কে সমস্যা: {syncError}</p> : null}
            <Button
              variant="secondary"
              className="mt-3 w-full"
              onClick={() => void flushQueue()}
              disabled={syncing || pendingSales.length === 0}
            >
              {syncing ? "সিঙ্ক হচ্ছে…" : "এখনই সিঙ্ক করুন"}
            </Button>
            <p className="mt-2 text-xs text-text-muted">
              অফলাইনে করা বিক্রি এই ব্রাউজারেই জমা থাকে (localStorage), প্রতিটির আলাদা idempotency key থাকে — সিঙ্ক
              আবার চালালেও একই বিক্রি দুবার রেকর্ড হয় না। সিঙ্ক মানে বিক্রিটি POS ডাটাবেসে রেকর্ড হওয়া; এটি অনলাইন
              Order তৈরি করে না।
            </p>
          </Card>
        </div>
      </div>

      <h2 className="mb-3 mt-6 text-lg font-semibold">এই শিফটের বিক্রি ({displaySales.length})</h2>
      {displaySales.length === 0 ? (
        <EmptyState title="এখনো কোনো বিক্রি হয়নি" description="বিক্রি সম্পন্ন হলে এই তালিকায় দেখা যাবে।" />
      ) : (
        <DataTable
          caption="এই শিফটের POS বিক্রি — 'সিঙ্ক হয়েছে' মানে সার্ভার ডাটাবেসে রেকর্ড; 'সিঙ্ক বাকি' মানে এই ডিভাইসের কিউতে"
          columns={[
            { key: "time", header: "সময়" },
            { key: "items", header: "আইটেম" },
            { key: "method", header: "মাধ্যম" },
            { key: "total", header: "মোট" },
            { key: "status", header: "অবস্থা" },
          ]}
          rows={saleRows}
        />
      )}
    </div>
  );
}
