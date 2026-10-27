"use client";

/**
 * CSV order import card (doc 17 batch O4) — mounted on the admin
 * orders page under the manual order builder. POSTs the CSV text as
 * JSON { csv } to /api/v1/admin/orders/import (the product-import
 * convention): one row per item, rows grouped by phone into one
 * order per customer, catalog prices, shipping derived from the
 * district by the shared engine. The endpoint creates each group
 * through the shared manual-create service in its own transaction;
 * this card renders the per-group results (order number or the
 * failure reason) exactly as returned — nothing is hidden.
 */
import { useRef, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { interpolate, pick } from "../../../src/i18n/locale";
import { useLocale } from "../../../src/i18n/LocaleProvider";
import { ORDER_STRINGS } from "./strings";

interface GroupResult {
  phone: string;
  ok: boolean;
  orderId?: string;
  orderNo?: string;
  error?: string;
}

interface ImportResponse {
  data?: { results: GroupResult[]; created: number; failed: number };
  error?: { code: string; message: string };
}

const EXAMPLE_CSV = [
  "phone,name,division,district,upazila,addressLine,sku,quantity,paymentMethod,note",
  "01712345678,রহিম উদ্দিন,Dhaka,Dhaka,Mirpur,\"বাসা ১২, রোড ৫, মিরপুর ১০\",SKU-001,2,cod,",
  "01712345678,রহিম উদ্দিন,Dhaka,Dhaka,Mirpur,\"বাসা ১২, রোড ৫, মিরপুর ১০\",SKU-002,1,cod,জরুরি",
].join("\n");

export function OrderImportCard({ onImported }: { onImported?: () => void }) {
  const { locale } = useLocale();
  const s = pick(locale, ORDER_STRINGS);
  const [csv, setCsv] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [results, setResults] = useState<GroupResult[] | null>(null);
  const [summary, setSummary] = useState<{ created: number; failed: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setCsv(await file.text());
  };

  const submit = async () => {
    if (submitting || csv.trim() === "") return;
    setSubmitting(true);
    setRequestError(null);
    setResults(null);
    setSummary(null);
    try {
      const res = await fetch("/api/v1/admin/orders/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const body = (await res.json().catch(() => null)) as ImportResponse | null;
      if (res.ok && body?.data) {
        setResults(body.data.results);
        setSummary({ created: body.data.created, failed: body.data.failed });
        if (body.data.created > 0) onImported?.();
      } else {
        setRequestError(
          body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`,
        );
      }
    } catch {
      setRequestError(s.impNetErr);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="mt-6 shadow-card">
      <h2 className="text-h3">{s.impTitle}</h2>
      <p className="mt-1 text-small leading-relaxed text-text-muted">{s.impFormat}</p>
      <p className="mt-1 text-caption text-text-subtle">{s.impLimits}</p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          aria-label={s.impFileAria}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          {s.impChooseFile}
        </Button>
        <Button variant="outline" onClick={() => setCsv(EXAMPLE_CSV)}>
          {s.impExample}
        </Button>
        <span className="text-caption text-text-muted">{s.impPasteHint}</span>
      </div>

      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        rows={7}
        spellCheck={false}
        placeholder={"phone,name,division,district,upazila,addressLine,sku,quantity\n01712345678,..."}
        aria-label={s.impTextAria}
        className="mt-3 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-small shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />

      <div className="mt-3">
        <Button onClick={() => void submit()} disabled={submitting || csv.trim() === ""}>
          {submitting ? s.impSubmitting : s.impSubmit}
        </Button>
      </div>

      {requestError ? (
        <div role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-small text-rose-900">
          <p className="font-semibold">{s.impFailedTitle}</p>
          <p className="mt-1">{requestError}</p>
        </div>
      ) : null}

      {results && summary ? (
        <div className="mt-4">
          <p className="text-small font-medium">
            {interpolate(s.impResult, { created: summary.created, failed: summary.failed })}
          </p>
          <ul className="mt-2 divide-y divide-border rounded-md border border-border">
            {results.map((r, i) => (
              <li key={`${r.phone}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-small">
                <span className="font-mono tabular-nums">{r.phone}</span>
                {r.ok ? (
                  <>
                    <span className="text-emerald-700">{s.impCreated}</span>
                    {r.orderId && r.orderNo ? (
                      <Link href={`/admin/orders/${r.orderId}`} className="font-mono font-semibold text-brand-700 hover:underline">
                        {r.orderNo}
                      </Link>
                    ) : null}
                  </>
                ) : (
                  <span className="text-rose-700">✗ {r.error ?? s.impFailedWord}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
