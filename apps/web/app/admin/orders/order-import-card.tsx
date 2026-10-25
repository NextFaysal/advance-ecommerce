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

const FORMAT_DOC_BN =
  "কলাম: phone,name,division,district,upazila,addressLine,sku,quantity,paymentMethod(ঐচ্ছিক),note(ঐচ্ছিক)। প্রতি সারিতে একটি আইটেম — একই ফোনের সারিগুলো মিলে একটি অর্ডার হয়। দাম ক্যাটালগ থেকে নেওয়া হয়, ডেলিভারি চার্জ জেলা অনুযায়ী ইঞ্জিন হিসাব করে।";
const FORMAT_DOC_EN =
  "Columns: phone,name,division,district,upazila,addressLine,sku,quantity,paymentMethod(optional),note(optional). One row per item; rows sharing a phone become one order. Prices come from the catalog; shipping is computed by the engine from the district.";
const EXAMPLE_CSV = [
  "phone,name,division,district,upazila,addressLine,sku,quantity,paymentMethod,note",
  "01712345678,রহিম উদ্দিন,Dhaka,Dhaka,Mirpur,\"বাসা ১২, রোড ৫, মিরপুর ১০\",SKU-001,2,cod,",
  "01712345678,রহিম উদ্দিন,Dhaka,Dhaka,Mirpur,\"বাসা ১২, রোড ৫, মিরপুর ১০\",SKU-002,1,cod,জরুরি",
].join("\n");

export function OrderImportCard({ onImported }: { onImported?: () => void }) {
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
      setRequestError("নেটওয়ার্ক সমস্যা — API-তে পৌঁছানো যায়নি। / Network error — the API could not be reached.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="mt-6 shadow-card">
      <h2 className="text-h3">অর্ডার ইমপোর্ট (CSV)</h2>
      <p className="mt-1 text-small leading-relaxed text-text-muted">{FORMAT_DOC_BN}</p>
      <p className="mt-1 text-small leading-relaxed text-text-muted">{FORMAT_DOC_EN}</p>
      <p className="mt-1 text-caption text-text-subtle">
        সীমা: একবারে সর্বোচ্চ ২০০ সারি / ৫০টি গ্রাহক-গ্রুপ। / Limit: 200 rows / 50 customer groups per upload.
        প্রতিটি গ্রুপ আলাদা লেনদেনে তৈরি হয় — একটি গ্রুপ ব্যর্থ হলে বাকিগুলো ঠিকই ইমপোর্ট হয়।
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          aria-label="CSV ফাইল বেছে নিন"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          ফাইল বেছে নিন
        </Button>
        <Button variant="outline" onClick={() => setCsv(EXAMPLE_CSV)}>
          উদাহরণ বসান
        </Button>
        <span className="text-caption text-text-muted">অথবা নিচের ঘরে CSV পেস্ট করুন</span>
      </div>

      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        rows={7}
        spellCheck={false}
        placeholder={"phone,name,division,district,upazila,addressLine,sku,quantity\n01712345678,..."}
        aria-label="CSV লেখা"
        className="mt-3 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-small shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />

      <div className="mt-3">
        <Button onClick={() => void submit()} disabled={submitting || csv.trim() === ""}>
          {submitting ? "ইমপোর্ট হচ্ছে…" : "ইমপোর্ট করুন"}
        </Button>
      </div>

      {requestError ? (
        <div role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-small text-rose-900">
          <p className="font-semibold">ইমপোর্ট হয়নি / Import did not run</p>
          <p className="mt-1">{requestError}</p>
        </div>
      ) : null}

      {results && summary ? (
        <div className="mt-4">
          <p className="text-small font-medium">
            ফলাফল: {summary.created}টি অর্ডার তৈরি হয়েছে, {summary.failed}টি গ্রুপ ব্যর্থ।
            {" / "}
            Result: {summary.created} order(s) created, {summary.failed} group(s) failed.
          </p>
          <ul className="mt-2 divide-y divide-border rounded-md border border-border">
            {results.map((r, i) => (
              <li key={`${r.phone}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-small">
                <span className="font-mono tabular-nums">{r.phone}</span>
                {r.ok ? (
                  <>
                    <span className="text-emerald-700">✓ তৈরি হয়েছে</span>
                    {r.orderId && r.orderNo ? (
                      <Link href={`/admin/orders/${r.orderId}`} className="font-mono font-semibold text-brand-700 hover:underline">
                        {r.orderNo}
                      </Link>
                    ) : null}
                  </>
                ) : (
                  <span className="text-rose-700">✗ {r.error ?? "ব্যর্থ / Failed"}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
