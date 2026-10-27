"use client";

/**
 * BD Tools — পেমেন্ট লিংক panel (Agent 41).
 *
 * Creation goes through the server action in ./actions.ts, which calls
 * the REAL service (src/bd/payment-link.ts, Agent 11 — node:crypto
 * token hashing, so it can never run in the browser) and stores the
 * record in paymentLinkStore (DB-backed, payment_links table). Only
 * the token HASH
 * is ever kept; the plain token comes back exactly once and is shown
 * in the one-time box below — if staff leave this panel without
 * copying it, it cannot be recovered, only a new link can be made.
 *
 * The list shows the hash PREFIX only (first 10 hex chars) — enough
 * for staff to recognise a link, useless for opening it.
 *
 * Amount input is a taka STRING parsed exactly to integer poisha by
 * parseTakaStringToPoisha (no float ever touches money).
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Money } from "@/components/ui/money";
import { DataTable } from "@/components/ui/table";
import { createBdPaymentLinkAction, type PaymentLinkListItemView } from "./actions";
import { formatDateTime, paymentLinkPurpose, paymentLinkPurposes, paymentLinkStatusLabels } from "./labels";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick, type Locale } from "@/i18n/locale";
import { BD_TOOLS_STRINGS, type BdToolsStrings } from "./strings";

/** Exact taka-string -> integer poisha. "500" -> 50000, "500.5" -> 50050,
 *  "500.55" -> 50055. Anything else (3+ decimals, letters, <= 0) -> null. */
export function parseTakaStringToPoisha(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match?.[1]) return null;
  const taka = Number(match[1]);
  const paisa = match[2] ? Number(match[2].padEnd(2, "0")) : 0;
  if (!Number.isSafeInteger(taka)) return null;
  const poisha = taka * 100 + paisa;
  return poisha > 0 ? poisha : null;
}

function statusBadge(link: PaymentLinkListItemView, locale: Locale, s: BdToolsStrings) {
  const label = paymentLinkStatusLabels(locale)[link.status];
  if (link.status === "active") return <Badge tone="success">✓ {label}</Badge>;
  if (link.status === "paid") return <Badge tone="info">✓ {label}</Badge>;
  if (link.status === "expired") return <Badge tone="warning">◷ {label}</Badge>;
  return <Badge tone="neutral">✕ {label}</Badge>;
}

export function PaymentLinksPanel({ initialLinks }: { initialLinks: PaymentLinkListItemView[] }) {
  const { locale } = useLocale();
  const s = pick(locale, BD_TOOLS_STRINGS);
  const [links, setLinks] = useState<PaymentLinkListItemView[]>(initialLinks);
  const [orderId, setOrderId] = useState("");
  const [amountTaka, setAmountTaka] = useState("500");
  const [purpose, setPurpose] = useState<string>("cod_advance");
  const [expiryHours, setExpiryHours] = useState("48");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [once, setOnce] = useState<{ plainToken: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    setError(null);
    setCopied(false);
    const amountPoisha = parseTakaStringToPoisha(amountTaka);
    if (orderId.trim().length === 0) {
      setError(s.plErrOrder);
      return;
    }
    if (amountPoisha === null) {
      setError(s.plErrAmount);
      return;
    }
    const hours = Number(expiryHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 24 * 30) {
      setError(s.plErrExpiry);
      return;
    }
    setSubmitting(true);
    try {
      const res = await createBdPaymentLinkAction({
        orderId: orderId.trim(),
        amountPoisha,
        purpose,
        ttlMinutes: hours * 60,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOnce({ plainToken: res.plainToken, url: res.url });
      setLinks((prev) => [res.link, ...prev.filter((l) => l.id !== res.link.id)]);
    } catch {
      setError(s.plErrCreate);
    } finally {
      setSubmitting(false);
    }
  };

  const copyToken = async () => {
    if (!once) return;
    try {
      await navigator.clipboard.writeText(`/pay/${once.plainToken}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const rows = links.map((link) => ({
    order: <span className="font-mono text-xs">{link.orderId}</span>,
    amount: <Money poisha={link.amountPoisha} />,
    purpose: paymentLinkPurpose(link.purpose, locale),
    status: statusBadge(link, locale, s),
    hash: <span className="font-mono text-xs">{link.tokenHashPrefix}…</span>,
    created: <span className="text-xs">{formatDateTime(link.createdAt, locale)}</span>,
    expires: <span className="text-xs">{formatDateTime(link.expiresAt, locale)}</span>,
  }));

  return (
    <div className="space-y-5">
      <p className="text-sm text-text-muted">
        {s.plIntro1}
        <strong>{s.plIntroStrong1}</strong>
        {s.plIntro2}
        <strong>{s.plIntroStrong2}</strong>
        {s.plIntro3}
        <span className="font-mono text-xs">/pay/&lt;token&gt;</span>
        {s.plIntro4}
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input label={s.plOrderId} name="bd-link-order" value={orderId} onChange={(e) => setOrderId(e.target.value)} required />
        <Input label={s.plAmount} name="bd-link-amount" value={amountTaka} onChange={(e) => setAmountTaka(e.target.value)} inputMode="decimal" required />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">{s.plPurpose}</span>
          <select
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500"
          >
            {paymentLinkPurposes(locale).map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </label>
        <Input label={s.plExpiry} name="bd-link-expiry" value={expiryHours} onChange={(e) => setExpiryHours(e.target.value)} inputMode="numeric" required />
      </div>
      {error ? <p role="alert" className="text-sm text-rose-600">⚠ {error}</p> : null}
      <Button type="button" onClick={submit} loading={submitting}>{s.plCreate}</Button>

      {once ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">{s.plOnceTitle}</p>
          <p className="mt-2 break-all font-mono text-xs">/pay/{once.plainToken}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={copyToken}>
              {copied ? s.copied : s.plCopyPath}
            </Button>
          </div>
          <p className="mt-2 text-xs">
            {s.plFullLink1}
            <span className="break-all font-mono">{once.url}</span>
            {s.plFullLink2}
          </p>
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 text-sm font-semibold">
          {s.plRecentTitle}
          <span className="font-normal text-text-muted">{s.plRecentNote}</span>
        </h3>
        {rows.length > 0 ? (
          <DataTable
            columns={[
              { key: "order", header: s.plColOrder },
              { key: "amount", header: s.plColAmount },
              { key: "purpose", header: s.plColPurpose },
              { key: "status", header: s.plColStatus },
              { key: "hash", header: s.plColHash },
              { key: "created", header: s.plColCreated },
              { key: "expires", header: s.plColExpires },
            ]}
            rows={rows}
          />
        ) : (
          <p className="text-sm text-text-muted">{s.plEmpty}</p>
        )}
      </div>
    </div>
  );
}
