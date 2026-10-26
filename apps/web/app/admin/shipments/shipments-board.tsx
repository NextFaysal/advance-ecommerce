"use client";

/**
 * Shipments board — REAL records (doc 21 W0-C, G3-7a).
 *
 * Was a page-state DEMO over ./demo-data.ts (sample rows, fake booking
 * minting SBX-…-DEMO ids). Now it renders the server's real Shipment
 * rows (src/shipments/board.ts, passed in by page.tsx; the same read
 * backs GET /api/v1/admin/shipments/board). The visual language is the
 * old board's — stat cards, status tabs, courier filter, data table,
 * detail card with the OD5 parcel stepper + event timeline — but every
 * figure is a persisted row: stored charge/COD, real ShipmentEvent
 * history, no synthesized events or timestamps.
 *
 * This board takes NO action on a shipment. Booking, split booking and
 * status work live per-order in the order workspace (its shipments
 * panel); every row and the detail card link there
 * (/admin/orders/<orderId>). The booking panel of the demo is replaced
 * by an honest explainer card saying exactly that, plus the standing
 * note that courier adapters are sandbox until live providers land.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon, type IconName } from "@/components/ui/icon";
import { Money, formatPoisha } from "@/components/ui/money";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import type { ShipmentBoardRow, ShipmentsBoardSummary } from "@/shipments/board";

/* ------------------------------------------------------------------ */
/* Display language (moved from the deleted demo-data.ts; the values   */
/* are presentation only — statuses themselves come from the rows).    */
/* ------------------------------------------------------------------ */

type StatusTone = "warning" | "info" | "success" | "danger" | "brand" | "neutral";

const SHIPMENT_STATUS_META: Record<string, { labelBn: string; labelEn: string; icon: string; tone: StatusTone }> = {
  CREATED: { labelBn: "তৈরি হয়েছে", labelEn: "CREATED", icon: "📦", tone: "neutral" },
  PICKED_UP: { labelBn: "পিকআপ হয়েছে", labelEn: "PICKED_UP", icon: "📥", tone: "info" },
  IN_TRANSIT: { labelBn: "পথে আছে", labelEn: "IN_TRANSIT", icon: "🚚", tone: "info" },
  OUT_FOR_DELIVERY: { labelBn: "ডেলিভারির জন্য বের হয়েছে", labelEn: "OUT_FOR_DELIVERY", icon: "🛵", tone: "brand" },
  DELIVERED: { labelBn: "ডেলিভারি সম্পন্ন", labelEn: "DELIVERED", icon: "✓", tone: "success" },
  FAILED: { labelBn: "ব্যর্থ", labelEn: "FAILED", icon: "⚠", tone: "danger" },
  RETURNING: { labelBn: "ফেরত আসছে", labelEn: "RETURNING", icon: "↩", tone: "warning" },
  RETURNED: { labelBn: "ফেরত এসেছে", labelEn: "RETURNED", icon: "↩", tone: "warning" },
};

const STATUS_TAB_ORDER = [
  "CREATED",
  "PICKED_UP",
  "IN_TRANSIT",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "FAILED",
  "RETURNING",
  "RETURNED",
] as const;

const COURIER_LABELS_BN: Record<string, string> = {
  steadfast: "স্টেডফাস্ট (Steadfast)",
  pathao: "পাঠাও (Pathao)",
  redx: "রেডএক্স (RedX)",
};

function courierLabel(provider: string): string {
  return COURIER_LABELS_BN[provider] ?? provider;
}

function isProblemStatus(status: string): boolean {
  return status === "FAILED" || status === "RETURNING" || status === "RETURNED";
}

