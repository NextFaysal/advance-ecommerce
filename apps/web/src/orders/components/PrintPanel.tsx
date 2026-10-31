"use client";

// Print panel — document/format switcher + isolated print + preview built from
// src/orders/print.ts (buildPrintData). Supports thermal 58mm/80mm and standard A4
// printing directly via isolated iframe, browser window.print(), and direct link
// to the multi-order print centre and PDF invoice.
import { useMemo, useRef, useState } from "react";
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
  { id: "A4", label: "A4 (স্ট্যান্ডার্ড)", previewClass: "max-w-xl" },
  { id: "THERMAL_80", label: "থার্মাল 80mm", previewClass: "max-w-[300px]" },
  { id: "THERMAL_58", label: "থার্মাল 58mm", previewClass: "max-w-[220px]" },
];

function BarcodeSvg({ value }: { value: string }) {
  // Deterministic bar widths from string characters so it looks like a real barcode
  // and prints sharply on thermal/laser printers even without background graphics.
  const bars = useMemo(() => {
    const list: { width: number; space: number }[] = [];
    const seed = value.split("").reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) % 1000, 7);
    for (let i = 0; i < 24; i++) {
      const code = value.charCodeAt(i % value.length) || 65;
      const w = ((code + i + seed) % 3) + 1.5;
      const s = (((code * 2) + i) % 2) + 1.5;
      list.push({ width: w, space: s });
    }
    return list;
  }, [value]);

  let currentX = 6;
  return (
    <svg viewBox="0 0 200 40" className="mx-auto h-10 w-44 text-black" aria-label={`Barcode: ${value}`}>
      {bars.map((bar, idx) => {
        const x = currentX;
        currentX += bar.width + bar.space;
        return <rect key={idx} x={x} y="2" width={bar.width} height="36" fill="currentColor" />;
      })}
    </svg>
  );
}

