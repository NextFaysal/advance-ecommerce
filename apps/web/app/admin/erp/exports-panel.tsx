"use client";

/**
 * Tally / QuickBooks export panel (ADV-11 remainder) — a section on
 * the ERP page. Picks a business-date range, asks for a reason
 * (mandatory, audited server-side, and embedded in the file as an
 * XML comment / a leading `#` comment row), and downloads the POSTED
 * journal entries in that range as a Tally import XML or a QuickBooks
 * journal-import CSV.
 */
import { useState } from "react";

function todayYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function monthStartYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

const inputCls = "w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text";
const labelCls = "block text-xs text-text-muted";

export function ErpExportsPanel() {
  const [from, setFrom] = useState(monthStartYmd());
  const [to, setTo] = useState(todayYmd());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function download(kind: "tally" | "quickbooks") {
    setError(null);
    setNotice(null);
    if (reason.trim() === "") {
      setError("এক্সপোর্টের কারণ আবশ্যক।");
      return;
    }
    if (!from || !to || from > to) {
      setError("তারিখের পরিসর সঠিক নয় (শুরু ≤ শেষ হতে হবে)।");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/admin/modules/erp-exports/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, reason: reason.trim() }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: { message: string } };
        setError(json.error?.message ?? "এক্সপোর্ট তৈরি করা যায়নি।");
        return;
      }
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? (kind === "tally" ? "tally-journal.xml" : "quickbooks-journal.csv");
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(href);
      setNotice(`${filename} ডাউনলোড হয়েছে।`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="mb-3 mt-8 text-lg font-semibold">হিসাব এক্সপোর্ট — Tally / QuickBooks</h2>
      <p className="mb-3 max-w-3xl text-sm text-text-muted">
        নির্বাচিত তারিখের মধ্যে পোস্ট করা জার্নাল এন্ট্রিগুলো ডাউনলোড হয় (খসড়া/রিভার্স বাদ)। পরিমাণ
        পয়সা থেকে টাকায় (BDT দশমিক) রূপান্তরিত হয়। Tally: হিসাবের ইংরেজি নামে লেজার আগে থেকে
        Tally কোম্পানিতে থাকতে হবে। QuickBooks CSV: ফাইলের প্রথম সারি একটি <code className="font-mono text-xs">#</code>{" "}
        অ্যাট্রিবিউশন মন্তব্য — ইমপোর্টের আগে সেটি মুছে ফেলুন (QuickBooks প্রথম সারিকেই হেডার ধরে)।
      </p>
      {error ? <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      {notice ? <p className="mb-3 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</p> : null}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={labelCls} htmlFor="erp-export-from">শুরু (তারিখ)</label>
          <input id="erp-export-from" type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label className={labelCls} htmlFor="erp-export-to">শেষ (তারিখ)</label>
          <input id="erp-export-to" type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="min-w-[220px] flex-1">
          <label className={labelCls} htmlFor="erp-export-reason">এক্সপোর্টের কারণ (আবশ্যক)</label>
          <input
            id="erp-export-reason"
            className={inputCls}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="যেমন: মাসিক হিসাব মেলানো (Tally)"
          />
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => void download("tally")}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Tally XML ডাউনলোড
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void download("quickbooks")}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          QuickBooks CSV ডাউনলোড
        </button>
      </div>
    </section>
  );
}
