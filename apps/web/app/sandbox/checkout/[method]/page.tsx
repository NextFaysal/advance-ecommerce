/**
 * /sandbox/checkout/[method]?attempt=<id> — the simulated hosted
 * checkout that payment initiation and pay links point at (doc 21
 * W0-C, G3-6: this URL used to 404).
 *
 * Server component. The attempt is loaded + gated server-side with the
 * same hard gates as the completion route (method must be a sandbox
 * method, Settings mode must be "sandbox", attempt must exist and
 * belong to the method) — any gate failure is a plain 404, exactly
 * like an unknown attempt. The gateway transaction id never renders
 * into this page; completion runs through
 * POST /api/v1/public/payments/sandbox/[method], which drives the
 * sandbox gateway's own verify() — no parallel state machine.
 *
 * This page is THEATRE BY DESIGN and says so everywhere: it exists so
 * the sandbox flow can be walked end-to-end in testing. No real
 * gateway is called and no real money moves; a live adapter per
 * provider is the W2 build (doc 21 §5).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { Money } from "@/components/ui/money";
import {
  SANDBOX_PAYMENT_METHODS,
  type SandboxPaymentMethod,
} from "@/integrations/sandbox/payment-gateway";
import { findAttemptById, resolveOrderRef } from "@/integrations/sandbox/db-store";
import { getPublicSettings, getSetting } from "@/lib/settings";
import SandboxCheckoutForm from "./SandboxCheckoutForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sandbox Checkout — Advance Ecommerce",
  robots: { index: false, follow: false },
};

const METHOD_LABELS_BN: Record<SandboxPaymentMethod, string> = {
  bkash: "বিকাশ (bKash)",
  nagad: "নগদ (Nagad)",
  sslcommerz: "কার্ড / SSLCommerz",
};

export default async function SandboxCheckoutPage({
  params,
  searchParams,
}: {
  params: { method: string };
  searchParams: { attempt?: string };
}) {
  const methodRaw = params.method;
  if (!(SANDBOX_PAYMENT_METHODS as readonly string[]).includes(methodRaw)) notFound();
  const method = methodRaw as SandboxPaymentMethod;

  const mode = (await getSetting(`payment.${method}.mode`)) ?? "sandbox";
  if (mode !== "sandbox") notFound();

  const attemptId = searchParams.attempt ?? "";
  const attempt = attemptId ? await findAttemptById(attemptId) : null;
  if (!attempt || attempt.method !== method) notFound();

  const order = await resolveOrderRef(attempt.orderId);
  const publicSettings = await getPublicSettings();
  const storeName = (publicSettings["general.store_name"] ?? "").trim();

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-4 py-8">
      <header className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white"
        >
          <Icon name="store" size={22} />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-bold leading-tight text-text-main">
            {storeName || "পেমেন্ট"}
          </h1>
          <p className="flex items-center gap-1 text-xs text-text-muted">
            <Icon name="shield" size={12} />
            সিমুলেটেড চেকআউট
          </p>
        </div>
      </header>

      {/* Unmistakable sandbox banner — this page must never be
          mistakable for a real gateway page. */}
      <div className="mt-4 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3">
        <p className="flex items-center gap-2 font-bold text-amber-800">
          <Icon name="alert" size={17} />
          SANDBOX — এটি টেস্ট পেমেন্ট
        </p>
        <p className="mt-1 text-sm leading-6 text-amber-700">
          কোনো আসল টাকা নড়বে না। কোনো আসল গেটওয়ে কল হয়নি — এটি শুধু টেস্টিংয়ের জন্য
          বানানো একটি সিমুলেটেড চেকআউট পেজ।
        </p>
      </div>

      <section className="mt-5 rounded-2xl border border-border bg-card px-4 py-5 shadow-card sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-text-main">{METHOD_LABELS_BN[method]}</p>
          {attempt.status === "PAID" ? (
            <Badge tone="success">
              <Icon name="check" size={12} /> পরিশোধিত (Sandbox)
            </Badge>
          ) : attempt.status === "FAILED" ? (
            <Badge tone="danger">
              <Icon name="x" size={12} /> ব্যর্থ (Sandbox)
            </Badge>
          ) : attempt.status === "UNPAID" ? (
            <Badge tone="warning">
              <Icon name="clock" size={12} /> অপেক্ষমাণ
            </Badge>
          ) : (
            <Badge tone="neutral">{attempt.status}</Badge>
          )}
        </div>

        <p className="mt-4 text-sm text-text-muted">পরিমাণ</p>
        <p className="text-3xl font-bold text-text-main">
          <Money poisha={attempt.amountPoisha} />
        </p>

        <dl className="mt-4 space-y-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-text-muted">অর্ডার</dt>
            <dd className="font-mono tabular-nums">{order ? `#${order.orderNo}` : "—"}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-text-muted">চেষ্টার আইডি (Attempt)</dt>
            <dd className="break-all font-mono text-xs tabular-nums">{attempt.attemptId}</dd>
          </div>
        </dl>

        {attempt.status === "UNPAID" ? (
          <SandboxCheckoutForm method={method} attemptId={attempt.attemptId} />
        ) : attempt.status === "PAID" ? (
          <div className="mt-5 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
            <p className="font-semibold">স্যান্ডবক্স পেমেন্ট সফল হয়েছে।</p>
            <p className="mt-1 leading-6">
              অর্ডারটি পরিশোধিত হিসেবে চিহ্নিত হয়েছে — তবে এটি সিমুলেশন; আসল কোনো টাকা
              আসেনি।
            </p>
          </div>
        ) : attempt.status === "FAILED" ? (
          <div className="mt-5 rounded-lg bg-rose-50 px-3 py-3 text-sm text-rose-700">
            <p className="font-semibold">স্যান্ডবক্স পেমেন্ট ব্যর্থ হয়েছে।</p>
            <p className="mt-1 leading-6">
              এই চেষ্টাটি ব্যর্থ হিসেবে চিহ্নিত — নতুন করে পেমেন্ট শুরু করতে অর্ডার থেকে আবার
              চেষ্টা করুন।
            </p>
          </div>
        ) : (
          <p className="mt-5 rounded-lg bg-surface-2 px-3 py-3 text-sm text-text-muted">
            এই চেষ্টার বর্তমান অবস্থা: {attempt.status}
          </p>
        )}
      </section>

      <nav className="mt-5 flex items-center justify-center gap-4 text-sm">
        <Link
          href="/track"
          className="font-medium text-brand-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          অর্ডার ট্র্যাক করুন
        </Link>
        <Link
          href="/"
          className="font-medium text-brand-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          হোমে ফিরুন
        </Link>
      </nav>
    </main>
  );
}
