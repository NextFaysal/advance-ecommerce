"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Money, formatPoisha } from "@/components/ui/money";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import type { ShipmentStatus } from "@/integrations/courier";
import {
  DEMO_COURIER_PROVIDERS,
  FORWARD_FLOW,
  SANDBOX_COURIER_LABELS_BN,
  SHIPMENT_STATUS_META,
  ZONE_LABELS_BN,
  dhakaDateTime,
  isProblemStatus,
  summarizeShipments,
  type BookingRateCard,
  type DemoBookableOrder,
  type DemoShipment,
  type SandboxCourierProvider,
} from "./demo-data";

// Shipments board — PAGE-STATE DEMO ONLY.
// The list starts from SAMPLE records in ./demo-data.ts shaped exactly
// like the sandbox SandboxShipment records. The booking panel's "book"
// action adds a row to THIS PAGE's state only: no API call is made and
// nothing is persisted or sent to a courier. Real booking goes through
// POST /api/v1/admin/shipments (permission shipments.book, idempotency
// key required) and live tracking through GET /api/v1/admin/shipments/
// track once the DB wiring lands — the panel says so in its own copy.
// Every charge shown comes from the server-computed rate cards (page.tsx
// calls the real sandbox courierChargePoisha / getRates); no rate math
// is re-implemented here beyond reading those outputs back.

const STATUS_TAB_ORDER: readonly ShipmentStatus[] = [
  "CREATED",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED",
  "RETURNING",
  "RETURNED",
];

type StatusFilter = "ALL" | ShipmentStatus;
type CourierFilter = "all" | SandboxCourierProvider;

function ShipmentStatusBadge({ status }: { status: ShipmentStatus }) {
  const s = SHIPMENT_STATUS_META[status];
  return (
    <Badge tone={s.tone}>
      <span aria-hidden="true">{s.icon}</span> {s.labelBn} ({s.labelEn})
    </Badge>
  );
}

function formatWeight(grams: number): string {
  if (grams < 1000) return `${grams} g`;
  const kg = grams / 1000;
  return `${Number.isInteger(kg) ? String(kg) : kg.toFixed(1)} kg`;
}

const selectClass =
  "h-11 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500";

