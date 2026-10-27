"use client";

/**
 * Rental config editor — self-fetching client card (ADV-23
 * vertical 3, wave 56). Edits the Setting doc `rental.config`
 * through PUT /api/v1/admin/rental/config (settings.edit + reason,
 * audited server-side). Rentable variants are one variant ID per
 * line — a variant is rentable ONLY while its ID is on this list
 * (the config list is the v1 rental marker; product types have no
 * RENTAL value). Money fields are edited in TAKA here and stored
 * as integer poisha (the house money rule); the card labels say
 * what v1 does NOT automate: the late fee is never auto-charged
 * and the deposit refund on return is manual.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { RENTALS_STRINGS } from "./strings";

interface RentalConfig {
  rentalVariantIds: string[];
  maxRentalDays: number;
  depositMode: "none" | "fixed" | "percent";
  depositFixedPoisha: number;
  depositPercentBps: number;
  lateFeePerDayPoisha: number;
}

interface ConfigData {
  moduleEnabled: boolean;
  source: "saved" | "default";
  config: RentalConfig;
}

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-main";

/** Poisha -> editable taka string (display/entry only). */
function poishaToTakaInput(poisha: number): string {
  return poisha % 100 === 0 ? String(poisha / 100) : (poisha / 100).toFixed(2);
}

/** Taka input -> poisha, or null when the text is not a clean
 *  non-negative amount. */
function takaInputToPoisha(text: string): number | null {
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function RentalsConfigCard() {
  const { locale } = useLocale();
  const s = pick(locale, RENTALS_STRINGS);
  const [data, setData] = useState<ConfigData | null>(null);
  const [variantIdsText, setVariantIdsText] = useState("");
  const [maxRentalDays, setMaxRentalDays] = useState(30);
  const [depositMode, setDepositMode] = useState<"none" | "fixed" | "percent">("none");
  const [depositFixedTaka, setDepositFixedTaka] = useState("0");
  const [depositPercent, setDepositPercent] = useState("0");
  const [lateFeeTaka, setLateFeeTaka] = useState("0");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/rental/config", { cache: "no-store" });
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
      setVariantIdsText(cfg.rentalVariantIds.join("\n"));
      setMaxRentalDays(cfg.maxRentalDays);
      setDepositMode(cfg.depositMode);
      setDepositFixedTaka(poishaToTakaInput(cfg.depositFixedPoisha));
      setDepositPercent(String(cfg.depositPercentBps / 100));
      setLateFeeTaka(poishaToTakaInput(cfg.lateFeePerDayPoisha));
      setError(null);
    } catch {
      setError(s.configLoadNetwork);
    }
  }, [s]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (busy) return;
    if (!reason.trim()) {
      setError(s.reasonRequired);
      return;
    }
    const depositFixedPoisha = takaInputToPoisha(depositFixedTaka);
    const lateFeePerDayPoisha = takaInputToPoisha(lateFeeTaka);
    const percentValue = Number(depositPercent);
    if (depositFixedPoisha === null || lateFeePerDayPoisha === null) {
      setError(s.amountsInvalid);
      return;
    }
    if (!Number.isFinite(percentValue) || percentValue < 0 || percentValue > 100) {
      setError(s.percentInvalid);
      return;
    }
    const rentalVariantIds = variantIdsText
      .split("\n")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/admin/rental/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rentalVariantIds,
          maxRentalDays,
          depositMode,
          depositFixedPoisha,
          depositPercentBps: Math.round(percentValue * 100),
          lateFeePerDayPoisha,
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
    <section aria-label={s.configAria} className="rounded-2xl border border-border bg-card p-5 shadow-card">
      <h2 className="text-base font-bold text-text-main">{s.configTitle}</h2>
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
          <span className="mb-1.5 block text-sm font-medium text-text-main">{s.maxRentalDays}</span>
          <input
            type="number"
            min={1}
            max={365}
            value={maxRentalDays}
            onChange={(e) => setMaxRentalDays(Number(e.target.value))}
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">{s.depositType}</span>
          <select
            value={depositMode}
            onChange={(e) => setDepositMode(e.target.value as "none" | "fixed" | "percent")}
            className={INPUT_CLASS}
          >
            <option value="none">{s.depositNone}</option>
            <option value="fixed">{s.depositFixed}</option>
            <option value="percent">{s.depositPercent}</option>
          </select>
        </label>
        {depositMode === "fixed" && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-text-main">{s.depositAmount}</span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={depositFixedTaka}
              onChange={(e) => setDepositFixedTaka(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        )}
        {depositMode === "percent" && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-text-main">{s.depositRate}</span>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={depositPercent}
              onChange={(e) => setDepositPercent(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
        )}
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">{s.lateFeeLabel}</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={lateFeeTaka}
            onChange={(e) => setLateFeeTaka(e.target.value)}
            className={INPUT_CLASS}
          />
          <span className="mt-1 block text-xs text-text-muted">{s.lateFeeHelp}</span>
        </label>
      </div>
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
        <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
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
