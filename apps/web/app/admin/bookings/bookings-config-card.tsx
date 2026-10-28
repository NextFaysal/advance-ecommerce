"use client";

/**
 * Services config editor — self-fetching client card (ADV-23,
 * wave 56). Edits the Setting doc `services.config` through
 * PUT /api/v1/admin/services/config (settings.edit + reason,
 * audited server-side). Bookable variants are one variant ID per
 * line — a variant is a bookable service ONLY while its ID is on
 * this list (the config list is the v1 service marker; product
 * types have no SERVICE value).
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { BOOKINGS_STRINGS } from "./strings";

interface ServicesConfig {
  slotMinutes: 15 | 30 | 60;
  openTime: string;
  closeTime: string;
  closedWeekdays: number[];
  advanceDays: number;
  bufferMinutes: number;
  capacityPerSlot: number;
  serviceVariantIds: string[];
}

interface ConfigData {
  moduleEnabled: boolean;
  source: "saved" | "default";
  config: ServicesConfig;
}

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-main";

export function BookingsConfigCard() {
  const { locale } = useLocale();
  const s = pick(locale, BOOKINGS_STRINGS);
  const weekdayLabels = [s.weekday0, s.weekday1, s.weekday2, s.weekday3, s.weekday4, s.weekday5, s.weekday6];
  const [data, setData] = useState<ConfigData | null>(null);
  const [slotMinutes, setSlotMinutes] = useState<15 | 30 | 60>(30);
  const [openTime, setOpenTime] = useState("09:00");
  const [closeTime, setCloseTime] = useState("21:00");
  const [closedWeekdays, setClosedWeekdays] = useState<number[]>([]);
  const [advanceDays, setAdvanceDays] = useState(14);
  const [bufferMinutes, setBufferMinutes] = useState(0);
  const [capacityPerSlot, setCapacityPerSlot] = useState(1);
  const [variantIdsText, setVariantIdsText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/services/config", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as {
        data?: ConfigData;
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.data) {
        setError(json?.error?.message ?? s.configLoadFailed);
        return;
      }
      const cfg = json.data.config;
      setData(json.data);
      setSlotMinutes(cfg.slotMinutes);
      setOpenTime(cfg.openTime);
      setCloseTime(cfg.closeTime);
      setClosedWeekdays(cfg.closedWeekdays);
      setAdvanceDays(cfg.advanceDays);
      setBufferMinutes(cfg.bufferMinutes);
      setCapacityPerSlot(cfg.capacityPerSlot);
      setVariantIdsText(cfg.serviceVariantIds.join("\n"));
      setError(null);
    } catch {
      setError(s.configLoadNetwork);
    }
  }, [s]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleWeekday(day: number) {
    setClosedWeekdays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );
  }

  async function save() {
    if (busy) return;
    if (!reason.trim()) {
      setError(s.reasonRequired);
      return;
    }
    const serviceVariantIds = variantIdsText
      .split("\n")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/admin/services/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slotMinutes,
          openTime,
          closeTime,
          closedWeekdays,
          advanceDays,
          bufferMinutes,
          capacityPerSlot,
          serviceVariantIds,
          reason: reason.trim(),
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        data?: ConfigData;
        error?: { message?: string; details?: string[] };
      } | null;
      if (!res.ok || !json?.data) {
        setError(
          json?.error?.details?.join("; ") ?? json?.error?.message ?? s.configSaveFailed,
        );
        return;
      }
      setData(json.data);
      setReason("");
      setNotice(s.configSaved);
      setError(null);
    } catch {
      setError(s.configSaveNetwork);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={s.configAria} className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
      <h2 className="font-display text-base font-semibold text-text-main">{s.configTitle}</h2>
      <p className="mt-1 text-sm text-text-muted">
        {s.configIntro}
        {data && (
          <>
            {" "}
            {s.sourceLabel}{" "}
            <strong className="text-text-main">{data.source === "saved" ? s.sourceSaved : s.sourceDefault}</strong>
            {!data.moduleEnabled && <> · {s.moduleOffNote}</>}
          </>
        )}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">{s.slotLength}</span>
          <select
            value={slotMinutes}
            onChange={(e) => setSlotMinutes(Number(e.target.value) as 15 | 30 | 60)}
            className={INPUT_CLASS}
          >
            <option value={15}>{interpolate(s.minutes, { n: 15 })}</option>
            <option value={30}>{interpolate(s.minutes, { n: 30 })}</option>
            <option value={60}>{interpolate(s.minutes, { n: 60 })}</option>
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">{s.openTime}</span>
          <input type="time" value={openTime} onChange={(e) => setOpenTime(e.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">{s.closeTime}</span>
          <input type="time" value={closeTime} onChange={(e) => setCloseTime(e.target.value)} className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">{s.advanceDays}</span>
          <input
            type="number"
            min={0}
            max={60}
            value={advanceDays}
            onChange={(e) => setAdvanceDays(Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">{s.bufferMinutes}</span>
          <input
            type="number"
            min={0}
            max={120}
            value={bufferMinutes}
            onChange={(e) => setBufferMinutes(Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">{s.capacityPerSlot}</span>
          <input
            type="number"
            min={1}
            max={20}
            value={capacityPerSlot}
            onChange={(e) => setCapacityPerSlot(Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </label>
      </div>
      <fieldset className="mt-4">
        <legend className="mb-1.5 text-sm font-medium text-text-main">{s.closedWeekdaysLegend}</legend>
        <div className="flex flex-wrap gap-2">
          {weekdayLabels.map((label, day) => (
            <label
              key={day}
              className="flex cursor-pointer items-center gap-2 rounded-lg border border-border bg-surface-2/60 px-3 py-1.5 text-sm text-text-main"
            >
              <input
                type="checkbox"
                checked={closedWeekdays.includes(day)}
                onChange={() => toggleWeekday(day)}
                className="h-4 w-4 accent-brand-600"
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-sm font-medium text-text-main">{s.variantIdsLabel}</span>
        <textarea
          value={variantIdsText}
          onChange={(e) => setVariantIdsText(e.target.value)}
          rows={4}
          placeholder={"variant-id-1\nvariant-id-2"}
          className={`${INPUT_CLASS} font-mono text-xs`}
        />
        <span className="mt-1 block text-xs text-text-muted">{s.variantIdsHelp}</span>
      </label>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-sm font-medium text-text-main">{s.reasonLabel}</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={s.reasonPlaceholder}
          className={INPUT_CLASS}
        />
      </label>
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 rounded-xl bg-success-soft px-4 py-3 text-sm font-medium text-success-solid">
          {notice}
        </p>
      )}
      <div className="mt-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-50"
        >
          {busy ? s.saving : s.saveConfig}
        </button>
      </div>
    </section>
  );
}
