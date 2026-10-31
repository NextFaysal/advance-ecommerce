"use client";

// Bulk action bar for the admin order list — selection lives in the list
// page; this bar supports:
// 1. Bulk Status Update (Confirm, Processing, Packed, Shipped, Delivered, Cancel)
// 2. Bulk Courier Booking with courier provider selection (Steadfast, Pathao, RedX)
// 3. Bulk Invoice & Packing Slip Printing (/admin/orders/print)
// 4. Bulk CSV Export for Excel & Courier Entry
// 5. Bulk Order Tagging (VIP, Urgent, etc.)
// 6. Real-time background job polling and per-order result reporting.
import { useState } from "react";
import { Button } from "../../components/ui/button";
import type { Order, OrderStatus } from "../types";

export type BulkAction = "confirm" | "print_label" | "book_courier" | "update_status" | "tag";

type BulkApiResponse =
  | { data: { jobId: string; action: string; orderIds: string[]; status: string }; meta?: { note?: string } }
  | { error: { code: string; message: string; details?: unknown } };

type JobResponse =
  | {
      data: {
        status: string;
        perOrderResults: { orderId: string; ok: boolean; code?: string; message?: string }[];
      };
    }
  | { error: { code: string; message: string } };

const STATUS_OPTIONS: { id: OrderStatus; label: string }[] = [
  { id: "CONFIRMED", label: "কনফার্ম করুন (Confirmed)" },
  { id: "PROCESSING", label: "প্রসেসিং শুরু (Processing)" },
  { id: "PACKED", label: "প্যাকিং সম্পন্ন (Packed)" },
  { id: "SHIPPED", label: "শিপ করুন (Shipped)" },
  { id: "DELIVERED", label: "ডেলিভারি সম্পন্ন (Delivered)" },
  { id: "CANCELLED", label: "অর্ডার বাতিল (Cancelled)" },
];

const COURIER_OPTIONS = [
  { id: "steadfast", label: "🚚 Steadfast Courier" },
  { id: "pathao", label: "🚚 Pathao Courier" },
  { id: "redx", label: "🚚 RedX Courier" },
];

const PRESET_TAGS = ["VIP", "জরুরি", "হোল্ড", "যাচাইকৃত", "হোলসেল"];

const TERMINAL_JOB_STATUSES = new Set(["COMPLETED", "COMPLETED_WITH_FAILURES", "FAILED"]);