export function ShipmentsBoard({
  initialShipments,
  bookableOrders,
  rateCards,
}: {
  initialShipments: DemoShipment[];
  bookableOrders: DemoBookableOrder[];
  rateCards: BookingRateCard[];
}) {
  const [shipments, setShipments] = useState<DemoShipment[]>(initialShipments);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [courierFilter, setCourierFilter] = useState<CourierFilter>("all");
  const [selectedId, setSelectedId] = useState<string>(initialShipments[0]?.shipmentId ?? "");

  // Booking panel state.
  const [bookedOrderIds, setBookedOrderIds] = useState<string[]>([]);
  const availableOrders = bookableOrders.filter((o) => !bookedOrderIds.includes(o.orderId));
  const [bookOrderId, setBookOrderId] = useState<string>(bookableOrders[0]?.orderId ?? "");
  const [bookProvider, setBookProvider] = useState<SandboxCourierProvider>("steadfast");
  const [bookWeight, setBookWeight] = useState<number>(bookableOrders[0]?.weightGrams ?? 1000);
  const [bookedNotice, setBookedNotice] = useState<string | null>(null);

  const summary = useMemo(() => summarizeShipments(shipments), [shipments]);
  const problemShipments = useMemo(
    () => shipments.filter((s) => isProblemStatus(s.status)),
    [shipments],
  );

  const filtered = useMemo(
    () =>
      shipments.filter(
        (s) =>
          (statusFilter === "ALL" || s.status === statusFilter) &&
          (courierFilter === "all" || s.provider === courierFilter),
      ),
    [shipments, statusFilter, courierFilter],
  );

  const selected = shipments.find((s) => s.shipmentId === selectedId) ?? filtered[0] ?? shipments[0];

  const bookOrder = availableOrders.find((o) => o.orderId === bookOrderId) ?? availableOrders[0];
  const bookCard = bookOrder ? rateCards.find((c) => c.orderId === bookOrder.orderId) : undefined;
  const bookWeightOptions = bookCard
    ? Object.keys(bookCard.chargeByWeightGrams).map(Number).sort((a, b) => a - b)
    : [];
  const effectiveWeight =
    bookWeightOptions.includes(bookWeight) ? bookWeight : (bookOrder?.weightGrams ?? 1000);
  const bookCharge = bookCard ? (bookCard.chargeByWeightGrams[String(effectiveWeight)] ?? 0) : 0;
  const bookBase = bookCard ? (bookCard.chargeByWeightGrams["1000"] ?? bookCharge) : 0;
  const bookExtraUnits = bookCharge > bookBase ? Math.round((bookCharge - bookBase) / 2000) : 0;

  function pickOrder(orderId: string) {
    const order = bookableOrders.find((o) => o.orderId === orderId);
    setBookOrderId(orderId);
    if (order) setBookWeight(order.weightGrams);
    setBookedNotice(null);
  }

  function book() {
    if (!bookOrder || !bookCard) return;
    const seq = shipments.length + 1;
    const prefix =
      bookProvider === "steadfast" ? "SF" : bookProvider === "pathao" ? "PT" : "RX";
    const nowIso = new Date().toISOString();
    const shipment: DemoShipment = {
      shipmentId: `SBX-SHIP-${bookProvider.toUpperCase()}-DEMO${seq}`,
      trackingId: `SBX-${prefix}-DEMO${9000 + seq}`,
      provider: bookProvider,
      orderId: bookOrder.orderId,
      codAmountPoisha: bookOrder.codAmountPoisha,
      weightGrams: effectiveWeight,
      status: "CREATED",
      statusHistory: ["CREATED"],
      orderStatus: "CONFIRMED",
      idempotencyKey: `demo-page-booking-${seq}`,
      createdAt: nowIso,
      zone: bookOrder.zone,
      district: bookOrder.address.district,
      chargePoisha: bookCharge,
      failureReason: null,
      events: [
        {
          status: "CREATED",
          at: nowIso,
          note: "ডেমো বুকিং (শুধু এই পেজে) — কুরিয়ারে পাঠানো হয়নি",
        },
      ],
    };
    setShipments((prev) => [shipment, ...prev]);
    setBookedOrderIds((prev) => [...prev, bookOrder.orderId]);
    setSelectedId(shipment.shipmentId);
    setBookedNotice(
      `অর্ডার #${bookOrder.orderId} — ডেমো শিপমেন্ট তৈরি হয়েছে (ট্র্যাকিং ${shipment.trackingId})। এটি শুধু এই পেজের স্টেট; কোনো বুকিং কুরিয়ারে পাঠানো হয়নি।`,
    );
    const nextOrder = availableOrders.find((o) => o.orderId !== bookOrder.orderId);
    if (nextOrder) {
      setBookOrderId(nextOrder.orderId);
      setBookWeight(nextOrder.weightGrams);
    }
  }

  const rows = filtered.map((s) => ({
    order: (
      <span className="font-mono tabular-nums">
        #{s.orderId}
        {isProblemStatus(s.status) ? (
          <span className="ml-1 text-rose-600" aria-hidden="true">⚠</span>
        ) : null}
      </span>
    ),
    courier: SANDBOX_COURIER_LABELS_BN[s.provider as SandboxCourierProvider] ?? s.provider,
    tracking: <span className="font-mono text-xs tabular-nums">{s.trackingId}</span>,
    destination: (
      <span>
        {s.district}
        <span className="block text-xs text-text-muted">{ZONE_LABELS_BN[s.zone]}</span>
      </span>
    ),
    weight: <span className="tabular-nums">{formatWeight(s.weightGrams)}</span>,
    charge: <Money poisha={s.chargePoisha} />,
    cod:
      s.codAmountPoisha > 0 ? (
        <Money poisha={s.codAmountPoisha} />
      ) : (
        <span className="text-text-muted">প্রিপেইড</span>
      ),
    status: (
      <span>
        <ShipmentStatusBadge status={s.status} />
        {s.failureReason ? (
          <span className="mt-1 block max-w-[220px] text-xs text-rose-700">{s.failureReason}</span>
        ) : null}
      </span>
    ),
    created: (
      <span className="font-mono text-xs tabular-nums">{dhakaDateTime(s.createdAt)}</span>
    ),
    action: (
      <Button
        size="sm"
        variant={selected?.shipmentId === s.shipmentId ? "secondary" : "outline"}
        onClick={() => setSelectedId(s.shipmentId)}
        aria-pressed={selected?.shipmentId === s.shipmentId}
      >
        ট্র্যাকিং
      </Button>
    ),
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="মোট শিপমেন্ট (ডেমো)" value={String(summary.total)} delta="সব কুরিয়ার" icon="🚚" />
        <StatCard
          label="পথে আছে"
          value={String(summary.inTransit)}
          delta="পিকআপ → ডেলিভারি"
          icon="🛵"
        />
        <StatCard
          label="ডেলিভারি সম্পন্ন"
          value={String(summary.delivered)}
          delta="সফল"
          icon="✓"
        />
        <StatCard
          label="COD সংগ্রহ বাকি"
          value={formatPoisha(summary.codOutstandingPoisha)}
          delta="সক্রিয় শিপমেন্টে"
          icon="💰"
        />
      </div>

      {problemShipments.length > 0 ? (
        <section className="space-y-2" aria-label="সমস্যাযুক্ত শিপমেন্ট">
          <h2 className="text-lg font-semibold">
            <span aria-hidden="true">⚠</span> মনোযোগ দরকার — ব্যর্থ / ফেরত শিপমেন্ট ({problemShipments.length})
          </h2>
          {problemShipments.map((s) => (
            <p key={s.shipmentId} className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <ShipmentStatusBadge status={s.status} />{" "}
              <span className="font-mono">{s.trackingId}</span> (অর্ডার #{s.orderId},{" "}
              {SANDBOX_COURIER_LABELS_BN[s.provider as SandboxCourierProvider] ?? s.provider}) —{" "}
              {s.failureReason ?? "কারণ নথিভুক্ত নেই (ডেমো)"}। COD{" "}
              {s.codAmountPoisha > 0 ? <Money poisha={s.codAmountPoisha} /> : "প্রিপেইড"} সংগৃহীত হয়নি।
            </p>
          ))}
        </section>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="অবস্থা অনুযায়ী ফিল্টার">
          <button
            type="button"
            role="tab"
            aria-selected={statusFilter === "ALL"}
            onClick={() => setStatusFilter("ALL")}
            className={`min-h-[44px] rounded-full px-3 text-sm font-medium ${statusFilter === "ALL" ? "bg-brand-600 text-white" : "bg-surface-2 text-text-muted hover:text-text-main"}`}
          >
            সব ({shipments.length})
          </button>
          {STATUS_TAB_ORDER.map((status) => {
            const count = shipments.filter((s) => s.status === status).length;
            if (count === 0) return null;
            const meta = SHIPMENT_STATUS_META[status];
            return (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={statusFilter === status}
                onClick={() => setStatusFilter(status)}
                className={`min-h-[44px] rounded-full px-3 text-sm font-medium ${statusFilter === status ? "bg-brand-600 text-white" : "bg-surface-2 text-text-muted hover:text-text-main"}`}
              >
                <span aria-hidden="true">{meta.icon}</span> {meta.labelBn} ({count})
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="কুরিয়ার অনুযায়ী ফিল্টার">
          <button
            type="button"
            onClick={() => setCourierFilter("all")}
            aria-pressed={courierFilter === "all"}
            className={`min-h-[44px] rounded-full px-3 text-sm font-medium ${courierFilter === "all" ? "bg-brand-100 text-brand-700" : "bg-surface-2 text-text-muted hover:text-text-main"}`}
          >
            সব কুরিয়ার
          </button>
          {DEMO_COURIER_PROVIDERS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setCourierFilter(p)}
              aria-pressed={courierFilter === p}
              className={`min-h-[44px] rounded-full px-3 text-sm font-medium ${courierFilter === p ? "bg-brand-100 text-brand-700" : "bg-surface-2 text-text-muted hover:text-text-main"}`}
            >
              {SANDBOX_COURIER_LABELS_BN[p]}
            </button>
          ))}
        </div>

        <DataTable
          caption="শিপমেন্ট — নমুনা (TEMPORARY DEMO), sandbox রেকর্ডের আকারে"
          columns={[
            { key: "order", header: "অর্ডার" },
            { key: "courier", header: "কুরিয়ার" },
            { key: "tracking", header: "ট্র্যাকিং আইডি" },
            { key: "destination", header: "গন্তব্য" },
            { key: "weight", header: "ওজন" },
            { key: "charge", header: "কুরিয়ার চার্জ" },
            { key: "cod", header: "COD" },
            { key: "status", header: "অবস্থা" },
            { key: "created", header: "তৈরি (Asia/Dhaka)" },
            { key: "action", header: "" },
          ]}
          rows={rows}
        />
        {filtered.length === 0 ? (
          <p className="text-sm text-text-muted">এই ফিল্টারে কোনো শিপমেন্ট নেই (ডেমো)।</p>
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">ট্র্যাকিং টাইমলাইন</h2>
          {selected ? (
            <div className="mt-3 space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs tabular-nums">{selected.trackingId}</span>
                <ShipmentStatusBadge status={selected.status} />
                <span className="text-text-muted">
                  অর্ডার #{selected.orderId} ·{" "}
                  {SANDBOX_COURIER_LABELS_BN[selected.provider as SandboxCourierProvider] ??
                    selected.provider}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-text-muted">গন্তব্য</dt>
                  <dd>
                    {selected.district} ({ZONE_LABELS_BN[selected.zone]})
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-text-muted">ওজন</dt>
                  <dd className="tabular-nums">{formatWeight(selected.weightGrams)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-text-muted">কুরিয়ার চার্জ</dt>
                  <dd><Money poisha={selected.chargePoisha} /></dd>
                </div>
                <div>
                  <dt className="text-xs text-text-muted">COD সংগ্রহ</dt>
                  <dd>
                    {selected.codAmountPoisha > 0 ? (
                      <Money poisha={selected.codAmountPoisha} />
                    ) : (
                      "প্রিপেইড"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-text-muted">বুকিং সময়</dt>
                  <dd className="font-mono text-xs tabular-nums">{dhakaDateTime(selected.createdAt)}</dd>
                </div>
              </dl>
              {selected.failureReason ? (
                <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  <span aria-hidden="true">⚠️</span> কারণ: {selected.failureReason}
                </p>
              ) : null}
              <ol className="space-y-0">
                {selected.events.map((event, i) => {
                  const meta = SHIPMENT_STATUS_META[event.status];
                  return (
                    <li key={`${event.status}-${event.at}`} className="relative flex gap-3 pb-4 last:pb-0">
                      {i < selected.events.length - 1 ||
                      FORWARD_FLOW.includes(selected.status) ? (
                        <span
                          aria-hidden="true"
                          className="absolute left-[13px] top-7 h-[calc(100%-20px)] w-px bg-border"
                        />
                      ) : null}
                      <span
                        aria-hidden="true"
                        className="z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm"
                      >
                        {meta.icon}
                      </span>
                      <div>
                        <p className="text-sm font-medium">
                          {meta.labelBn}{" "}
                          <span className="font-mono text-xs text-text-muted">({meta.labelEn})</span>
                        </p>
                        <p className="font-mono text-xs tabular-nums text-text-muted">
                          {dhakaDateTime(event.at)}
                        </p>
                        {event.note ? <p className="text-xs text-text-muted">{event.note}</p> : null}
                      </div>
                    </li>
                  );
                })}
                {FORWARD_FLOW.includes(selected.status) &&
                selected.status !== "DELIVERED"
                  ? FORWARD_FLOW.slice(FORWARD_FLOW.indexOf(selected.status) + 1).map((status) => {
                      const meta = SHIPMENT_STATUS_META[status];
                      return (
                        <li key={`pending-${status}`} className="relative flex gap-3 pb-4 last:pb-0 opacity-50">
                          <span
                            aria-hidden="true"
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-sm"
                          >
                            {meta.icon}
                          </span>
                          <div>
                            <p className="text-sm font-medium">{meta.labelBn}</p>
                            <p className="text-xs text-text-muted">অপেক্ষমাণ</p>
                          </div>
                        </li>
                      );
                    })
                  : null}
              </ol>
              <p className="text-xs text-text-muted">
                ডেমো ইভেন্ট — আসল ট্র্যাকিং GET /api/v1/admin/shipments/track থেকে আসবে (কুরিয়ার
                ওয়েবহুকের মাধ্যমে অবস্থা এগোয়)।
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-text-muted">কোনো শিপমেন্ট নির্বাচিত নেই।</p>
          )}
        </Card>

        <Card>
          <h2 className="font-semibold">নতুন শিপমেন্ট বুকিং (ডেমো)</h2>
          <p className="mt-1 text-sm text-text-muted">
            TEMPORARY DEMO — “বুক করুন” চাপলে শিপমেন্ট শুধু এই পেজের তালিকায় যোগ হবে; কোনো বুকিং
            পাঠানো হবে না। আসল বুকিং DB wiring-এর পর POST /api/v1/admin/shipments দিয়ে যাবে
            (idempotency key বাধ্যতামূলক)।
          </p>
          {bookOrder && bookCard ? (
            <div className="mt-4 space-y-4">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">অর্ডার (বুকিং বাকি)</span>
                <select
                  value={bookOrder.orderId}
                  onChange={(e) => pickOrder(e.target.value)}
                  className={selectClass}
                >
                  {availableOrders.map((o) => (
                    <option key={o.orderId} value={o.orderId}>
                      #{o.orderId} — {o.address.recipientName}, {o.address.district} · {o.itemCount}টি
                      আইটেম · COD{" "}
                      {o.codAmountPoisha > 0 ? formatPoisha(o.codAmountPoisha) : "প্রিপেইড"}
                    </option>
                  ))}
                </select>
              </label>

              <div>
                <span className="mb-1 block text-xs font-medium text-text-muted">কুরিয়ার</span>
                <div className="grid gap-2 sm:grid-cols-3">
                  {DEMO_COURIER_PROVIDERS.map((p) => {
                    const days = bookCard.daysByProvider[p];
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setBookProvider(p)}
                        aria-pressed={bookProvider === p}
                        className={`min-h-[44px] rounded-[10px] border px-3 py-2 text-left text-sm ${bookProvider === p ? "border-brand-600 bg-brand-50 text-brand-700" : "border-border bg-card hover:bg-surface-2"}`}
                      >
                        <span className="block font-medium">{SANDBOX_COURIER_LABELS_BN[p]}</span>
                        <span className="block text-xs text-text-muted">
                          আনুমানিক {days !== null ? `${days} দিন` : "—"} · চার্জ{" "}
                          {formatPoisha(bookCharge)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">পার্সেলের ওজন</span>
                <select
                  value={effectiveWeight}
                  onChange={(e) => setBookWeight(Number(e.target.value))}
                  className={selectClass}
                >
                  {bookWeightOptions.map((w) => (
                    <option key={w} value={w}>
                      {formatWeight(w)}
                      {w === bookOrder.weightGrams ? " (অর্ডারের ওজন)" : ""}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-[10px] bg-surface-2 px-4 py-3 text-sm">
                <p>
                  জোন: {ZONE_LABELS_BN[bookOrder.zone]} ({bookOrder.address.district}) · গন্তব্য:{" "}
                  {bookOrder.address.upazila}, {bookOrder.address.district}
                </p>
                <p className="mt-1">
                  কুরিয়ার চার্জ: <Money poisha={bookCharge} />
                  {bookExtraUnits > 0 ? (
                    <span className="text-text-muted">
                      {" "}
                      = বেস (≤1 kg) {formatPoisha(bookBase)} + অতিরিক্ত {bookExtraUnits} × 500g ×{" "}
                      {formatPoisha(2000)}
                    </span>
                  ) : (
                    <span className="text-text-muted"> (sandbox জোন-ভিত্তিক বেস চার্জ)</span>
                  )}
                </p>
                <p className="mt-1">
                  COD সংগ্রহ:{" "}
                  {bookOrder.codAmountPoisha > 0 ? (
                    <Money poisha={bookOrder.codAmountPoisha} />
                  ) : (
                    "প্রিপেইড — সংগ্রহ নেই"
                  )}{" "}
                  · প্রাপক: {bookOrder.address.recipientName}
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  চার্জের হিসাব sandbox-এর আসল নিয়মে (courierChargePoisha): ঢাকার ভিতরে{" "}
                  {formatPoisha(6000)}, ঢাকার বাইরে {formatPoisha(12000)}, জেলা {formatPoisha(10000)}
                  ; 1 kg-এর বেশি হলে প্রতি অতিরিক্ত 500g-তে {formatPoisha(2000)}।
                </p>
              </div>

              <Button onClick={book} className="w-full">
                বুক করুন (ডেমো — পাঠানো হবে না)
              </Button>
              {bookedNotice ? (
                <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                  {bookedNotice}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
              সব ডেমো অর্ডার এই পেজে বুক করা হয়ে গেছে — তালিকায় CREATED অবস্থায় দেখুন।
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