function dhakaDateTime(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function formatWeight(grams: number | null): string {
  if (grams === null) return "—";
  if (grams < 1000) return `${grams} g`;
  const kg = grams / 1000;
  return `${Number.isInteger(kg) ? String(kg) : kg.toFixed(1)} kg`;
}

function ShipmentStatusBadge({ status }: { status: string }) {
  const s = SHIPMENT_STATUS_META[status] ?? { labelBn: status, labelEn: status, icon: "•", tone: "neutral" as StatusTone };
  return (
    <Badge tone={s.tone}>
      <span aria-hidden="true">{s.icon}</span> {s.labelBn} ({s.labelEn})
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* OD5 parcel stepper — same pipeline language as the order workspace  */
/* shipments panel (status only; no fabricated timestamps).            */
/* ------------------------------------------------------------------ */

const PIPELINE_STEPS = [
  { status: "CREATED", labelBn: "তৈরি", icon: "package" },
  { status: "PICKED_UP", labelBn: "পিকআপ", icon: "box" },
  { status: "IN_TRANSIT", labelBn: "পথে", icon: "truck" },
  { status: "OUT_FOR_DELIVERY", labelBn: "ডেলিভারিতে", icon: "arrow-right" },
  { status: "DELIVERED", labelBn: "ডেলিভার্ড", icon: "check" },
] as const satisfies readonly { status: string; labelBn: string; icon: IconName }[];

const OFF_PATH: Record<string, { labelBn: string; icon: IconName; cls: string }> = {
  FAILED: { labelBn: "ডেলিভারি ব্যর্থ হয়েছে", icon: "alert", cls: "border-rose-200 bg-rose-50 text-rose-700" },
  RETURNING: { labelBn: "পার্সেলটি ফেরত আসছে", icon: "rotate-ccw", cls: "border-amber-200 bg-amber-50 text-amber-800" },
  RETURNED: { labelBn: "পার্সেলটি ফেরত এসেছে", icon: "rotate-ccw", cls: "border-border bg-slate-50 text-slate-600" },
};

function ParcelStepper({ status }: { status: string }) {
  const activeIdx = PIPELINE_STEPS.findIndex((s) => s.status === status);
  if (activeIdx === -1) {
    const off = OFF_PATH[status];
    if (!off) return null;
    return (
      <p className={`mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${off.cls}`}>
        <Icon name={off.icon} size={16} />
        {off.labelBn}
      </p>
    );
  }
  return (
    <ol className="mt-3 flex items-start" aria-label={`পার্সেলের অবস্থা: ${PIPELINE_STEPS[activeIdx].labelBn}`}>
      {PIPELINE_STEPS.map((step, idx) => {
        const done = idx < activeIdx || status === "DELIVERED";
        const active = idx === activeIdx && status !== "DELIVERED";
        return (
          <li key={step.status} className={`flex items-start ${idx > 0 ? "flex-1" : ""}`}>
            {idx > 0 && (
              <span aria-hidden="true" className={`mx-1 mt-[13px] h-0.5 flex-1 rounded ${idx <= activeIdx ? "bg-emerald-400" : "bg-border"}`} />
            )}
            <span className="flex w-14 flex-col items-center gap-1 text-center">
              <span
                aria-hidden="true"
                className={`flex h-[27px] w-[27px] items-center justify-center rounded-full ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "bg-brand-600 text-white ring-4 ring-brand-100"
                      : "bg-slate-100 text-slate-400"
                }`}
              >
                <Icon name={done ? "check" : step.icon} size={14} />
              </span>
              <span className={`text-xs leading-tight ${done || active ? "font-semibold text-text-main" : "text-text-muted"}`}>
                {step.labelBn}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ */

type StatusFilter = "ALL" | string;

export function ShipmentsBoard({
  rows,
  summary,
}: {
  rows: ShipmentBoardRow[];
  summary: ShipmentsBoardSummary;
}) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [courierFilter, setCourierFilter] = useState<string>("all");
  const [selectedId, setSelectedId] = useState<string>(rows[0]?.id ?? "");

  const problemShipments = useMemo(() => rows.filter((s) => isProblemStatus(s.status)), [rows]);
  const providers = useMemo(
    () => [...new Set(rows.map((s) => s.provider))].sort(),
    [rows],
  );

  const filtered = useMemo(
    () =>
      rows.filter(
        (s) =>
          (statusFilter === "ALL" || s.status === statusFilter) &&
          (courierFilter === "all" || s.provider === courierFilter),
      ),
    [rows, statusFilter, courierFilter],
  );

  const selected = rows.find((s) => s.id === selectedId) ?? filtered[0] ?? rows[0];

  const tableRows = filtered.map((s) => ({
    order: (
      <Link
        href={`/admin/orders/${s.orderId}`}
        className="font-mono tabular-nums text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
      >
        #{s.orderNo}
        {isProblemStatus(s.status) ? (
          <span className="ml-1 text-rose-600" aria-hidden="true">⚠</span>
        ) : null}
      </Link>
    ),
    courier: courierLabel(s.provider),
    tracking: <span className="font-mono text-xs tabular-nums">{s.trackingId ?? "—"}</span>,
    destination: <span>{s.district ?? "—"}</span>,
    weight: <span className="tabular-nums">{formatWeight(s.weightGrams)}</span>,
    charge: <Money poisha={s.chargePoisha} />,
    cod:
      s.codAmountPoisha > 0 ? (
        <Money poisha={s.codAmountPoisha} />
      ) : (
        <span className="text-text-muted">প্রিপেইড</span>
      ),
    status: <ShipmentStatusBadge status={s.status} />,
    created: (
      <span className="font-mono text-xs tabular-nums">{dhakaDateTime(s.createdAt)}</span>
    ),
    action: (
      <span className="flex items-center gap-2">
        <Button
          size="sm"
          variant={selected?.id === s.id ? "secondary" : "outline"}
          onClick={() => setSelectedId(s.id)}
          aria-pressed={selected?.id === s.id}
        >
          বিবরণ
        </Button>
        <Link
          href={`/admin/orders/${s.orderId}`}
          className="whitespace-nowrap text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          ওয়ার্কস্পেস →
        </Link>
      </span>
    ),
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="মোট শিপমেন্ট" value={String(summary.total)} delta="সব কুরিয়ার" icon="🚚" />
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

      {summary.total > rows.length ? (
        <p className="text-sm text-text-muted">
          সর্বশেষ {rows.length}টি শিপমেন্ট দেখানো হচ্ছে (মোট {summary.total}টি) — পুরনো রেকর্ড
          সংশ্লিষ্ট অর্ডারের ওয়ার্কস্পেসে পাওয়া যাবে। উপরের হিসাব পুরো {summary.total}টির
          উপরেই গণনা করা।
        </p>
      ) : null}

      {problemShipments.length > 0 ? (
        <section className="space-y-2" aria-label="সমস্যাযুক্ত শিপমেন্ট">
          <h2 className="text-lg font-semibold">
            <span aria-hidden="true">⚠</span> মনোযোগ দরকার — ব্যর্থ / ফেরত শিপমেন্ট ({problemShipments.length})
          </h2>
          {problemShipments.map((s) => (
            <p key={s.id} className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-700">
              <ShipmentStatusBadge status={s.status} />{" "}
              <span className="font-mono">{s.trackingId ?? "—"}</span> (অর্ডার{" "}
              <Link href={`/admin/orders/${s.orderId}`} className="font-medium underline">
                #{s.orderNo}
              </Link>
              , {courierLabel(s.provider)}) — COD{" "}
              {s.codAmountPoisha > 0 ? <Money poisha={s.codAmountPoisha} /> : "প্রিপেইড"} সংগৃহীত হয়নি।
            </p>
          ))}
        </section>
      ) : null}

      {rows.length === 0 ? (
        <Card>
          <h2 className="font-semibold">এখনো কোনো শিপমেন্ট বুক হয়নি</h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            কোনো অর্ডারের ওয়ার্কস্পেস থেকে প্রথম বুকিং হলেই তা এখানে দেখা যাবে। বুকিং এই
            বোর্ড থেকে হয় না — নিচের কার্ডে বিস্তারিত আছে।
          </p>
        </Card>
      ) : (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="অবস্থা অনুযায়ী ফিল্টার">
            <button
              type="button"
              role="tab"
              aria-selected={statusFilter === "ALL"}
              onClick={() => setStatusFilter("ALL")}
              className={`min-h-[44px] rounded-full px-3 text-sm font-medium ${statusFilter === "ALL" ? "bg-brand-600 text-white" : "bg-surface-2 text-text-muted hover:text-text-main"}`}
            >
              সব ({rows.length})
            </button>
            {STATUS_TAB_ORDER.map((status) => {
              const count = rows.filter((s) => s.status === status).length;
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
          {providers.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2" aria-label="কুরিয়ার অনুযায়ী ফিল্টার">
              <button
                type="button"
                onClick={() => setCourierFilter("all")}
                aria-pressed={courierFilter === "all"}
                className={`min-h-[44px] rounded-full px-3 text-sm font-medium ${courierFilter === "all" ? "bg-brand-100 text-brand-700" : "bg-surface-2 text-text-muted hover:text-text-main"}`}
              >
                সব কুরিয়ার
              </button>
              {providers.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setCourierFilter(p)}
                  aria-pressed={courierFilter === p}
                  className={`min-h-[44px] rounded-full px-3 text-sm font-medium ${courierFilter === p ? "bg-brand-100 text-brand-700" : "bg-surface-2 text-text-muted hover:text-text-main"}`}
                >
                  {courierLabel(p)}
                </button>
              ))}
            </div>
          ) : null}

          <DataTable
            caption="শিপমেন্ট — আসল রেকর্ড (সব অর্ডার)"
            columns={[
              { key: "order", header: "অর্ডার" },
              { key: "courier", header: "কুরিয়ার" },
              { key: "tracking", header: "ট্র্যাকিং আইডি" },
              { key: "destination", header: "গন্তব্য (জেলা)" },
              { key: "weight", header: "ওজন" },
              { key: "charge", header: "কুরিয়ার চার্জ" },
              { key: "cod", header: "COD" },
              { key: "status", header: "অবস্থা" },
              { key: "created", header: "তৈরি (Asia/Dhaka)" },
              { key: "action", header: "" },
            ]}
            rows={tableRows}
          />
          {filtered.length === 0 ? (
            <p className="text-sm text-text-muted">এই ফিল্টারে কোনো শিপমেন্ট নেই।</p>
          ) : null}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-semibold">ট্র্যাকিং টাইমলাইন</h2>
          {selected ? (
            <div className="mt-3 space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-mono text-xs tabular-nums">{selected.trackingId ?? "—"}</span>
                <ShipmentStatusBadge status={selected.status} />
                <span className="text-text-muted">
                  অর্ডার{" "}
                  <Link href={`/admin/orders/${selected.orderId}`} className="font-medium text-primary hover:underline">
                    #{selected.orderNo}
                  </Link>{" "}
                  · {courierLabel(selected.provider)}
                </span>
              </div>
              <ParcelStepper status={selected.status} />
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-text-muted">গন্তব্য (জেলা)</dt>
                  <dd>{selected.district ?? "—"}</dd>
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
                <div>
                  <dt className="text-xs text-text-muted">সর্বশেষ আপডেট</dt>
                  <dd className="font-mono text-xs tabular-nums">{dhakaDateTime(selected.updatedAt)}</dd>
                </div>
              </dl>
              {selected.events.length > 0 ? (
                <ol className="space-y-0">
                  {selected.events.map((event, i) => {
                    const meta = SHIPMENT_STATUS_META[event.status] ?? {
                      labelBn: event.status,
                      labelEn: event.status,
                      icon: "•",
                    };
                    return (
                      <li key={`${event.status}-${event.at}`} className="relative flex gap-3 pb-4 last:pb-0">
                        {i < selected.events.length - 1 ? (
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
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="text-xs text-text-muted">
                  এই শিপমেন্টের কোনো ইভেন্ট রেকর্ড হয়নি এখনো।
                </p>
              )}
              <p className="text-xs text-text-muted">
                ইভেন্টগুলো আসল ShipmentEvent রেকর্ড — কুরিয়ার ওয়েবহুক ও অর্ডার-সিঙ্ক যেভাবে
                অবস্থা এগিয়ে নেয়, সেভাবেই এখানে জমা হয়।
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-text-muted">কোনো শিপমেন্ট নির্বাচিত নেই।</p>
          )}
        </Card>

        <Card>
          <h2 className="font-semibold">বুকিং কোথায় হয়?</h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            এই বোর্ড শুধু দেখার জন্য — এখান থেকে বুকিং হয় না। নতুন শিপমেন্ট বুক করতে সংশ্লিষ্ট
            অর্ডারটি খুলুন: অর্ডারের ওয়ার্কস্পেসের <strong>শিপমেন্ট প্যানেল</strong> থেকে পুরো
            অর্ডার বা লাইন-ভিত্তিক স্প্লিট বুকিং করা যায়। বুকিং হলেই তা এই বোর্ডে সঙ্গে সঙ্গে
            দেখা যাবে।
          </p>
          <p className="mt-3 text-sm leading-6 text-text-muted">
            মনে রাখবেন: কুরিয়ার অ্যাডাপ্টরগুলো আপাতত <strong>sandbox</strong> — বুকিংয়ে SBX
            ট্র্যাকিং আইডি আসে এবং কোনো আসল কুরিয়ার কল হয় না। Live provider (Steadfast /
            Pathao / RedX-এর আসল API) এলে একই বোর্ডেই আসল ট্র্যাকিং দেখা যাবে।
          </p>
          <div className="mt-4">
            <Link
              href="/admin/orders"
              className="inline-flex min-h-[44px] items-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              অর্ডার তালিকা খুলুন →
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
