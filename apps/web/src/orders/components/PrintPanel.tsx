"use client";

// Print panel — document/format switcher + preview built from
// src/orders/print.ts (buildPrintData). Preview only: the actual print is
// the browser's window.print(); a print stylesheet and Bluetooth thermal
// integration are later steps (noted in print.ts). Phone in the preview is
// the masked value that buildPrintData receives — never the full number.
import { useMemo, useState } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { displayPhone } from "../customer";
import { buildPrintData } from "../print";
import type { PrintDocument, PrintFormat } from "../print";
import type { Order } from "../types";

const DOCUMENTS: { id: PrintDocument; label: string }[] = [
  { id: "courier_label", label: "কুরিয়ার লেবেল" },
  { id: "invoice", label: "ইনভয়েস" },
  { id: "packing_slip", label: "প্যাকিং স্লিপ" },
  { id: "delivery_challan", label: "ডেলিভারি চালান" },
];

const FORMATS: { id: PrintFormat; label: string; previewClass: string }[] = [
  { id: "A4", label: "A4", previewClass: "max-w-xl" },
  { id: "THERMAL_80", label: "থার্মাল 80mm", previewClass: "max-w-[300px]" },
  { id: "THERMAL_58", label: "থার্মাল 58mm", previewClass: "max-w-[220px]" },
];

export function PrintPanel({ order }: { order: Order }) {
  const [document, setDocument] = useState<PrintDocument>("courier_label");
  const [format, setFormat] = useState<PrintFormat>("THERMAL_80");

  const data = useMemo(
    () => buildPrintData(order, document, format, displayPhone(order.customerPhone, false)),
    [order, document, format],
  );
  const previewClass = FORMATS.find((f) => f.id === format)?.previewClass ?? "max-w-xl";

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">প্রিন্ট</h2>
        <Button type="button" size="sm" variant="outline" onClick={() => window.print()}>
          🖨 প্রিন্ট করুন (ব্রাউজার)
        </Button>
      </div>
      <div className="mb-4 flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-2">
          ডকুমেন্ট
          <select
            value={document}
            onChange={(e) => setDocument(e.target.value as PrintDocument)}
            className="h-10 rounded-md border border-border bg-card px-2"
          >
            {DOCUMENTS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          ফরম্যাট
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as PrintFormat)}
            className="h-10 rounded-md border border-border bg-card px-2"
          >
            {FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={`mx-auto border border-dashed border-border bg-white p-4 font-mono text-xs leading-6 text-slate-800 ${previewClass}`}>
        <p className="text-center text-sm font-bold">{data.orderNo}</p>
        <p>নাম: {data.customerName}</p>
        <p>ফোন: {data.customerPhoneMasked}</p>
        <p>ঠিকানা: {data.addressText}</p>
        <hr className="my-2 border-slate-300" />
        {data.itemsText.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
        <hr className="my-2 border-slate-300" />
        <p className="font-bold">মোট: {data.totalText}</p>
        {data.courier && <p>কুরিয়ার: {data.courier}</p>}
        {data.trackingId && <p>ট্র্যাকিং: {data.trackingId}</p>}
        <div aria-hidden="true" className="mx-auto mt-3 h-10 w-4/5 bg-[repeating-linear-gradient(90deg,#000_0_2px,transparent_2px_5px)]" />
        <p className="mt-1 text-center tracking-widest">{data.barcodeValue}</p>
      </div>
      <p className="mt-3 text-xs text-text-muted">
        প্রিভিউ শুধু — প্রিন্ট স্টাইলশিট ও ব্লুটুথ থার্মাল প্রিন্টার ইন্টিগ্রেশন পরের ধাপে।
        ফোন সবসময় মাস্ক করা থাকে।
      </p>
    </Card>
  );
}
