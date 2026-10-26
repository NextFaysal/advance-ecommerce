"use client";

/**
 * Buyer request tools on the B2B portal (ADV-14 remainder):
 *  - RFQ form: pick variants + quantities, a note and a desired
 *    date → POST /api/v1/public/account/b2b/rfq.
 *  - Bulk form: paste or upload a `sku,quantity` CSV → POST
 *    /api/v1/public/account/b2b/bulk.
 * Both create the SAME record: a DRAFT quotation whose lines
 * snapshot this buyer's group price, source-marked BUYER_RFQ for
 * staff. The server reports EVERY row back (valid / errors /
 * warnings) — the result table below shows exactly that report, so a
 * rejected row is never silently dropped. On success the page
 * refreshes and the new request appears under "আমার কোটেশন".
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatPoisha } from "@/components/ui/money";

export interface B2bRequestProductOption {
  variantId: string;
  sku: string;
  productNameBn: string;
  productNameEn: string;
  attributesLabel: string;
  stock: number;
  cataloguePricePoisha: number;
  effectivePricePoisha: number;
  pricingSource: "override" | "group_discount" | "catalogue";
}

interface RowIssue {
  code: string;
  message: string;
}

interface RowResult {
  rowNumber: number;
  sku: string | null;
  variantId: string | null;
  quantity: number | null;
  status: "valid" | "error";
  errors: RowIssue[];
  warnings: RowIssue[];
  productName?: string;
  unitPricePoisha?: number;
}

interface SubmitPayload {
  data?: {
    quotation?: { id: string; totalPoisha: number };
    rows?: RowResult[];
  };
  error?: {
    message?: string;
    details?: { rows?: RowResult[] } | unknown;
  };
}

interface FormRow {
  variantId: string;
  quantity: string;
}

const selectCls =
  "h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-text-main outline-none focus:border-brand-500";

function rowsFromPayload(payload: SubmitPayload | null): RowResult[] {
  if (payload?.data?.rows) return payload.data.rows;
  const details = payload?.error?.details;
  if (details !== null && typeof details === "object" && "rows" in details) {
    const rows = (details as { rows?: RowResult[] }).rows;
    if (Array.isArray(rows)) return rows;
  }
  return [];
}

export default function B2bRequestTools({ products }: { products: B2bRequestProductOption[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<"rfq" | "bulk">("rfq");
  const [formRows, setFormRows] = useState<FormRow[]>([
    { variantId: products[0]?.variantId ?? "", quantity: "1" },
  ]);
  const [rfqNote, setRfqNote] = useState("");
  const [rfqDate, setRfqDate] = useState("");
  const [csvText, setCsvText] = useState("");
  const [csvFileName, setCsvFileName] = useState("");
  const [bulkNote, setBulkNote] = useState("");
  const [bulkDate, setBulkDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [rowResults, setRowResults] = useState<RowResult[]>([]);

  function updateFormRow(index: number, patch: Partial<FormRow>) {
    setFormRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function submit(kind: "rfq" | "bulk") {
    setBusy(true);
    setError(null);
    setSuccess(null);
    setRowResults([]);
    try {
      const body =
        kind === "rfq"
          ? {
              items: formRows.map((row) => ({
                variantId: row.variantId,
                quantity: Number(row.quantity),
              })),
              note: rfqNote.trim() === "" ? undefined : rfqNote.trim(),
              desiredDate: rfqDate === "" ? null : rfqDate,
            }
          : {
              csvText,
              note: bulkNote.trim() === "" ? undefined : bulkNote.trim(),
              desiredDate: bulkDate === "" ? null : bulkDate,
            };
      const res = await fetch(`/api/v1/public/account/b2b/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => null)) as SubmitPayload | null;
      setRowResults(rowsFromPayload(payload));
      if (!res.ok) {
        setError(payload?.error?.message ?? "জমা দেওয়া যায়নি — আবার চেষ্টা করুন।");
        return;
      }
      const quotation = payload?.data?.quotation;
      setSuccess(
        quotation
          ? `✅ RFQ তৈরি হয়েছে (#${quotation.id.slice(-8)}) — মোট ${formatPoisha(quotation.totalPoisha)} (গ্রুপ মূল্যে স্ন্যাপশট)। স্টোর যাচাই করে কোটেশন পাঠাবে।`
          : "✅ RFQ তৈরি হয়েছে — স্টোর যাচাই করে কোটেশন পাঠাবে।",
      );
      router.refresh();
    } catch {
      setError("নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  }

  async function onCsvFile(file: File | null) {
    if (file === null) return;
    try {
      setCsvText(await file.text());
      setCsvFileName(file.name);
    } catch {
      setError("ফাইলটি পড়া যায়নি — CSV লেখা পেস্ট করে চেষ্টা করুন।");
    }
  }

  if (products.length === 0) {
    return (
      <p className="mt-3 text-sm leading-6 text-text-muted">
        এই মুহূর্তে ক্যাটালগে কোনো সক্রিয় পণ্য নেই — RFQ দেওয়ার মতো পণ্য পাওয়া যাচ্ছে না।
      </p>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="RFQ পদ্ধতি">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "rfq"}
          onClick={() => setMode("rfq")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            mode === "rfq"
              ? "bg-brand-600 text-white"
              : "border border-border text-text-main hover:bg-surface-2"
          }`}
        >
          RFQ ফর্ম
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "bulk"}
          onClick={() => setMode("bulk")}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            mode === "bulk"
              ? "bg-brand-600 text-white"
              : "border border-border text-text-main hover:bg-surface-2"
          }`}
        >
          বাল্ক CSV (sku,quantity)
        </button>
      </div>

      {mode === "rfq" ? (
        <div className="mt-4 space-y-3">
          {formRows.map((row, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-[1fr_130px_auto] sm:items-end">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-text-main">পণ্য (SKU)</span>
                <select
                  className={selectCls}
                  value={row.variantId}
                  onChange={(e) => updateFormRow(index, { variantId: e.target.value })}
                  disabled={busy}
                >
                  {products.map((product) => (
                    <option key={product.variantId} value={product.variantId}>
                      {product.sku} — {product.productNameBn}
                      {product.attributesLabel ? ` (${product.attributesLabel})` : ""} — আপনার মূল্য{" "}
                      {formatPoisha(product.effectivePricePoisha)}
                    </option>
                  ))}
                </select>
              </label>
              <Input
                id={`rfq-qty-${index}`}
                name={`rfq-qty-${index}`}
                label="পরিমাণ"
                type="number"
                min={1}
                step={1}
                value={row.quantity}
                onChange={(e) => updateFormRow(index, { quantity: e.target.value })}
                disabled={busy}
              />
              <Button
                onClick={() => setFormRows((rows) => rows.filter((_, i) => i !== index))}
                disabled={busy || formRows.length === 1}
              >
                সরান
              </Button>
            </div>
          ))}
          <Button
            onClick={() =>
              setFormRows((rows) => [
                ...rows,
                { variantId: products[0]?.variantId ?? "", quantity: "1" },
              ])
            }
            disabled={busy}
          >
            + আরেকটি পণ্য যোগ করুন
          </Button>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              id="rfq-desired-date"
              name="rfq-desired-date"
              label="কাঙ্ক্ষিত ডেলিভারির তারিখ (ঐচ্ছিক)"
              type="date"
              value={rfqDate}
              onChange={(e) => setRfqDate(e.target.value)}
              disabled={busy}
            />
          </div>
          <Textarea
            id="rfq-note"
            name="rfq-note"
            label="নোট (ঐচ্ছিক)"
            value={rfqNote}
            onChange={(e) => setRfqNote(e.target.value)}
            placeholder="ডেলিভারি, প্যাকেজিং বা অন্য কোনো বিশেষ নির্দেশনা…"
            rows={3}
            disabled={busy}
          />
          <div className="flex justify-end">
            <Button onClick={() => submit("rfq")} disabled={busy}>
              {busy ? "জমা হচ্ছে…" : "RFQ জমা দিন"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-sm leading-6 text-text-muted">
            প্রতি সারিতে <code className="font-mono">sku,quantity</code> — যেমন{" "}
            <code className="font-mono">DEMO-SKU-1,50</code>। হেডার সারি (sku,quantity) থাকলেও চলবে।
            প্রতিটি সারি যাচাই করে ফলাফল নিচে দেখানো হবে — কোনো সারি নীরবে বাদ যাবে না।
          </p>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-text-main">CSV ফাইল আপলোড (ঐচ্ছিক)</span>
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={(e) => onCsvFile(e.target.files?.[0] ?? null)}
              disabled={busy}
              className="block w-full text-sm text-text-muted"
            />
            {csvFileName ? <span className="mt-1 block text-xs text-text-muted">{csvFileName}</span> : null}
          </label>
          <Textarea
            id="bulk-csv"
            name="bulk-csv"
            label="CSV লেখা"
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={"sku,quantity\nDEMO-SKU-1,50\nDEMO-SKU-2,25"}
            rows={8}
            disabled={busy}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              id="bulk-desired-date"
              name="bulk-desired-date"
              label="কাঙ্ক্ষিত ডেলিভারির তারিখ (ঐচ্ছিক)"
              type="date"
              value={bulkDate}
              onChange={(e) => setBulkDate(e.target.value)}
              disabled={busy}
            />
          </div>
          <Textarea
            id="bulk-note"
            name="bulk-note"
            label="নোট (ঐচ্ছিক)"
            value={bulkNote}
            onChange={(e) => setBulkNote(e.target.value)}
            rows={2}
            disabled={busy}
          />
          <div className="flex justify-end">
            <Button onClick={() => submit("bulk")} disabled={busy || csvText.trim() === ""}>
              {busy ? "যাচাই ও জমা হচ্ছে…" : "বাল্ক RFQ জমা দিন"}
            </Button>
          </div>
        </div>
      )}

      {error ? (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm leading-6 text-rose-700" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm leading-6 text-emerald-800" role="status">
          {success}
        </p>
      ) : null}

      {rowResults.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <h3 className="text-sm font-semibold text-text-main">সারিভিত্তিক যাচাই ফলাফল</h3>
          <table className="mt-2 w-full text-left text-sm">
            <thead>
              <tr className="text-text-muted">
                <th className="py-1 pr-3 font-medium">সারি</th>
                <th className="py-1 pr-3 font-medium">SKU</th>
                <th className="py-1 pr-3 font-medium">পরিমাণ</th>
                <th className="py-1 pr-3 font-medium">অবস্থা</th>
                <th className="py-1 font-medium">বিস্তারিত</th>
              </tr>
            </thead>
            <tbody>
              {rowResults.map((row) => (
                <tr key={row.rowNumber} className="border-t border-border align-top">
                  <td className="py-1.5 pr-3 text-text-main">{row.rowNumber}</td>
                  <td className="py-1.5 pr-3 font-mono text-text-main">{row.sku ?? "—"}</td>
                  <td className="py-1.5 pr-3 text-text-main">{row.quantity ?? "—"}</td>
                  <td className="py-1.5 pr-3">
                    {row.status === "valid" ? (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                        বৈধ{row.unitPricePoisha !== undefined ? ` · ${formatPoisha(row.unitPricePoisha)}/একক` : ""}
                      </span>
                    ) : (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
                        ত্রুটি
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-xs leading-5 text-text-muted">
                    {row.errors.map((issue) => (
                      <span key={`e-${issue.code}`} className="block text-rose-700">
                        {issue.code}: {issue.message}
                      </span>
                    ))}
                    {row.warnings.map((issue) => (
                      <span key={`w-${issue.code}`} className="block text-amber-700">
                        সতর্কতা {issue.code}: {issue.message}
                      </span>
                    ))}
                    {row.errors.length === 0 && row.warnings.length === 0 ? "—" : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
