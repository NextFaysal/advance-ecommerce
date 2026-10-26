"use client";

/**
 * Rider PWA home (wave 58) — phone-first delivery list over the
 * EXISTING rider APIs. Nothing here has its own backend:
 *   GET   /api/v1/admin/riders             (rider list + zones)
 *   GET   /api/v1/admin/riders/deliveries  (all deliveries + COD lines)
 *   PATCH /api/v1/admin/riders/deliveries  (transitions + COD entry)
 *   GET   /api/v1/admin/orders/<id>        (lazy per-card detail)
 *
 * Identity honesty: the platform has NO rider self-login and no
 * staff↔rider link — rider APIs run on a STAFF session carrying
 * riders.view / riders.manage. So "my deliveries" means: the rider
 * profile picked on THIS device (localStorage only, changeable any
 * time). The picker is a device convenience, not an account claim;
 * every API call still enforces the staff session + permissions.
 *
 * Offline honesty: the shared service worker caches the app SHELL
 * only and never caches /api/* — this list is live server data or an
 * explicit error, never stale offline data presented as current.
 * Actions are NOT queued offline (the POS offline-sync pattern is a
 * documented v2 candidate, not reused here).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { formatPoisha } from "@/components/ui/money";
import { dhakaYmdOf, todayDhakaYmd } from "@/lib/dhaka-date";
import InstallPrompt from "@/pwa/install-prompt";
import type { RiderDelivery, RiderView, RiderZone } from "@/riders/types";

const RIDER_STORAGE_KEY = "ae-rider-pwa-rider-id";
const POLL_MS = 60_000;

type LoadError = { kind: "locked" | "unauth" | "forbidden" | "error"; message: string };

interface OrderDetail {
  orderNo?: string;
  customerName?: string;
  customerPhone?: string;
  division?: string;
  district?: string;
  upazila?: string;
  addressLine?: string;
  status?: string;
  totalPoisha?: number;
}

function classifyError(status: number, code: string | undefined, message: string): LoadError {
  if (code === "FEATURE_LOCKED") return { kind: "locked", message };
  if (status === 401) return { kind: "unauth", message };
  if (status === 403) return { kind: "forbidden", message };
  return { kind: "error", message };
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

const STATUS_LABEL: Record<RiderDelivery["status"], string> = {
  ASSIGNED: "অ্যাসাইন হয়েছে",
  PICKED_UP: "পিকআপ হয়েছে",
  DELIVERED: "ডেলিভারি সম্পন্ন",
  FAILED: "ব্যর্থ",
};

export default function RiderHome() {
  const [riders, setRiders] = useState<(RiderView & { activeLoad?: number })[]>([]);
  const [zones, setZones] = useState<RiderZone[]>([]);
  const [deliveries, setDeliveries] = useState<RiderDelivery[]>([]);
  const [riderId, setRiderId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<LoadError | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const [r, d] = await Promise.all([
      fetchJson("/api/v1/admin/riders"),
      fetchJson("/api/v1/admin/riders/deliveries"),
    ]);
    const failed = !r.ok ? r : !d.ok ? d : null;
    if (failed) {
      setLoadError(classifyError(failed.status, failed.body?.error?.code, failed.body?.error?.message ?? "ডেটা লোড করা যায়নি।"));
      setLoading(false);
      return;
    }
    setLoadError(null);
    setRiders(r.body?.data?.riders ?? []);
    setZones(r.body?.data?.zones ?? []);
    setDeliveries(d.body?.data?.deliveries ?? []);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    const saved = (() => { try { return localStorage.getItem(RIDER_STORAGE_KEY) ?? ""; } catch { return ""; } })();
    if (saved) setRiderId(saved);
    void load();
    const t = setInterval(() => { void load(true); }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const pickRider = (id: string) => {
    setRiderId(id);
    try { localStorage.setItem(RIDER_STORAGE_KEY, id); } catch { /* private mode — selection just won't persist */ }
  };

  const zoneName = useCallback((id: string) => zones.find((z) => z.id === id)?.name ?? id, [zones]);
  const today = todayDhakaYmd();

  const mine = useMemo(() => deliveries.filter((d) => d.riderId === riderId), [deliveries, riderId]);
  const open = useMemo(
    () => mine.filter((d) => d.status === "ASSIGNED" || d.status === "PICKED_UP").sort((a, b) => a.assignedAt.localeCompare(b.assignedAt)),
    [mine],
  );
  const doneToday = useMemo(
    () => mine.filter((d) => (d.status === "DELIVERED" || d.status === "FAILED") && d.completedAt && dhakaYmdOf(new Date(d.completedAt)) === today),
    [mine, today],
  );
  const cod = useMemo(() => {
    const assignedToday = mine.filter((d) => dhakaYmdOf(new Date(d.assignedAt)) === today);
    return {
      expectedToday: assignedToday.reduce((s, d) => s + d.codAmountPoisha, 0),
      collectedToday: doneToday.filter((d) => d.status === "DELIVERED").reduce((s, d) => s + (d.codCollectedPoisha ?? 0), 0),
      openCod: open.reduce((s, d) => s + d.codAmountPoisha, 0),
    };
  }, [mine, open, doneToday, today]);

  if (loading) {
    return <p className="py-10 text-center text-sm text-text-muted">লোড হচ্ছে…</p>;
  }

  if (loadError) {
    return (
      <div className="rounded-xl bg-surface-2 px-4 py-6 text-center" role="alert">
        <p className="font-medium">
          {loadError.kind === "locked" ? "রাইডার মডিউল বন্ধ আছে" : loadError.kind === "unauth" ? "লগইন মেয়াদ শেষ" : "ডেটা লোড করা যায়নি"}
        </p>
        <p className="mt-2 text-sm text-text-muted">{loadError.message}</p>
        {loadError.kind === "unauth" ? (
          <a href="/admin/login?next=/rider" className="mt-4 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white">আবার লগইন করুন</a>
        ) : (
          <button type="button" onClick={() => void load()} className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white">আবার চেষ্টা করুন</button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <InstallPrompt />

      <label className="block rounded-xl bg-surface-2 px-4 py-3">
        <span className="text-xs text-text-muted">এই ডিভাইসের রাইডার (ডিভাইসে সংরক্ষিত পছন্দ — অ্যাকাউন্ট নয়)</span>
        <select
          value={riderId}
          onChange={(e) => pickRider(e.target.value)}
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-base"
        >
          <option value="">— রাইডার বেছে নিন —</option>
          {riders.map((r) => (
            <option key={r.id} value={r.id}>{r.name} • {zoneName(r.zoneId)}</option>
          ))}
        </select>
      </label>

      {!riderId ? (
        <p className="rounded-xl bg-surface-2 px-4 py-6 text-center text-sm text-text-muted">
          নিজের ডেলিভারি দেখতে উপরে রাইডার বেছে নিন।
        </p>
      ) : (
        <>
          <section className="grid grid-cols-3 gap-2 text-center" aria-label="আজকের COD সারাংশ">
            <div className="rounded-xl bg-surface-2 px-2 py-3">
              <p className="text-[11px] text-text-muted">আজকের COD (প্রত্যাশিত)</p>
              <p className="mt-1 font-semibold tabular-nums">{formatPoisha(cod.expectedToday)}</p>
            </div>
            <div className="rounded-xl bg-surface-2 px-2 py-3">
              <p className="text-[11px] text-text-muted">আজ সংগ্রহ হয়েছে</p>
              <p className="mt-1 font-semibold tabular-nums">{formatPoisha(cod.collectedToday)}</p>
            </div>
            <div className="rounded-xl bg-surface-2 px-2 py-3">
              <p className="text-[11px] text-text-muted">বাকি ডেলিভারির COD</p>
              <p className="mt-1 font-semibold tabular-nums">{formatPoisha(cod.openCod)}</p>
            </div>
          </section>

          <div className="flex items-center justify-between">
            <h2 className="font-semibold">বাকি ডেলিভারি ({open.length})</h2>
            <button type="button" onClick={() => void load()} className="flex items-center gap-1 text-sm text-text-muted">
              <Icon name="refresh-ccw" size={14} /> রিফ্রেশ
            </button>
          </div>
          {open.length === 0 ? (
            <p className="rounded-xl bg-surface-2 px-4 py-6 text-center text-sm text-text-muted">কোনো বাকি ডেলিভারি নেই।</p>
          ) : (
            open.map((d) => (
              <DeliveryCard key={d.id} delivery={d} zoneName={zoneName(d.zoneId)} onChanged={() => void load(true)} />
            ))
          )}

          {doneToday.length > 0 ? (
            <>
              <h2 className="font-semibold">আজ সম্পন্ন ({doneToday.length})</h2>
              {doneToday.map((d) => (
                <div key={d.id} className="rounded-xl border border-border px-4 py-3 text-sm">
                  <span className="font-medium">{STATUS_LABEL[d.status]}</span>
                  <span className="text-text-muted"> • অর্ডার {d.orderId.slice(0, 8)}… • জোন {zoneName(d.zoneId)}</span>
                  {d.status === "DELIVERED" ? (
                    <span className="block text-text-muted">সংগ্রহ: {formatPoisha(d.codCollectedPoisha ?? 0)} / COD {formatPoisha(d.codAmountPoisha)}</span>
                  ) : d.failureReason ? (
                    <span className="block text-text-muted">কারণ: {d.failureReason}</span>
                  ) : null}
                </div>
              ))}
            </>
          ) : null}
        </>
      )}

      <p className="pb-2 text-center text-[11px] text-text-muted">
        তালিকা প্রতি ৬০ সেকেন্ডে নিজে থেকে রিফ্রেশ হয় (polling)।
        {lastUpdated ? ` শেষ আপডেট: ${lastUpdated.toLocaleTimeString("bn-BD", { timeZone: "Asia/Dhaka" })}` : ""}
        {" "}অফলাইনে ডেটা দেখা যাবে না — সংযোগ ফিরলে রিফ্রেশ করুন।
      </p>
    </div>
  );
}

function DeliveryCard({ delivery, zoneName, onChanged }: { delivery: RiderDelivery; zoneName: string; onChanged: () => void }) {
  const [otp, setOtp] = useState("");
  const [collectedTaka, setCollectedTaka] = useState(() => String(delivery.codAmountPoisha / 100));
  const [failReason, setFailReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "error">("idle");
  const [detailError, setDetailError] = useState<string | null>(null);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const res = await fetchJson("/api/v1/admin/riders/deliveries", {
      method: "PATCH",
      body: JSON.stringify({ deliveryId: delivery.id, ...body }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.body?.error?.message ?? "কাজটি করা যায়নি।");
      return;
    }
    onChanged();
  };

  const toggleDetail = async () => {
    if (detail || detailState === "loading") { setDetail(null); setDetailState("idle"); return; }
    setDetailState("loading");
    const res = await fetchJson(`/api/v1/admin/orders/${delivery.orderId}`);
    if (!res.ok) {
      setDetailState("error");
      setDetailError(res.body?.error?.message ?? "অর্ডারের বিবরণ লোড করা যায়নি (orders.view অনুমতি লাগতে পারে)।");
      return;
    }
    setDetail(res.body?.data ?? {});
    setDetailState("idle");
  };

  return (
    <article className="rounded-xl border border-border px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">অর্ডার {delivery.orderId.slice(0, 8)}…</p>
          <p className="text-sm text-text-muted">
            জোন: {zoneName} • অবস্থা: {STATUS_LABEL[delivery.status]}
          </p>
          <p className="text-sm">
            COD সংগ্রহ: <span className="font-semibold tabular-nums">{formatPoisha(delivery.codAmountPoisha)}</span>
            {delivery.codAmountPoisha === 0 ? <span className="text-text-muted"> (প্রিপেইড)</span> : null}
          </p>
        </div>
        <button type="button" onClick={() => void toggleDetail()} className="flex shrink-0 items-center gap-1 text-sm text-text-muted">
          বিবরণ <Icon name="chevron-down" size={14} />
        </button>
      </div>

      {detailState === "loading" ? <p className="mt-2 text-sm text-text-muted">বিবরণ লোড হচ্ছে…</p> : null}
      {detailState === "error" ? <p className="mt-2 text-sm text-red-600" role="alert">{detailError}</p> : null}
      {detail ? (
        <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
          {detail.orderNo ? <p>অর্ডার নম্বর: <span className="font-medium">{detail.orderNo}</span>{detail.status ? ` • ${detail.status}` : ""}</p> : null}
          {detail.customerName ? <p>কাস্টমার: {detail.customerName}</p> : null}
          {detail.customerPhone ? <p>ফোন: {detail.customerPhone}</p> : null}
          {(detail.addressLine || detail.upazila || detail.district) ? (
            <p>ঠিকানা: {[detail.addressLine, detail.upazila, detail.district, detail.division].filter(Boolean).join(", ")}</p>
          ) : null}
          {typeof detail.totalPoisha === "number" ? <p>অর্ডার মোট: <span className="tabular-nums">{formatPoisha(detail.totalPoisha)}</span></p> : null}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-sm text-red-600" role="alert">{error}</p> : null}

      {delivery.status === "ASSIGNED" ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button" disabled={busy}
            onClick={() => void act({ to: "PICKED_UP" })}
            className="flex-1 rounded-lg bg-primary px-3 py-2.5 font-medium text-white disabled:opacity-50"
          >
            <Icon name="package" size={16} /> পিকআপ করেছি
          </button>
        </div>
      ) : null}

      {delivery.status === "PICKED_UP" ? (
        <div className="mt-3 space-y-2">
          <div className="flex gap-2">
            <input
              inputMode="numeric" placeholder="কাস্টমারের OTP কোড"
              value={otp} onChange={(e) => setOtp(e.target.value)}
              className="w-1/2 rounded-lg border border-border bg-surface px-3 py-2"
              aria-label="ডেলিভারি OTP কোড"
            />
            <input
              inputMode="decimal" placeholder="সংগ্রহ (৳)"
              value={collectedTaka} onChange={(e) => setCollectedTaka(e.target.value)}
              className="w-1/2 rounded-lg border border-border bg-surface px-3 py-2"
              aria-label="সংগৃহীত COD টাকা"
            />
          </div>
          <button
            type="button" disabled={busy || otp.trim().length < 4}
            onClick={() => void act({ to: "DELIVERED", otpCode: otp.trim(), collectedPoisha: Math.max(0, Math.round((parseFloat(collectedTaka) || 0) * 100)) })}
            className="w-full rounded-lg bg-primary px-3 py-2.5 font-medium text-white disabled:opacity-50"
          >
            <Icon name="check" size={16} /> ডেলিভারি সম্পন্ন করুন
          </button>
          <p className="text-[11px] text-text-muted">ডেলিভারি সম্পন্ন করতে কাস্টমারের OTP বাধ্যতামূলক (সার্ভার যাচাই করে)।</p>
        </div>
      ) : null}

      {(delivery.status === "ASSIGNED" || delivery.status === "PICKED_UP") ? (
        <div className="mt-2 flex gap-2">
          <input
            placeholder="ব্যর্থ হলে কারণ লিখুন"
            value={failReason} onChange={(e) => setFailReason(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            aria-label="ব্যর্থতার কারণ"
          />
          <button
            type="button" disabled={busy || failReason.trim().length === 0}
            onClick={() => void act({ to: "FAILED", failureReason: failReason.trim() })}
            className="rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50"
          >
            ব্যর্থ
          </button>
        </div>
      ) : null}
    </article>
  );
}
