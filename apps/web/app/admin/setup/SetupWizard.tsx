"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  BD_LOCKED_DEFAULTS,
  COURIER_PROVIDERS,
  PAYMENT_PROVIDERS,
  SETUP_STEPS,
  buildSetupSettingsPayload,
  clearSetupProgress,
  enabledCourierProviders,
  enabledPaymentMethods,
  initialSetupState,
  loadSetupProgress,
  saveSetupProgress,
  validateSetupStep,
  type CourierProvider,
  type PaymentProvider,
  type SetupState,
} from "@/platform/setup";

/**
 * First-run setup wizard — Agent 37. CLIENT DEMO STATE.
 * Progress is persisted in localStorage ONLY (key in src/platform/setup.ts).
 * The finish step POSTs to /api/v1/admin/setup, which records the payload
 * in an in-memory demo store labelled NOT_WIRED and answers
 * `persisted: false` — this UI therefore never claims settings were saved
 * to the database; it shows the API's own response.
 * API keys are NEVER asked for here — they belong in Admin > Settings.
 */

const PAYMENT_LABELS: Record<PaymentProvider, string> = {
  cod: "ক্যাশ অন ডেলিভারি (COD)",
  bkash: "বিকাশ",
  nagad: "নগদ",
  rocket: "রকেট",
  upay: "উপায়",
  sslcommerz: "SSLCommerz",
  aamarpay: "AamarPay",
  shurjopay: "ShurjoPay",
  stripe: "Stripe",
  paypal: "PayPal",
};

const COURIER_LABELS: Record<CourierProvider, string> = {
  steadfast: "স্টেডফাস্ট",
  pathao: "পাঠাও",
  redx: "রেডএক্স",
  paperfly: "পেপারফ্লাই",
  ecourier: "ইকুরিয়ার",
};

interface SubmitResult {
  ok: boolean;
  message: string;
}

