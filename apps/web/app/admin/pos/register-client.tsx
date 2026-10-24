"use client";

/**
 * POS register screen — Agent 38, on the src/pos contracts (Agent 14).
 *
 * Everything runs through the pure register logic in src/pos/register.ts
 * (saleTotal / createSale / closeShift / expectedCashPoisha /
 * buildPosReceipt) — this component holds session state only, seeded
 * from the src/pos demo store by the server page. Sales made here are
 * DEMO records in page state: no real Order is created, nothing is
 * persisted, and the matching API contract lives at /api/v1/admin/pos.
 *
 * Offline design note (labelled, not a claim): the register is designed
 * offline-first — sales carry a client idempotency key and QUEUED_OFFLINE
 * status and would sync to the orders API when the network returns. This
 * demo performs NO real sync.
 */
import { useMemo, useState } from "react";
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
  closeShift,
  createSale,
  expectedCashPoisha,
  saleTotal,
} from "@/pos/register";
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
  return `pos-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
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

  function completeSale() {
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
    const result = createSale(input, { id: `pos_local_${Date.now()}`, createdAt: new Date().toISOString() });
    if (!result.ok) {
      flashError(result.error);
      return;
    }
    setSales((prev) => [...prev, result.sale]);
    setReceipt(buildPosReceipt(result.sale));
    setLastChangePoisha(
      paymentMethod === "CASH" && tenderedPoisha !== null ? tenderedPoisha - result.sale.totalPoisha : null,
    );
    setLines([]);
    setDiscountTaka("");
    setTenderedTaka("");
    setError(null);
    setMessage(`বিক্রি সম্পন্ন — মোট ${formatPoisha(result.sale.totalPoisha)} (ডেমো রেকর্ড, আসল Order তৈরি হয়নি)।`);
  }

  function openShift() {
    const floatPoisha = takaInputToPoisha(floatTaka);
    if (floatPoisha === null) {
      flashError("শুরুর ফ্লোট ঠিকমতো লিখুন।");
      return;
    }
    setShift({
      id: `shift_local_${Date.now()}`,
      registerId: register.id,
      openedBy: "current-staff (demo)",
      openedAt: new Date().toISOString(),
      openingFloatPoisha: floatPoisha,
      status: "OPEN",
    });
    setSales([]);
    setLastClosedShift(null);
    setError(null);
    setMessage(`শিফট খোলা হয়েছে — ফ্লোট ${formatPoisha(floatPoisha)}।`);
  }

  function closeCurrentShift() {
    if (!shift) return;
    const counted = takaInputToPoisha(countedTaka);
    if (counted === null) {
      flashError("গণনা করা নগদ ঠিকমতো লিখুন।");
      return;
    }
    const result = closeShift(shift, sales, {
      countedCashPoisha: counted,
      closedBy: "current-staff (demo)",
      closedAt: new Date().toISOString(),
      note: closeNote || undefined,
    });
    if (!result.ok) {
      flashError(result.error);
      return;
    }
    setLastClosedShift(result.shift);
    setShift(null);
    setCountedTaka("");
    setCloseNote("");
    setError(null);
    setMessage("শিফট বন্ধ হয়েছে — হিসাব নিচে দেখুন। পার্থক্য থাকলে তা যেমন ছিল তেমনই রিপোর্ট করা হয়েছে, মিলিয়ে দেওয়া হয়নি।");
  }

  const expectedCash = shift ? expectedCashPoisha(shift, sales) : 0;
  const cashSalesPoisha = shift ? expectedCash - shift.openingFloatPoisha : 0;

  const saleRows = sales.map((sale) => ({
    time: dhakaTime(sale.createdAt),
    items: String(sale.lines.reduce((sum, l) => sum + l.quantity, 0)),
    method: PAYMENT_METHODS.find((m) => m.id === sale.paymentMethod)?.labelBn ?? sale.paymentMethod,
    total: <Money poisha={sale.totalPoisha} />,
    status: (
      <Badge tone={sale.status === "QUEUED_OFFLINE" ? "warning" : sale.status === "VOIDED" ? "danger" : "success"}>
        {sale.status === "QUEUED_OFFLINE" ? "অফলাইন কিউতে" : sale.status}
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
            <h2 className="text-base font-semibold">অফলাইন নোট (ডিজাইন)</h2>
            <p className="mt-1 text-sm text-text-muted">
              রেজিস্টারটি অফলাইন-ফার্স্ট ডিজাইনের: নেটওয়ার্ক না থাকলেও বিক্রি জমা হয়, প্রতিটি বিক্রি{" "}
              <code>QUEUED_OFFLINE</code> অবস্থায় client idempotency key সহ থাকে এবং নেটওয়ার্ক ফিরলে অর্ডার API-তে sync হওয়ার কথা।
              এই ডেমোতে আসল কোনো sync হয় না — এটি শুধু ডিজাইন নোট।
            </p>
          </Card>
        </div>
      </div>

      <h2 className="mb-3 mt-6 text-lg font-semibold">এই শিফটের বিক্রি ({sales.length})</h2>
      {sales.length === 0 ? (
        <EmptyState title="এখনো কোনো বিক্রি হয়নি" description="বিক্রি সম্পন্ন হলে এই তালিকায় দেখা যাবে।" />
      ) : (
        <DataTable
          caption="এই শিফটের POS বিক্রি — ডেমো রেকর্ড, আসল Order নয়"
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
