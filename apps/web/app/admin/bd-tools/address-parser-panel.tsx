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
import { MATCHED_BY_LABELS_BN } from "./labels";

const SAMPLE = "House 12, Road 5, Mirpur 10, Dhaka";

function confidenceBadge(confidence: number) {
  const pct = `${Math.round(confidence * 100)}%`;
  if (confidence >= 0.8) return <Badge tone="success">✓ উচ্চ আত্মবিশ্বাস · {pct}</Badge>;
  if (confidence >= 0.5) return <Badge tone="warning">◐ মাঝারি আত্মবিশ্বাস · {pct}</Badge>;
  return <Badge tone="danger">⚠ কম আত্মবিশ্বাস · {pct} — স্টাফ নিশ্চিত করুন</Badge>;
}

function FieldRow({ label, en, bn, matchedBy }: { label: string; en: string | null; bn?: string | null; matchedBy: string | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 last:border-0">
      <span className="text-xs font-medium text-text-muted">{label}</span>
      {en ? (
        <span className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">
            {en}
            {bn ? <span className="text-text-muted"> ({bn})</span> : null}
          </span>
          {matchedBy ? <Badge tone="info">{MATCHED_BY_LABELS_BN[matchedBy] ?? matchedBy}</Badge> : null}
        </span>
      ) : (
        <span className="text-sm text-text-muted">পাওয়া যায়নি</span>
      )}
    </div>
  );
}

export function AddressParserPanel() {
  const [text, setText] = useState(SAMPLE);
  const [result, setResult] = useState<ParsedAddress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    const trimmed = text.trim();
    if (trimmed.length < 5) {
      setError("কমপক্ষে ৫ অক্ষরের ঠিকানা লিখুন।");
      setResult(null);
      return;
    }
    setError(null);
    setResult(parseAddress(trimmed, FULL_GEO_DICTIONARY));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        মেসেঞ্জার / হোয়াটসঅ্যাপ / ফোনে পাওয়া যেকোনো ঠিকানা পেস্ট করুন — বাংলা, ইংরেজি বা Banglish।
        পার্সার Division &gt; District &gt; Upazila &gt; Area বের করে দেবে; যেটা মিলবে না সেটা বাকি ঠিকানা লাইনে থাকবে, কখনো হারাবে না।
      </p>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-text-muted">ঠিকানা *</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="w-full rounded-[10px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
          placeholder="যেমন: বাসা ৩, সাভার, ঢাকা — অথবা Dacca, Narayangonj"
        />
      </label>
      {error ? (
        <p role="alert" className="text-sm text-rose-600">⚠ {error}</p>
      ) : null}
      <Button type="button" onClick={run}>ঠিকানা পার্স করুন</Button>

      {result ? (
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">পার্স করা ফলাফল</h3>
            {confidenceBadge(result.confidence)}
          </div>
          <FieldRow label="বিভাগ (Division)" en={result.division} bn={result.divisionBn} matchedBy={result.matchedBy.division} />
          <FieldRow label="জেলা (District)" en={result.district} bn={result.districtBn} matchedBy={result.matchedBy.district} />
          <FieldRow label="উপজেলা (Upazila)" en={result.upazila} matchedBy={result.matchedBy.upazila} />
          <FieldRow label="এলাকা (Area)" en={result.area} matchedBy={result.matchedBy.area} />
          <div className="pt-2">
            <span className="text-xs font-medium text-text-muted">বাকি ঠিকানা লাইন (বাসা / রোড / হোল্ডিং)</span>
            <p className="mt-1 text-sm">{result.addressLine}</p>
          </div>
          {result.confidence < 0.5 ? (
            <p className="mt-3 text-sm text-amber-700">
              ⚠ আত্মবিশ্বাস ৫০%-এর নিচে — কুরিয়ার বুকিংয়ের আগে স্টাফকে ঠিকানা নিশ্চিত করতে হবে।
            </p>
          ) : null}
        </div>
      ) : null}
      <p className="text-xs text-text-muted">
        দ্রষ্টব্য: অভিধানটি সাধারণ জায়গার তালিকা (curated), পূর্ণ BBS জিও ডেটাসেট নয় — seed-এর জিও টেবিল যুক্ত হলে একই পার্সারে সেটাই ব্যবহৃত হবে।
      </p>
    </div>
  );
}
