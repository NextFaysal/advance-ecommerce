"use client";

/**
 * BD Tools — ঠিকানা পার্সার panel (Agent 41).
 *
 * Runs the REAL parser from src/bd/address-parser.ts (Agent 11, E2) in
 * the browser — it is pure logic with no server dependencies. Nothing
 * is re-implemented here; this panel only renders ParsedAddress.
 *
 * This panel parses with FULL_GEO_DICTIONARY (src/bd/geo-dictionary.ts):
 * the full validated BD geo dataset (8 divisions / 64 districts / 504
 * upazilas from packages/db/prisma/data/bd-geo.json) merged with the
 * curated common-places entries (Dhaka areas + misspelling table).
 * parseAddress()'s default remains the curated dictionary. Low
 * confidence (< 0.5) means staff must confirm before courier booking,
 * exactly as the API route (POST /api/v1/admin/bd/address-parse) flags it.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { parseAddress, type ParsedAddress } from "@/bd/address-parser";
import { FULL_GEO_DICTIONARY } from "@/bd/geo-dictionary";
import { matchedByLabels } from "./labels";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick, type Locale } from "@/i18n/locale";
import { BD_TOOLS_STRINGS, type BdToolsStrings } from "./strings";

const SAMPLE = "House 12, Road 5, Mirpur 10, Dhaka";

function confidenceBadge(confidence: number, s: BdToolsStrings) {
  const pct = `${Math.round(confidence * 100)}%`;
  if (confidence >= 0.8) return <Badge tone="success">{interpolate(s.confHigh, { pct })}</Badge>;
  if (confidence >= 0.5) return <Badge tone="warning">{interpolate(s.confMedium, { pct })}</Badge>;
  return <Badge tone="danger">{interpolate(s.confLow, { pct })}</Badge>;
}

function FieldRow({
  label,
  en,
  bn,
  matchedBy,
  locale,
  s,
}: {
  label: string;
  en: string | null;
  bn?: string | null;
  matchedBy: string | null;
  locale: Locale;
  s: BdToolsStrings;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 last:border-0">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      {en ? (
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">
            {en}
            {bn ? <span className="text-text-muted"> ({bn})</span> : null}
          </span>
          {matchedBy ? <Badge tone="info">{matchedByLabels(locale)[matchedBy] ?? matchedBy}</Badge> : null}
        </span>
      ) : (
        <span className="text-sm text-text-muted">{s.notFound}</span>
      )}
    </div>
  );
}

export function AddressParserPanel() {
  const { locale } = useLocale();
  const s = pick(locale, BD_TOOLS_STRINGS);
  const [text, setText] = useState(SAMPLE);
  const [result, setResult] = useState<ParsedAddress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    const trimmed = text.trim();
    if (trimmed.length < 5) {
      setError(s.addrTooShort);
      setResult(null);
      return;
    }
    setError(null);
    setResult(parseAddress(trimmed, FULL_GEO_DICTIONARY));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        {s.addrIntro}
      </p>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-text-muted">{s.addrLabel}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="w-full rounded-[10px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
          placeholder={s.addrPlaceholder}
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-danger">⚠ {error}</p>
      ) : null}
      <Button type="button" onClick={run}>{s.addrRun}</Button>

      {result ? (
        <div className="rounded-xl border border-border bg-surface-2 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-display text-sm font-semibold text-text-main">{s.addrResult}</h3>
            {confidenceBadge(result.confidence, s)}
          </div>
          <FieldRow locale={locale} s={s} label={s.fieldDivision} en={result.division} bn={result.divisionBn} matchedBy={result.matchedBy.division} />
          <FieldRow locale={locale} s={s} label={s.fieldDistrict} en={result.district} bn={result.districtBn} matchedBy={result.matchedBy.district} />
          <FieldRow locale={locale} s={s} label={s.fieldUpazila} en={result.upazila} matchedBy={result.matchedBy.upazila} />
          <FieldRow locale={locale} s={s} label={s.fieldArea} en={result.area} matchedBy={result.matchedBy.area} />
          <div className="pt-2">
            <span className="text-xs font-medium text-text-muted">{s.addrLineLabel}</span>
            <p className="mt-1 text-sm">{result.addressLine}</p>
          </div>
          {result.confidence < 0.5 ? (
            <p className="mt-3 text-sm text-warning-solid">
              {s.lowConfNote}
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-text-muted">
        {s.addrNote}
      </p>
    </div>
  );
}
