"use client";

/**
 * BD Tools — SMS যাচাই panel (Agent 41).
 *
 * Runs the REAL merchant-SMS parser from src/bd/sms-autoverify.ts
 * (Agent 11, E1) — pure logic, no gateway call. This panel checks a
 * pasted SMS on its own; order matching + duplicate-TrxID registration
 * happens in the order flow / POST /api/v1/admin/bd/sms-verify, which
 * uses autoVerifySmsDb() with the DB-backed Trx claim registry
 * (SmsTrxClaim, doc 21 W0).
 *
 * PRIVACY: only sms.senderPhoneMasked is rendered. The raw sender
 * number the parser also returns is never displayed here, and an
 * OTP-only message is rejected by the parser (reason: no_trxid) — an
 * OTP body is never treated as a payment.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Money } from "@/components/ui/money";
import {
  parseMerchantSms,
  type MerchantProvider,
  type ParseMerchantSmsResult,
} from "@/bd/sms-autoverify";
import { smsRejectReasonLabels } from "./labels";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { BD_TOOLS_STRINGS } from "./strings";

const SAMPLE_BKASH =
  "You have received Tk 1,250.00 from 01712345678. TrxID 9HX7K2P1AB. Balance Tk 45,300.00. 12/03/2026 14:22";

export function SmsVerifyPanel() {
  const { locale } = useLocale();
  const s = pick(locale, BD_TOOLS_STRINGS);
  const [text, setText] = useState(SAMPLE_BKASH);
  const [hint, setHint] = useState<"" | MerchantProvider>("");
  const [result, setResult] = useState<ParseMerchantSmsResult | null>(null);

  const run = () => {
    setResult(parseMerchantSms(text, hint === "" ? undefined : hint));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        {s.smsIntro}
      </p>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-text-muted">{s.smsTextLabel}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className="w-full rounded-[10px] border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100"
          placeholder={s.smsPlaceholder}
        />
      </label>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">{s.smsHintLabel}</span>
          <select
            value={hint}
            onChange={(e) => setHint(e.target.value as "" | MerchantProvider)}
            className="h-10 rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500"
          >
            <option value="">{s.smsHintAuto}</option>
            <option value="bkash">bKash</option>
            <option value="nagad">Nagad</option>
          </select>
        </label>
        <Button type="button" onClick={run}>{s.smsRun}</Button>
      </div>

      {result && !result.ok ? (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <p className="font-semibold">{s.smsRejectedTitle}</p>
          <p className="mt-1">{smsRejectReasonLabels(locale)[result.reason]}</p>
          <p className="mt-1 font-mono text-xs">reason: {result.reason}</p>
        </div>
      ) : null}

      {result?.ok ? (
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{s.smsResult}</h3>
            <Badge tone="success">{interpolate(s.smsPaymentBadge, { provider: result.sms.provider === "bkash" ? "bKash" : "Nagad" })}</Badge>
          </div>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium text-text-muted">TrxID</dt>
              <dd className="font-mono font-medium">{result.sms.trxId}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-text-muted">{s.smsAmount}</dt>
              <dd><Money poisha={result.sms.amountPoisha} /></dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-text-muted">{s.smsSender}</dt>
              <dd className="font-mono">{result.sms.senderPhoneMasked ?? s.smsNotInMessage}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium text-text-muted">{s.smsDate}</dt>
              <dd className="font-mono">{result.sms.transactionDate ?? s.smsNotInMessage}</dd>
            </div>
            {result.sms.balancePoisha !== null ? (
              <div>
                <dt className="text-xs font-medium text-text-muted">{s.smsBalance}</dt>
                <dd><Money poisha={result.sms.balancePoisha} /></dd>
              </div>
            ) : null}
          </dl>
          <p className="mt-3 text-xs text-text-muted">
            {s.smsNote}
          </p>
        </div>
      ) : null}
    </div>
  );
}
