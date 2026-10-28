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
import { EmptyState } from "@/components/ui/empty-state";
import { Icon, type IconName } from "@/components/ui/icon";
import { Money, formatPoisha } from "@/components/ui/money";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import type { ShipmentBoardRow, ShipmentsBoardSummary } from "@/shipments/board";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick, type Locale } from "@/i18n/locale";
import { SHIPMENTS_STRINGS, type ShipmentsStrings } from "./strings";

/* ------------------------------------------------------------------ */
/* Display language (moved from the deleted demo-data.ts; the values   */
/* are presentation only — statuses themselves come from the rows).    */
/* ------------------------------------------------------------------ */

type StatusTone = "warning" | "info" | "success" | "danger" | "brand" | "neutral";

const SHIPMENT_STATUS_META: Record<string, { labelKey: keyof ShipmentsStrings; icon: string; tone: StatusTone }> = {
  CREATED: { labelKey: "stCreated", icon: "📦", tone: "neutral" },
  PICKED_UP: { labelKey: "stPickedUp", icon: "📥", tone: "info" },
  IN_TRANSIT: { labelKey: "stInTransit", icon: "🚚", tone: "info" },
  OUT_FOR_DELIVERY: { labelKey: "stOutForDelivery", icon: "🛵", tone: "brand" },
  DELIVERED: { labelKey: "stDelivered", icon: "✓", tone: "success" },
  FAILED: { labelKey: "stFailed", icon: "⚠", tone: "danger" },
  RETURNING: { labelKey: "stReturning", icon: "↩", tone: "warning" },
  RETURNED: { labelKey: "stReturned", icon: "↩", tone: "warning" },
};

function statusLabel(status: string, s: ShipmentsStrings): string {
  const meta = SHIPMENT_STATUS_META[status];
  return meta ? s[meta.labelKey] : status;
}

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

const COURIER_LABEL_KEYS: Record<string, keyof ShipmentsStrings> = {
  steadfast: "courierSteadfast",
  pathao: "courierPathao",
  redx: "courierRedx",
};

function courierLabel(provider: string, s: ShipmentsStrings): string {
  const key = COURIER_LABEL_KEYS[provider];
  return key ? s[key] : provider;
}

function isProblemStatus(status: string): boolean {
  return status === "FAILED" || status === "RETURNING" || status === "RETURNED";
}

function dhakaDateTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
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
  const { locale } = useLocale();
  const s = pick(locale, SHIPMENTS_STRINGS);
  const meta = SHIPMENT_STATUS_META[status] ?? { labelKey: null, icon: "•", tone: "neutral" as StatusTone };
  return (
    <Badge tone={meta.tone}>
      <span aria-hidden="true">{meta.icon}</span> {meta.labelKey ? s[meta.labelKey] : status}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/* OD5 parcel stepper — same pipeline language as the order workspace  */
/* shipments panel (status only; no fabricated timestamps).            */
/* ------------------------------------------------------------------ */

const PIPELINE_STEPS = [
  { status: "CREATED", labelKey: "stepCreated", icon: "package" },
  { status: "PICKED_UP", labelKey: "stepPickedUp", icon: "box" },
  { status: "IN_TRANSIT", labelKey: "stepInTransit", icon: "truck" },
  { status: "OUT_FOR_DELIVERY", labelKey: "stepOutForDelivery", icon: "arrow-right" },
  { status: "DELIVERED", labelKey: "stepDelivered", icon: "check" },
] as const satisfies readonly { status: string; labelKey: keyof ShipmentsStrings; icon: IconName }[];

const OFF_PATH: Record<string, { labelKey: keyof ShipmentsStrings; icon: IconName; cls: string }> = {
  FAILED: { labelKey: "offPathFailed", icon: "alert", cls: "border-danger/30 bg-danger-soft text-danger" },
  RETURNING: { labelKey: "offPathReturning", icon: "rotate-ccw", cls: "border-warning-solid/30 bg-warning-soft text-warning-solid" },
  RETURNED: { labelKey: "offPathReturned", icon: "rotate-ccw", cls: "border-border bg-surface-2 text-text-muted" },
};

function ParcelStepper({ status }: { status: string }) {
  const { locale } = useLocale();
  const s = pick(locale, SHIPMENTS_STRINGS);
  const activeIdx = PIPELINE_STEPS.findIndex((step) => step.status === status);
  if (activeIdx === -1) {
    const off = OFF_PATH[status];
    if (!off) return null;
    return (
      <p className={`mt-3 flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium ${off.cls}`}>
        <Icon name={off.icon} size={16} />
        {s[off.labelKey]}
      </p>
    );
  }
  return (
    <ol className="mt-3 flex items-start" aria-label={interpolate(s.stepperAria, { label: s[PIPELINE_STEPS[activeIdx]!.labelKey] })}>
      {PIPELINE_STEPS.map((step, idx) => {
        const done = idx < activeIdx || status === "DELIVERED";
        const active = idx === activeIdx && status !== "DELIVERED";
        return (
          <li key={step.status} className={`flex items-start ${idx > 0 ? "flex-1" : ""}`}>
            {idx > 0 && (
              <span aria-hidden="true" className={`mx-1 mt-[13px] h-0.5 flex-1 rounded ${idx <= activeIdx ? "bg-success-solid" : "bg-border"}`} />
            )}
            <span className="flex w-14 flex-col items-center gap-1 text-center">
              <span
                aria-hidden="true"
                className={`flex h-[27px] w-[27px] items-center justify-center rounded-full ${
                  done
                    ? "bg-success-solid text-white"
                    : active
                      ? "bg-brand-600 text-white ring-4 ring-brand-100"
                      : "bg-surface-2 text-text-subtle"
                }`}
              >
                <Icon name={done ? "check" : step.icon} size={14} />
              </span>
              <span className={`text-xs leading-tight ${done || active ? "font-semibold text-text-main" : "text-text-muted"}`}>
                {s[step.labelKey]}
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
  const { locale } = useLocale();
  const str = pick(locale, SHIPMENTS_STRINGS);
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
      <span className="inline-flex flex-wrap items-center gap-2">
        <Link
          href={`/admin/orders/${s.orderId}`}
          className="tnum font-mono tabular-nums text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          #{s.orderNo}
          {isProblemStatus(s.status) ? (
            <span className="ml-1 text-danger" aria-hidden="true">⚠</span>
          ) : null}
        </Link>
        {s.packed ? (
          <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-semibold text-success-solid">
            {str.packedBadge}
          </span>
        ) : null}
      </span>
    ),
    courier: courierLabel(s.provider, str),
    tracking: <span className="tnum font-mono text-xs tabular-nums">{s.trackingId ?? "—"}</span>,
    destination: <span>{s.district ?? "—"}</span>,
    weight: <span className="tnum tabular-nums">{formatWeight(s.weightGrams)}</span>,
    charge: <Money poisha={s.chargePoisha} />,
    cod:
      s.codAmountPoisha > 0 ? (
        <Money poisha={s.codAmountPoisha} />
      ) : (
        <span className="text-text-muted">{str.prepaid}</span>
      ),
    status: <ShipmentStatusBadge status={s.status} />,
    created: (
      <span className="tnum font-mono text-xs tabular-nums">{dhakaDateTime(s.createdAt, locale)}</span>
    ),
    action: (
      <span className="flex items-center gap-2">
        <Button
          size="sm"
          variant={selected?.id === s.id ? "secondary" : "outline"}
          onClick={() => setSelectedId(s.id)}
          aria-pressed={selected?.id === s.id}
        >
          {str.details}
        </Button>
        <Link
          href={`/admin/orders/${s.orderId}`}
          className="whitespace-nowrap text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          {str.workspaceLink}
        </Link>
      </span>
    ),
  }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={str.statTotal} value={String(summary.total)} delta={str.statTotalDelta} icon="🚚" />
        <StatCard
          label={str.statInTransit}
          value={String(summary.inTransit)}
          delta={str.statInTransitDelta}
          icon="🛵"
        />
        <StatCard
          label={str.statDelivered}
          value={String(summary.delivered)}
          delta={str.statDeliveredDelta}
          icon="✓"
        />
        <StatCard
          label={str.statCodOutstanding}
          value={formatPoisha(summary.codOutstandingPoisha)}
          delta={str.statCodDelta}
          icon="💰"
        />
      </div>

      {summary.total > rows.length ? (
        <p className="text-sm text-text-muted">
          {interpolate(str.showingLatest, { shown: rows.length, total: summary.total })}
        </p>
      ) : null}

      {problemShipments.length > 0 ? (
        <section className="space-y-3" aria-label={str.problemAria}>
          <h2 className="font-display text-base font-semibold text-text-main">
            <span aria-hidden="true">⚠</span> {interpolate(str.problemTitle, { count: problemShipments.length })}
          </h2>
          {problemShipments.map((s) => (
            <p key={s.id} className="rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
              <ShipmentStatusBadge status={s.status} />{" "}
              <span className="font-mono">{s.trackingId ?? "—"}</span>{" "}
              {str.orderWord}{" "}
              <Link href={`/admin/orders/${s.orderId}`} className="font-medium underline">
                #{s.orderNo}
              </Link>{" "}
              {interpolate(str.problemMeta, {
                courier: courierLabel(s.provider, str),
                cod: s.codAmountPoisha > 0 ? formatPoisha(s.codAmountPoisha) : str.prepaid,
              })}
            </p>
          ))}
        </section>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title={str.emptyTitle} description={str.emptyDesc} />
      ) : (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label={str.filterByStatusAria}>
            <button
              type="button"
              role="tab"
              aria-selected={statusFilter === "ALL"}
              onClick={() => setStatusFilter("ALL")}
              className={`min-h-[44px] rounded-full px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${statusFilter === "ALL" ? "bg-brand-600 text-white" : "bg-surface-2 text-text-muted hover:text-text-main"}`}
            >
              {interpolate(str.allWithCount, { count: rows.length })}
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
                  className={`min-h-[44px] rounded-full px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${statusFilter === status ? "bg-brand-600 text-white" : "bg-surface-2 text-text-muted hover:text-text-main"}`}
                >
                  <span aria-hidden="true">{meta.icon}</span> {interpolate(str.tabWithCount, { label: statusLabel(status, str), count })}
                </button>
              );
            })}
          </div>
          {providers.length > 1 ? (
            <div className="flex flex-wrap items-center gap-2" aria-label={str.filterByCourierAria}>
              <button
                type="button"
                onClick={() => setCourierFilter("all")}
                aria-pressed={courierFilter === "all"}
                className={`min-h-[44px] rounded-full px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${courierFilter === "all" ? "bg-brand-100 text-brand-700" : "bg-surface-2 text-text-muted hover:text-text-main"}`}
              >
                {str.allCouriers}
              </button>
              {providers.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setCourierFilter(p)}
                  aria-pressed={courierFilter === p}
                  className={`min-h-[44px] rounded-full px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 ${courierFilter === p ? "bg-brand-100 text-brand-700" : "bg-surface-2 text-text-muted hover:text-text-main"}`}
                >
                  {courierLabel(p, str)}
                </button>
              ))}
            </div>
          ) : null}

          <div className="hidden md:block">
            <DataTable
              caption={str.tableCaption}
              columns={[
                { key: "order", header: str.colOrder },
                { key: "courier", header: str.colCourier },
                { key: "tracking", header: str.colTracking },
                { key: "destination", header: str.colDestination },
                { key: "weight", header: str.colWeight },
                { key: "charge", header: str.colCharge },
                { key: "cod", header: str.colCod },
                { key: "status", header: str.colStatus },
                { key: "created", header: str.colCreated },
                { key: "action", header: "" },
              ]}
              rows={tableRows}
            />
          </div>
          <div className="space-y-3 md:hidden">
            {filtered.map((s) => (
              <Card key={s.id} className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link
                    href={`/admin/orders/${s.orderId}`}
                    className="tnum font-mono tabular-nums text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                  >
                    #{s.orderNo}
                  </Link>
                  <ShipmentStatusBadge status={s.status} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-text-muted">{str.colCourier}</dt>
                    <dd>{courierLabel(s.provider, str)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-muted">{str.colDestination}</dt>
                    <dd>{s.district ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-muted">{str.colTracking}</dt>
                    <dd className="tnum font-mono text-xs tabular-nums">{s.trackingId ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-muted">{str.colWeight}</dt>
                    <dd className="tnum tabular-nums">{formatWeight(s.weightGrams)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-muted">{str.colCharge}</dt>
                    <dd><Money poisha={s.chargePoisha} /></dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-muted">{str.colCod}</dt>
                    <dd>{s.codAmountPoisha > 0 ? <Money poisha={s.codAmountPoisha} /> : <span className="text-text-muted">{str.prepaid}</span>}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-xs text-text-muted">{str.colCreated}</dt>
                    <dd className="tnum font-mono text-xs tabular-nums">{dhakaDateTime(s.createdAt, locale)}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={selected?.id === s.id ? "secondary" : "outline"}
                    onClick={() => setSelectedId(s.id)}
                    aria-pressed={selected?.id === s.id}
                  >
                    {str.details}
                  </Button>
                  <Link
                    href={`/admin/orders/${s.orderId}`}
                    className="whitespace-nowrap text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                  >
                    {str.workspaceLink}
                  </Link>
                </div>
              </Card>
            ))}
          </div>
          {filtered.length === 0 ? (
            <EmptyState title={str.filteredEmptyTitle} description={str.filteredEmptyDesc} />
          ) : null}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="font-display text-base font-semibold text-text-main">{str.timelineTitle}</h2>
          {selected ? (
            <div className="mt-3 space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="tnum font-mono text-xs tabular-nums">{selected.trackingId ?? "—"}</span>
                <ShipmentStatusBadge status={selected.status} />
                <span className="text-text-muted">
                  {str.orderWord}{" "}
                  <Link href={`/admin/orders/${selected.orderId}`} className="font-medium text-primary hover:underline">
                    #{selected.orderNo}
                  </Link>{" "}
                  · {courierLabel(selected.provider, str)}
                </span>
                {selected.packed ? (
                  <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-semibold text-success-solid">
                    {selected.packedPickListId
                      ? interpolate(str.packedWithList, { id: selected.packedPickListId.slice(0, 8) })
                      : str.packedBadge}
                  </span>
                ) : null}
              </div>
              <ParcelStepper status={selected.status} />
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-text-muted">{str.dtDestination}</dt>
                  <dd>{selected.district ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-text-muted">{str.dtWeight}</dt>
                  <dd className="tnum tabular-nums">{formatWeight(selected.weightGrams)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-text-muted">{str.dtCharge}</dt>
                  <dd><Money poisha={selected.chargePoisha} /></dd>
                </div>
                <div>
                  <dt className="text-xs text-text-muted">{str.dtCod}</dt>
                  <dd>
                    {selected.codAmountPoisha > 0 ? (
                      <Money poisha={selected.codAmountPoisha} />
                    ) : (
                      str.prepaid
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-text-muted">{str.dtBookingTime}</dt>
                  <dd className="tnum font-mono text-xs tabular-nums">{dhakaDateTime(selected.createdAt, locale)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-text-muted">{str.dtLastUpdate}</dt>
                  <dd className="tnum font-mono text-xs tabular-nums">{dhakaDateTime(selected.updatedAt, locale)}</dd>
                </div>
              </dl>
              {selected.events.length > 0 ? (
                <ol className="space-y-0">
                  {selected.events.map((event, i) => {
                    const meta = SHIPMENT_STATUS_META[event.status] ?? null;
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
                          {meta?.icon ?? "•"}
                        </span>
                        <div>
                          <p className="text-sm font-medium">{statusLabel(event.status, str)}</p>
                          <p className="tnum font-mono text-xs tabular-nums text-text-muted">
                            {dhakaDateTime(event.at, locale)}
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="text-xs text-text-muted">{str.noEvents}</p>
              )}
              <p className="text-xs text-text-muted">{str.eventsNote}</p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-text-muted">{str.noSelection}</p>
          )}
        </Card>

        <Card>
          <h2 className="font-display text-base font-semibold text-text-main">{str.bookingTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            {str.bookingDesc1Before}<strong>{str.bookingDesc1Strong}</strong>{str.bookingDesc1After}
          </p>
          <p className="mt-3 text-sm leading-6 text-text-muted">
            {str.bookingDesc2Before}<strong>{str.bookingDesc2Strong}</strong>{str.bookingDesc2After}
          </p>
          <div className="mt-4">
            <Link
              href="/admin/orders"
              className="inline-flex min-h-[44px] items-center rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
            >
              {str.openOrdersLink}
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
