"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { isAdapterlessGatewayMethod } from "@/checkout/payment-methods";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { SETUP_STRINGS, type SetupStrings } from "./strings";
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

function paymentLabels(s: SetupStrings): Record<PaymentProvider, string> {
  return {
    cod: s.payCod,
    bkash: s.payBkash,
    nagad: s.payNagad,
    rocket: s.payRocket,
    upay: s.payUpay,
    sslcommerz: s.paySslcommerz,
    aamarpay: s.payAamarpay,
    shurjopay: s.payShurjopay,
    stripe: s.payStripe,
    paypal: s.payPaypal,
  };
}

function courierLabels(s: SetupStrings): Record<CourierProvider, string> {
  return {
    steadfast: s.courierSteadfast,
    pathao: s.courierPathao,
    redx: s.courierRedx,
    paperfly: s.courierPaperfly,
    ecourier: s.courierEcourier,
  };
}

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
  const { locale: toggleLocale } = useLocale();
  const toggleS = pick(toggleLocale, SETUP_STRINGS);
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-[220px] flex-1">
        <p className="text-sm font-medium">{label}</p>
        {hint ? <p className="mt-0.5 text-xs text-text-muted">{hint}</p> : null}
      </div>
      <Badge tone={on ? "success" : "neutral"}>{on ? toggleS.on : toggleS.off}</Badge>
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
  const { locale } = useLocale();
  const s = pick(locale, SETUP_STRINGS);
  const PAYMENT_LABELS = paymentLabels(s);
  const COURIER_LABELS = courierLabels(s);
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
            s.savedFallback,
        });
      } else {
        setResult({ ok: false, message: body.error?.message ?? interpolate(s.submitFailed, { status: res.status }) });
      }
    } catch {
      setResult({ ok: false, message: s.networkError });
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
              {i + 1}. {locale === "bn" ? s.labelBn : s.labelEn}
            </span>
          </li>
        ))}
      </ol>

      <Card>
        {step.id === "store" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{s.storeInfo}</h2>
            <Input
              label={s.storeName}
              name="storeName"
              required
              value={state.storeName}
              onChange={(e) => setState({ ...state, storeName: e.target.value })}
              placeholder={s.storeNamePlaceholder}
            />
            <Input
              label={s.storePhone}
              name="storePhone"
              required
              value={state.storePhone}
              onChange={(e) => setState({ ...state, storePhone: e.target.value })}
              placeholder="01XXXXXXXXX"
              helper={s.storePhoneHelper}
            />
            <Input
              label={s.storeAddress}
              name="storeAddress"
              required
              value={state.storeAddress}
              onChange={(e) => setState({ ...state, storeAddress: e.target.value })}
              placeholder={s.storeAddressPlaceholder}
            />
          </div>
        )}

        {step.id === "defaults" && (
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">{s.defaultsTitle}</h2>
            <p className="text-sm text-text-muted">
              {s.defaultsText}
            </p>
            <dl className="grid gap-2 text-sm sm:grid-cols-3">
              <div className="rounded-md bg-surface-2 p-3">
                <dt className="text-text-muted">{s.language}</dt>
                <dd className="font-medium">{interpolate(s.languageValue, { locale: BD_LOCKED_DEFAULTS.locale })}</dd>
              </div>
              <div className="rounded-md bg-surface-2 p-3">
                <dt className="text-text-muted">{s.currency}</dt>
                <dd className="font-medium">{BD_LOCKED_DEFAULTS.currency} (৳)</dd>
              </div>
              <div className="rounded-md bg-surface-2 p-3">
                <dt className="text-text-muted">{s.timezone}</dt>
                <dd className="font-medium">{BD_LOCKED_DEFAULTS.timezone}</dd>
              </div>
            </dl>
          </div>
        )}

        {step.id === "payments" && (
          <div>
            <h2 className="text-lg font-semibold">{s.paymentsTitle}</h2>
            <p className="mt-1 text-sm text-text-muted">
              {s.paymentsText}
            </p>
            <ul className="divide-y divide-border">
              {PAYMENT_PROVIDERS.map((p) => (
                <ToggleRow
                  key={p}
                  label={
                    isAdapterlessGatewayMethod(p)
                      ? `${PAYMENT_LABELS[p]}${s.adapterNotBuiltSuffix}`
                      : PAYMENT_LABELS[p]
                  }
                  hint={
                    p === "cod"
                      ? s.defaultOn
                      : isAdapterlessGatewayMethod(p)
                        ? s.adapterHint
                        : undefined
                  }
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
            <h2 className="text-lg font-semibold">{s.couriersTitle}</h2>
            <p className="mt-1 text-sm text-text-muted">
              {s.couriersText}
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
            <h2 className="text-lg font-semibold">{s.integrationsTitle}</h2>
            <p className="text-sm text-text-muted">
              {s.integrationsText1}
              <strong>{s.integrationsTextStrong}</strong>
              {s.integrationsText2}
              <a href="/admin/settings" className="font-medium text-brand-700 hover:underline">
                {s.integrationsLink}
              </a>
              {s.integrationsText3}
            </p>
            <Badge tone="info">{s.integrationsBadge}</Badge>
          </div>
        )}

        {step.id === "finish" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold">{s.finishTitle}</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2">
                <dt className="w-36 text-text-muted">{s.sumStore}</dt>
                <dd className="font-medium">{state.storeName || "—"}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="w-36 text-text-muted">{s.sumPhone}</dt>
                <dd className="font-medium">{state.storePhone || "—"}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="w-36 text-text-muted">{s.sumAddress}</dt>
                <dd className="font-medium">{state.storeAddress || "—"}</dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="w-36 text-text-muted">{s.sumPayments}</dt>
                <dd className="font-medium">
                  {enabledPaymentMethods(state).map((p) => PAYMENT_LABELS[p]).join(", ") || "—"}
                </dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="w-36 text-text-muted">{s.sumCouriers}</dt>
                <dd className="font-medium">
                  {enabledCourierProviders(state).map((c) => COURIER_LABELS[c]).join(", ") || "—"}
                </dd>
              </div>
              <div className="flex flex-wrap gap-2">
                <dt className="w-36 text-text-muted">{s.sumSettings}</dt>
                <dd className="font-medium">{interpolate(s.sumSettingsValue, { count: buildSetupSettingsPayload(state).length })}</dd>
              </div>
            </dl>
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-700">
              {s.finishNote}
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
            {s.back}
          </Button>
          {isLast ? (
            <Button variant="gradient" loading={submitting} onClick={submit}>
              {s.finish}
            </Button>
          ) : (
            <Button onClick={goNext}>{s.next}</Button>
          )}
        </div>
      </Card>
    </div>
  );
}
