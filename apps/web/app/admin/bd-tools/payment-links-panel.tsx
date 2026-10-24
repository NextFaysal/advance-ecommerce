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
import {
  PAYMENT_LINK_PURPOSES,
  PAYMENT_LINK_STATUS_LABELS_BN,
  formatDateTimeBn,
  paymentLinkPurposeBn,
} from "./labels";

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

function statusBadge(link: PaymentLinkListItemView) {
  const label = PAYMENT_LINK_STATUS_LABELS_BN[link.status];
  if (link.status === "active") return <Badge tone="success">✓ {label}</Badge>;
  if (link.status === "paid") return <Badge tone="info">✓ {label}</Badge>;
  if (link.status === "expired") return <Badge tone="warning">◷ {label}</Badge>;
  return <Badge tone="neutral">✕ {label}</Badge>;
}

export function PaymentLinksPanel({ initialLinks }: { initialLinks: PaymentLinkListItemView[] }) {
  const [links, setLinks] = useState<PaymentLinkListItemView[]>(initialLinks);
  const [orderId, setOrderId] = useState("ORD-100244");
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
      setError("অর্ডার আইডি লিখুন।");
      return;
    }
    if (amountPoisha === null) {
      setError("পরিমাণ সঠিক নয় — টাকায় লিখুন, সর্বোচ্চ ২ দশমিক ঘর (যেমন 500 বা 500.50)।");
      return;
    }
    const hours = Number(expiryHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 24 * 30) {
      setError("মেয়াদ ১ ঘণ্টা থেকে ৩০ দিনের মধ্যে হতে হবে।");
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
      setError("লিংক তৈরি করা যায়নি — আবার চেষ্টা করুন।");
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
    purpose: paymentLinkPurposeBn(link.purpose),
    status: statusBadge(link),
    hash: <span className="font-mono text-xs">{link.tokenHashPrefix}…</span>,
    created: <span className="text-xs">{formatDateTimeBn(link.createdAt)}</span>,
    expires: <span className="text-xs">{formatDateTimeBn(link.expiresAt)}</span>,
  }));

  return (
    <div className="space-y-5">
      <p className="text-sm text-text-muted">
        গ্রাহককে পাঠানোর জন্য একবার ব্যবহারযোগ্য পেমেন্ট লিংক তৈরি করুন (COD অগ্রিম, আংশিক বা বকেয়া)।
        সিস্টেমে শুধু টোকেনের <strong>হ্যাশ</strong> থাকে — আসল টোকেন তৈরি হওয়ার সময় <strong>মাত্র একবার</strong> দেখা যায়।
        স্টোরটি ইন-মেমরি ডেমো; এখানে তৈরি লিংক স্থানীয়ভাবে <span className="font-mono text-xs">/pay/&lt;token&gt;</span> পেজে সত্যিই খুলবে।
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input label="অর্ডার আইডি" name="bd-link-order" value={orderId} onChange={(e) => setOrderId(e.target.value)} required />
        <Input label="পরিমাণ (টাকা)" name="bd-link-amount" value={amountTaka} onChange={(e) => setAmountTaka(e.target.value)} inputMode="decimal" required />
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-text-muted">উদ্দেশ্য *</span>
          <select
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            className="h-10 w-full rounded-[10px] border border-border bg-card px-3 text-sm outline-none focus:border-brand-500"
          >
            {PAYMENT_LINK_PURPOSES.map((p) => (
              <option key={p.value} value={p.value}>{p.labelBn}</option>
            ))}
          </select>
        </label>
        <Input label="মেয়াদ (ঘণ্টা)" name="bd-link-expiry" value={expiryHours} onChange={(e) => setExpiryHours(e.target.value)} inputMode="numeric" required />
      </div>
      {error ? <p role="alert" className="text-sm text-rose-600">⚠ {error}</p> : null}
      <Button type="button" onClick={submit} loading={submitting}>পেমেন্ট লিংক তৈরি করুন</Button>

      {once ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">⚠ এই টোকেনটি আর দেখা যাবে না — এখনই কপি করে গ্রাহককে পাঠান</p>
          <p className="mt-2 break-all font-mono text-xs">/pay/{once.plainToken}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={copyToken}>
              {copied ? "✓ কপি হয়েছে" : "লিংক পাথ কপি করুন"}
            </Button>
          </div>
          <p className="mt-2 text-xs">
            ডেমো বেস URL দিয়ে পূর্ণ লিংক: <span className="break-all font-mono">{once.url}</span> — আসল ডোমেইন সেট হলে পাথ একই থাকবে।
          </p>
        </div>
      ) : null}

      <div>
        <h3 className="mb-2 text-sm font-semibold">
          লিংকের তালিকা <span className="font-normal text-text-muted">(TEMPORARY DEMO — ইন-মেমরি স্টোর, হ্যাশের প্রথম অংশ শুধু)</span>
        </h3>
        {rows.length > 0 ? (
          <DataTable
            columns={[
              { key: "order", header: "অর্ডার" },
              { key: "amount", header: "পরিমাণ" },
              { key: "purpose", header: "উদ্দেশ্য" },
              { key: "status", header: "অবস্থা" },
              { key: "hash", header: "টোকেন হ্যাশ (আংশিক)" },
              { key: "created", header: "তৈরি" },
              { key: "expires", header: "মেয়াদ শেষ" },
            ]}
            rows={rows}
          />
        ) : (
          <p className="text-sm text-text-muted">এখনো কোনো লিংক নেই।</p>
        )}
      </div>
    </div>
  );
}