export function BulkActionBar({
  selectedIds,
  orders = [],
  onClear,
  onDone,
}: {
  selectedIds: string[];
  orders?: Order[];
  onClear: () => void;
  /** Called after a job settles so the parent list can refetch. */
  onDone?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<string>("");
  const [targetStatus, setTargetStatus] = useState<OrderStatus>("CONFIRMED");
  const [selectedCourier, setSelectedCourier] = useState<string>("steadfast");
  const [tagInput, setTagInput] = useState<string>("");
  const [cancelReason, setCancelReason] = useState<string>("বাল্ক বাতিলকরণ");

  if (selectedIds.length === 0) return null;

  async function pollJob(jobId: string): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        const res = await fetch(`/api/v1/admin/jobs/${jobId}`);
        const body = (await res.json().catch(() => null)) as JobResponse | null;
        if (body && "data" in body) {
          const okCount = body.data.perOrderResults.filter((r) => r.ok).length;
          const failCount = body.data.perOrderResults.length - okCount;
          if (TERMINAL_JOB_STATUSES.has(body.data.status)) {
            const failReasons = body.data.perOrderResults
              .filter((r) => !r.ok && r.message)
              .map((r) => r.message)
              .slice(0, 3)
              .join("; ");
            return `জব ${body.data.status}: ${okCount}টি সফল${failCount > 0 ? `, ${failCount}টি ব্যর্থ (${failReasons})` : ""}।`;
          }
        }
      } catch {
        // Best-effort polling
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    return "জব প্রসেস হচ্ছে — ফলাফল Jobs API-তে পাওয়া যাবে।";
  }

  async function executeBulk(payload: {
    action: BulkAction;
    orderIds: string[];
    toStatus?: OrderStatus;
    reason?: string;
    courier?: string;
    tag?: string;
  }) {
    const actionKey = `${payload.action}_${payload.toStatus || payload.courier || ""}`;
    setBusy(actionKey);
    setResult("");
    try {
      const res = await fetch("/api/v1/admin/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as BulkApiResponse | null;
      if (body && "data" in body) {
        const summary = await pollJob(body.data.jobId);
        setResult(`ফলাফল: ${summary}`);
        onDone?.();
      } else if (body && "error" in body) {
        setResult(`ত্রুটি (HTTP ${res.status}): ${body.error.code} — ${body.error.message}`);
      } else {
        setResult(`API উত্তর: HTTP ${res.status} (অপ্রত্যাশিত উত্তর)`);
      }
    } catch {
      setResult("API-তে পৌঁছানো যায়নি (নেটওয়ার্ক সমস্যা)। কিছুই পরিবর্তন হয়নি।");
    }
    setBusy(null);
  }

  const handleUpdateStatus = () => {
    void executeBulk({
      action: "update_status",
      orderIds: selectedIds,
      toStatus: targetStatus,
      reason: targetStatus === "CANCELLED" ? cancelReason.trim() || "বাল্ক বাতিলকরণ" : undefined,
    });
  };

  const handleBookCourier = () => {
    void executeBulk({
      action: "book_courier",
      orderIds: selectedIds,
      courier: selectedCourier,
    });
  };

  const handleAddTag = () => {
    const tag = tagInput.trim();
    if (!tag) return;
    void executeBulk({
      action: "tag",
      orderIds: selectedIds,
      tag,
    });
    setTagInput("");
  };

  const handleExportCsv = () => {
    const selected = orders.filter((o) => selectedIds.includes(o.id));
    const listToExport = selected.length > 0 ? selected : selectedIds.map((id) => ({ id, orderNo: id } as unknown as Order));

    const headers = [
      "Order No",
      "Date",
      "Customer Name",
      "Customer Phone",
      "Address",
      "District",
      "Total (BDT)",
      "Payment Method",
      "Payment Status",
      "Order Status",
      "Courier",
      "Tracking ID",
    ];

    const rows = listToExport.map((o) => [
      `"${o.orderNo || o.id}"`,
      `"${o.createdAt || ""}"`,
      `"${(o.customerName || "").replace(/"/g, '""')}"`,
      `"${o.customerPhone || ""}"`,
      `"${(o.address?.addressLine || "").replace(/"/g, '""')}"`,
      `"${o.address?.district || ""}"`,
      typeof o.totalPoisha === "number" ? (o.totalPoisha / 100).toFixed(2) : "0.00",
      `"${o.paymentMethod || ""}"`,
      `"${o.paymentStatus || ""}"`,
      `"${o.status || ""}"`,
      `"${o.courier || ""}"`,
      `"${o.trackingId || ""}"`,
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `orders-export-${new Date().toISOString().slice(0, 10)}.csv`);
    window.document.body.appendChild(link);
    link.click();
    window.document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mb-4 rounded-xl border border-brand-200 bg-white p-4 shadow-lift dark:border-border dark:bg-card">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
            {selectedIds.length}
          </span>
          <p className="text-sm font-semibold text-text-main">
            {selectedIds.length}টি অর্ডার সিলেক্ট করা হয়েছে
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Direct Print Invoices link */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => window.open(`/admin/orders/print?ids=${selectedIds.join(",")}`, "_blank")}
          >
            📄 বাল্ক ইনভয়েস / স্লিপ প্রিন্ট
          </Button>

          {/* Export to CSV */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleExportCsv}
          >
            📥 CSV এক্সপোর্ট
          </Button>

          {/* Clear selection */}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={onClear}
          >
            সিলেকশন মুছুন
          </Button>
        </div>
      </div>

      {/* Action Controls Grid */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* 1. Status Update Section */}
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <label className="mb-1.5 block text-xs font-semibold text-text-main">
            ১. স্ট্যাটাস পরিবর্তন করুন:
          </label>
          <div className="flex items-center gap-2">
            <select
              value={targetStatus}
              onChange={(e) => setTargetStatus(e.target.value as OrderStatus)}
              className="h-8 flex-1 rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-brand-500"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="primary"
              loading={busy?.startsWith("update_status")}
              disabled={busy !== null}
              onClick={handleUpdateStatus}
            >
              আপডেট
            </Button>
          </div>
          {targetStatus === "CANCELLED" && (
            <input
              type="text"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="বাতিল করার কারণ লিখুন"
              className="mt-2 h-7 w-full rounded border border-border bg-card px-2 text-xs outline-none"
            />
          )}
        </div>

        {/* 2. Courier Booking Section */}
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <label className="mb-1.5 block text-xs font-semibold text-text-main">
            ২. বাল্ক কুরিয়ার বুকিং:
          </label>
          <div className="flex items-center gap-2">
            <select
              value={selectedCourier}
              onChange={(e) => setSelectedCourier(e.target.value)}
              className="h-8 flex-1 rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-brand-500"
            >
              {COURIER_OPTIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="primary"
              loading={busy?.startsWith("book_courier")}
              disabled={busy !== null}
              onClick={handleBookCourier}
            >
              বুক করুন
            </Button>
          </div>
          <p className="mt-1 text-[11px] text-text-muted">নির্বাচিত কুরিয়ারে ট্র্যাকিং নম্বর সহ বুক হবে।</p>
        </div>

        {/* 3. Bulk Tagging Section */}
        <div className="rounded-lg border border-border bg-surface-2 p-3">
          <label className="mb-1.5 block text-xs font-semibold text-text-main">
            ৩. ট্যাগ যোগ করুন:
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddTag()}
              placeholder="ট্যাগ নাম (উদাঃ VIP)"
              className="h-8 flex-1 rounded-md border border-border bg-card px-2 text-xs outline-none focus:border-brand-500"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              loading={busy?.startsWith("tag")}
              disabled={busy !== null || !tagInput.trim()}
              onClick={handleAddTag}
            >
              ট্যাগ দিন
            </Button>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {PRESET_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTagInput(t)}
                className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-text-muted hover:bg-brand-50 hover:text-brand-600"
              >
                +{t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Result feedback */}
      {result && (
        <div
          role="status"
          className="mt-3 rounded-lg border border-brand-200 bg-brand-50/70 p-2.5 text-xs font-medium text-brand-900 dark:border-brand-900/50 dark:bg-brand-950/40 dark:text-brand-200"
        >
          {result}
        </div>
      )}
    </div>
  );
}