function ToggleRow({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint?: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-[220px] flex-1">
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="mt-0.5 text-xs text-text-muted">{hint}</p> : null}
      </div>
      <Badge tone={on ? "success" : "neutral"}>{on ? "চালু" : "বন্ধ"}</Badge>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={onToggle}
        className={`relative h-7 w-12 rounded-full transition ${on ? "bg-brand-600" : "bg-slate-300"}`}
      >
        <span
          className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`}
        />
      </button>
    </li>
  );
}

export function SetupWizard() {
  const [state, setState] = useState<SetupState>(() => initialSetupState());
  const [stepIndex, setStepIndex] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);

  // Restore local progress once, on mount (localStorage is client-only).
  useEffect(() => {
    const progress = loadSetupProgress();
    if (progress) {
      setState(progress.state);
      setStepIndex(progress.stepIndex);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveSetupProgress({ state, stepIndex });
  }, [hydrated, state, stepIndex]);

  const step = SETUP_STEPS[stepIndex];
  const errors = useMemo(() => validateSetupStep(state, step.id), [state, step.id]);
  const isLast = stepIndex === SETUP_STEPS.length - 1;

  const goNext = () => {
    if (errors.length > 0) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setStepIndex((i) => Math.min(i + 1, SETUP_STEPS.length - 1));
  };

  const submit = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/v1/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state),
      });
      const json: unknown = await res.json().catch(() => null);
      const body = (typeof json === "object" && json !== null ? json : {}) as {
        data?: { persisted?: boolean };
        meta?: { note?: string };
        error?: { message?: string };
      };
      if (res.ok) {
        clearSetupProgress();
        setResult({
          ok: true,
          message:
            body.meta?.note ??
            "সেটআপ জমা হয়েছে (ডেমো — ডাটাবেসে সংরক্ষিত হয়নি, persisted: false)।",
        });
      } else {
        setResult({ ok: false, message: body.error?.message ?? `জমা ব্যর্থ হয়েছে (HTTP ${res.status})।` });
      }
    } catch {
      setResult({ ok: false, message: "নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <ol className="flex flex-wrap gap-2">
        {SETUP_STEPS.map((s, i) => (
          <li key={s.id}>
            <span
              className={`inline-flex h-8 items-center gap-2 rounded-full px-3 text-xs font-medium ${
                i === stepIndex
                  ? "bg-brand-600 text-white"
                  : i < stepIndex
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-slate-100 text-slate-600"
              }`}
            >
              {i + 1}. {s.labelBn}
            </span>
          </li>
        ))}
      </ol>

      <Card>
        {step.id === "store" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">দোকানের তথ্য</h2>
            <Input
              label="দোকানের নাম"
              name="storeName"
              required
              value={state.storeName}
              onChange={(e) => setState({ ...state, storeName: e.target.value })}
              placeholder="যেমন: ঢাকা ফ্যাশন হাউস"
            />
            <Input
              label="মোবাইল নম্বর"
              name="storePhone"
              required
              value={state.storePhone}
              onChange={(e) => setState({ ...state, storePhone: e.target.value })}
              placeholder="01XXXXXXXXX"
              helper="অর্ডার ও ডেলিভারির জন্য এই নম্বরে যোগাযোগ করা হবে।"
            />
            <Input
              label="দোকানের ঠিকানা"
              name="storeAddress"
              required
              value={state.storeAddress}
              onChange={(e) => setState({ ...state, storeAddress: e.target.value })}
              placeholder="বাসা/রোড, এলাকা, জেলা"
            />
          </div>
        )}

        {step.id === "defaults" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">ভাষা ও মুদ্রা (লক করা)</h2>
            <p className="text-sm text-text-muted">
              এই প্ল্যাটফর্ম বাংলাদেশ-প্রথম: ডিফল্ট ভাষা বাংলা, মুদ্রা টাকা (BDT) এবং সময় অঞ্চল
              Asia/Dhaka — এগুলো উইজার্ড থেকে বদলানো যায় না।
            </p>
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <div className="rounded-md bg-surface-2 p-3">
                <dt className="text-text-muted">ভাষা</dt>
                <dd className="font-medium">বাংলা ({BD_LOCKED_DEFAULTS.locale}) · fallback English</dd>
              </div>
              <div className="rounded-md bg-surface-2 p-3">
                <dt className="text-text-muted">মুদ্রা</dt>
                <dd className="font-medium">{BD_LOCKED_DEFAULTS.currency} (৳)</dd>
              </div>
              <div className="rounded-md bg-surface-2 p-3">
                <dt className="text-text-muted">সময় অঞ্চল</dt>
                <dd className="font-medium">{BD_LOCKED_DEFAULTS.timezone}</dd>
              </div>
            </dl>
          </div>
        )}

        {step.id === "payments" && (
          <div>
            <h2 className="text-lg font-semibold">পেমেন্ট পদ্ধতি চালু করুন</h2>
            <p className="mt-1 text-sm text-text-muted">
              এখানে শুধু কোন পদ্ধতি চালু থাকবে তা বেছে নিন। API key / মার্চেন্ট তথ্য পরে
              সেটিংস থেকে দিতে হবে — উইজার্ডে কোনো key চাওয়া হয় না।
            </p>
            <ul className="divide-y divide-border">
              {PAYMENT_PROVIDERS.map((p) => (
                <ToggleRow
                  key={p}
                  label={PAYMENT_LABELS[p]}
                  hint={p === "cod" ? "ডিফল্ট চালু" : undefined}
                  on={state.paymentMethods[p]}
                  onToggle={() =>
                    setState({ ...state, paymentMethods: { ...state.paymentMethods, [p]: !state.paymentMethods[p] } })
                  }
                />
              ))}
            </ul>
          </div>
        )}

        {step.id === "couriers" && (
          <div>
            <h2 className="text-lg font-semibold">কুরিয়ার চালু করুন</h2>
            <p className="mt-1 text-sm text-text-muted">
              কমপক্ষে একটি কুরিয়ার চালু করুন। অ্যাকাউন্টের credential পরে সেটিংস থেকে দিতে হবে।
            </p>
            <ul className="divide-y divide-border">
              {COURIER_PROVIDERS.map((c) => (
                <ToggleRow
                  key={c}
                  label={COURIER_LABELS[c]}
                  on={state.courierProviders[c]}
                  onToggle={() =>
                    setState({ ...state, courierProviders: { ...state.courierProviders, [c]: !state.courierProviders[c] } })
                  }
                />
              ))}
            </ul>
          </div>
        )}

        {step.id === "integrations" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">ইন্টিগ্রেশন ও API key</h2>
            <p className="text-sm text-text-muted">
              পেমেন্ট, কুরিয়ার, SMS, ইমেইল ও স্টোরেজের API key বা credential{" "}
              <strong>কখনোই এই উইজার্ডে দেওয়া হয় না</strong>। সেটআপ শেষে{" "}
              <a href="/admin/settings" className="font-medium text-brand-700 hover:underline">
                অ্যাডমিন → সেটিংস
              </a>{" "}
              থেকে প্রতিটি প্রোভাইডারের তথ্য দিন — সেগুলো এনক্রিপ্ট করে সংরক্ষণ করা হয় এবং
              env শুধু ডিফল্ট/fallback হিসেবে থাকে।
            </p>
            <Badge tone="info">Key ছাড়াই উইজার্ড শেষ করা যাবে</Badge>
          </div>
        )}

        {step.id === "finish" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">সারসংক্ষেপ ও শেষ করুন</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2">
                <dt className="w-36 text-text-muted">দোকান</dt>
                <dd className="font-medium">{state.storeName || "—"}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="w-36 text-text-muted">মোবাইল</dt>
                <dd className="font-medium">{state.storePhone || "—"}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="w-36 text-text-muted">ঠিকানা</dt>
                <dd className="font-medium">{state.storeAddress || "—"}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="w-36 text-text-muted">পেমেন্ট</dt>
                <dd className="font-medium">
                  {enabledPaymentMethods(state).map((p) => PAYMENT_LABELS[p]).join(", ") || "—"}
                </dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="w-36 text-text-muted">কুরিয়ার</dt>
                <dd className="font-medium">
                  {enabledCourierProviders(state).map((c) => COURIER_LABELS[c]).join(", ") || "—"}
                </dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="w-36 text-text-muted">সেটিংস এন্ট্রি</dt>
                <dd className="font-medium">{buildSetupSettingsPayload(state).length}টি (key, value, category আকারে)</dd>
              </div>
            </dl>
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-700">
              ডেমো সতর্কতা: জমা দিলে তথ্য শুধু একটি in-memory ডেমো স্টোরে যাবে (NOT_WIRED) —
              ডাটাবেসে সংরক্ষিত হবে না। আসল সেটিংস সংরক্ষণ DB ওয়্যারিংয়ের পর সেটিংস পেজ থেকেই হবে।
            </p>
            {result ? (
              <p className={`rounded-md p-3 text-sm ${result.ok ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                {result.message}
              </p>
            ) : null}
          </div>
        )}

        {showErrors && errors.length > 0 ? (
          <ul className="mt-4 space-y-1" role="alert">
            {errors.map((err) => (
              <li key={err} className="text-sm text-rose-600">
                ⚠ {err}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={stepIndex === 0 || submitting}
            onClick={() => {
              setShowErrors(false);
              setStepIndex((i) => Math.max(i - 1, 0));
            }}
          >
            পেছনে
          </Button>
          {isLast ? (
            <Button variant="gradient" loading={submitting} onClick={submit}>
              সেটআপ শেষ করুন
            </Button>
          ) : (
            <Button onClick={goNext}>পরবর্তী ধাপ</Button>
          )}
        </div>
      </Card>
    </div>
  );
}