export function PrintPanel({ order }: { order: Order }) {
  const [document, setDocument] = useState<PrintDocument>("courier_label");
  const [format, setFormat] = useState<PrintFormat>("THERMAL_80");
  const [isPrinting, setIsPrinting] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  const data = useMemo(
    () => buildPrintData(order, document, format, displayPhone(order.customerPhone, false)),
    [order, document, format],
  );
  const previewClass = FORMATS.find((f) => f.id === format)?.previewClass ?? "max-w-xl";
  const docLabel = DOCUMENTS.find((d) => d.id === document)?.label ?? "ডকুমেন্ট";

  const handlePrint = () => {
    setIsPrinting(true);
    const content = previewRef.current?.innerHTML;
    if (!content) {
      window.print();
      setIsPrinting(false);
      return;
    }

    // Isolate document in a hidden iframe for 100% clean printing on thermal and standard printers
    const iframe = window.document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.setAttribute("aria-hidden", "true");
    window.document.body.appendChild(iframe);

    const frameDoc = iframe.contentWindow?.document;
    if (!frameDoc) {
      window.print();
      setIsPrinting(false);
      return;
    }

    const pageSize =
      format === "THERMAL_58"
        ? "58mm auto"
        : format === "THERMAL_80"
          ? "80mm auto"
          : "A4 portrait";

    const maxWidth =
      format === "THERMAL_58"
        ? "48mm"
        : format === "THERMAL_80"
          ? "72mm"
          : "180mm";

    frameDoc.open();
    frameDoc.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${docLabel} - ${data.orderNo}</title>
          <style>
            @page {
              size: ${pageSize};
              margin: ${format === "A4" ? "10mm" : "2mm"};
            }
            * {
              box-sizing: border-box;
              margin: 0;
              padding: 0;
            }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "JetBrains Mono", monospace;
              background: #fff;
              color: #000;
              font-size: ${format === "THERMAL_58" ? "10px" : format === "THERMAL_80" ? "12px" : "13px"};
              line-height: 1.45;
              padding: 4px;
            }
            .print-wrapper {
              width: 100%;
              max-width: ${maxWidth};
              margin: 0 auto;
            }
            hr {
              border: none;
              border-top: 1px dashed #000;
              margin: 6px 0;
            }
            .text-center { text-align: center; }
            .font-bold { font-weight: bold; }
            .text-xs { font-size: ${format === "THERMAL_58" ? "9px" : "11px"}; }
            .text-sm { font-size: ${format === "THERMAL_58" ? "11px" : "13px"}; }
            .text-base { font-size: ${format === "THERMAL_58" ? "12px" : "15px"}; }
            .tracking-widest { letter-spacing: 0.15em; }
            svg { display: block; margin: 4px auto; }
          </style>
        </head>
        <body>
          <div class="print-wrapper">
            ${content}
          </div>
        </body>
      </html>
    `);
    frameDoc.close();

    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (err) {
        console.error("Print error:", err);
        window.print();
      } finally {
        setIsPrinting(false);
        setTimeout(() => {
          if (window.document.body.contains(iframe)) {
            window.document.body.removeChild(iframe);
          }
        }, 1500);
      }
    }, 250);
  };

  return (
    <Card>
      {/* Print isolation style for native browser shortcut (Ctrl+P) */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #order-print-panel-preview, #order-print-panel-preview * { visibility: visible !important; }
          #order-print-panel-preview {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: ${format === "THERMAL_58" ? "54mm" : format === "THERMAL_80" ? "76mm" : "100%"} !important;
            margin: 0 auto !important;
            padding: 8px !important;
            border: 1px dashed #000 !important;
            background: white !important;
            color: black !important;
          }
          @page {
            size: ${format === "THERMAL_58" ? "58mm auto" : format === "THERMAL_80" ? "80mm auto" : "A4 portrait"};
            margin: ${format === "A4" ? "10mm" : "2mm"};
          }
        }
      `}</style>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div>
          <h2 className="text-base font-semibold">প্রিন্ট ও লেবেল</h2>
          <p className="text-xs text-text-muted">কুরিয়ার স্টিকার, চালান ও ইনভয়েস প্রিন্ট করুন</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="primary"
            disabled={isPrinting}
            onClick={handlePrint}
          >
            🖨 {isPrinting ? "প্রিন্ট হচ্ছে..." : "প্রিন্ট করুন"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => window.open(`/admin/orders/print?ids=${order.id}`, "_blank")}
          >
            📄 ইনভয়েস প্রিন্ট সেন্টার
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => window.open(`/api/v1/admin/orders/${order.id}/invoice.pdf`, "_blank")}
          >
            📥 PDF ডাউনলোড
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2 font-medium">
          ডকুমেন্ট:
          <select
            value={document}
            onChange={(e) => setDocument(e.target.value as PrintDocument)}
            className="h-9 rounded-md border border-border bg-card px-2.5 text-xs outline-none focus:border-brand-500"
          >
            {DOCUMENTS.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 font-medium">
          ফরম্যাট:
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as PrintFormat)}
            className="h-9 rounded-md border border-border bg-card px-2.5 text-xs outline-none focus:border-brand-500"
          >
            {FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Printable Preview Container */}
      <div
        id="order-print-panel-preview"
        ref={previewRef}
        className={`mx-auto border border-dashed border-slate-400 bg-white p-4 font-mono text-xs leading-6 text-slate-900 shadow-sm ${previewClass}`}
      >
        <div className="mb-2 text-center border-b border-black pb-1.5">
          <span className="inline-block rounded bg-black px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
            {docLabel}
          </span>
          <p className="mt-1 text-sm font-bold tracking-tight">{data.orderNo}</p>
        </div>

        <div className="space-y-0.5 text-xs">
          <p><span className="font-semibold">গ্রাহক:</span> {data.customerName}</p>
          <p><span className="font-semibold">ফোন:</span> {data.customerPhoneMasked}</p>
          <p><span className="font-semibold">ঠিকানা:</span> {data.addressText}</p>
        </div>

        <hr className="my-2 border-slate-300" />

        <div className="space-y-1 text-xs">
          <p className="font-semibold text-slate-700">অর্ডারের আইটেম:</p>
          {data.itemsText.map((line, i) => (
            <p key={i} className="pl-1 leading-snug">
              • {line}
            </p>
          ))}
        </div>

        <hr className="my-2 border-slate-300" />

        <div className="flex items-center justify-between text-xs">
          <span className="font-bold">সর্বমোট প্রদেয়:</span>
          <span className="font-bold text-sm">{data.totalText}</span>
        </div>

        {(data.courier || data.trackingId) && (
          <div className="mt-2 rounded bg-slate-50 p-1.5 text-[11px] border border-slate-200">
            {data.courier && <p><span className="font-semibold">কুরিয়ার:</span> {data.courier}</p>}
            {data.trackingId && <p><span className="font-semibold">ট্র্যাকিং নম্বর:</span> {data.trackingId}</p>}
          </div>
        )}

        <div className="mt-3 text-center border-t border-slate-300 pt-2">
          <BarcodeSvg value={data.barcodeValue} />
          <p className="mt-1 tracking-widest text-[11px] font-semibold">{data.barcodeValue}</p>
        </div>
      </div>

      <p className="mt-3 text-xs text-text-muted">
        💡 থার্মাল প্রিন্টার (80mm / 58mm) অথবা সাধারণ A4 প্রিন্টারে সরাসরি প্রিন্ট করতে <strong>প্রিন্ট করুন</strong> বাটনে ক্লিক করুন। পূর্ণাঙ্গ চালানের জন্য <strong>ইনভয়েস প্রিন্ট সেন্টার</strong> ব্যবহার করুন।
      </p>
    </Card>
  );
}
