"use client";

/**
 * Download re-issue desk (doc 18, batch F3) — REAL data from
 * GET /api/v1/admin/downloads; decisions via
 * POST /api/v1/admin/downloads/[id]/approve|reject.
 *
 * WHY THIS EXISTS: a DownloadGrant stores only the SHA-256 hash of
 * its token — the raw link is unrecoverable BY DESIGN. A customer
 * who loses it (or lets it expire / exhausts it) files a re-issue
 * request from their account; staff decide here.
 *
 * APPROVE mints a NEW grant (same file/order, fresh 7-day / 5-use
 * budget), revokes the OLD grant — both redemption paths (token
 * link and account access) refuse revoked grants — and the response
 * shows the new grant's one-time download link ONCE, in the notice
 * below, for staff to relay if needed. It is never stored; the
 * customer can equally just use the Download button in their
 * account, which needs no link at all.
 *
 * REJECT requires a reason and never touches the old grant.
 * Customer phones arrive MASKED from the API.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface ReissueItem {
  id: string;
  grantId: string;
  status: string;
  reason: string | null;
  decisionNote: string | null;
  newGrantId: string | null;
  createdAt: string;
  customerName: string;
  customerPhoneMasked: string;
  orderId: string;
  orderNo: string;
  productName: string;
  fileName: string;
  grantStatus: "active" | "expired" | "exhausted" | "revoked";
  grantExpiresAt: string;
  grantDownloadsUsed: number;
  grantMaxDownloads: number;
}

interface OrderGrant {
  grantId: string;
  fileName: string;
  productName: string;
  issuedAt: string;
  expiresAt: string;
  downloadsUsed: number;
  maxDownloads: number;
  status: "active" | "expired" | "exhausted" | "revoked";
  reissuePending: boolean;
}

const REQUEST_UI: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  PENDING: { label: "অপেক্ষমাণ", tone: "warning" },
  APPROVED: { label: "অনুমোদিত", tone: "success" },
  REJECTED: { label: "বাতিল", tone: "danger" },
};

const GRANT_UI: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  active: { label: "সক্রিয়", tone: "success" },
  expired: { label: "মেয়াদ শেষ", tone: "warning" },
  exhausted: { label: "ডাউনলোড শেষ", tone: "warning" },
  revoked: { label: "বাতিলকৃত", tone: "danger" },
};

const FILTERS: { key: string; label: string }[] = [
  { key: "", label: "সব" },
  { key: "PENDING", label: "অপেক্ষমাণ" },
  { key: "APPROVED", label: "অনুমোদিত" },
  { key: "REJECTED", label: "বাতিল" },
];

const inputCls =
  "h-10 w-full rounded-md border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("bn-BD", {
    timeZone: "Asia/Dhaka",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function AdminDownloadsPage() {
  const [rows, setRows] = useState<ReissueItem[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("PENDING");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [oneTimeLink, setOneTimeLink] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  // Grant lookup by order.
  const [lookupRef, setLookupRef] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<{ orderNo: string; grants: OrderGrant[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (status) qs.set("status", status);
      const res = await fetch(`/api/v1/admin/downloads?${qs.toString()}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      setRows(json.data ?? []);
      setTotal(json.meta?.total ?? 0);
      setCounts(json.meta?.counts ?? {});
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "লোড ব্যর্থ হয়েছে");
      setRows([]);
    }
  }, [page, status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(row: ReissueItem, kind: "approve" | "reject") {
    const note = (notes[row.id] ?? "").trim();
    if (kind === "reject" && note === "") {
      setActionError("বাতিল করতে হলে কারণ (নোট) লিখতে হবে।");
      return;
    }
    setBusyId(row.id);
    setActionError(null);
    setNotice(null);
    setOneTimeLink(null);
    try {
      const res = await fetch(`/api/v1/admin/downloads/${row.id}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(note ? { note } : {}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      if (kind === "approve") {
        setNotice(
          "অনুমোদিত — নতুন ডাউনলোড তৈরি হয়েছে এবং পুরনো লিংকটি বাতিল করা হয়েছে। গ্রাহক এখন অ্যাকাউন্ট থেকেই ডাউনলোড করতে পারবেন।",
        );
        if (typeof json.data?.downloadPath === "string") {
          setOneTimeLink(json.data.downloadPath);
        }
      } else {
        setNotice("অনুরোধটি বাতিল করা হয়েছে। পুরনো ডাউনলোডে কোনো পরিবর্তন হয়নি।");
      }
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "অ্যাকশন ব্যর্থ হয়েছে");
    } finally {
      setBusyId(null);
    }
  }

  async function runLookup() {
    const ref = lookupRef.trim();
    if (ref === "") return;
    setLookupBusy(true);
    setLookupError(null);
    setLookupResult(null);
    try {
      const res = await fetch(`/api/v1/admin/downloads/lookup?orderNo=${encodeURIComponent(ref)}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
      setLookupResult({ orderNo: json.data.orderNo, grants: json.data.grants ?? [] });
    } catch (e) {
      setLookupError(e instanceof Error ? e.message : "খোঁজ ব্যর্থ হয়েছে");
    } finally {
      setLookupBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="ডাউনলোড রি-ইস্যু"
        description="ডিজিটাল পণ্যের হারানো/মেয়াদোত্তীর্ণ ডাউনলোড লিংকের বদলি অনুরোধ। অনুমোদন দিলে নতুন গ্রান্ট তৈরি হয় ও পুরনোটি বাতিল হয় — পুরনো টোকেন কোনোভাবেই ফেরত পাওয়া যায় না (শুধু হ্যাশ রাখা হয়)।"
      />

      {notice !== null ? (
        <Card className="border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-800">
          {notice}
          {oneTimeLink !== null ? (
            <span className="mt-2 block">
              <span className="font-semibold">একবারের ডাউনলোড লিংক (শুধু এখনই দেখা যাচ্ছে):</span>{" "}
              <code className="break-all rounded bg-white/70 px-1.5 py-0.5 text-xs">{oneTimeLink}</code>
            </span>
          ) : null}
        </Card>
      ) : null}
      {actionError !== null ? (
        <Card className="border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">{actionError}</Card>
      ) : null}
      {loadError !== null ? (
        <Card className="border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">{loadError}</Card>
      ) : null}

      <Card className="p-4">
        <h2 className="text-sm font-bold text-text-main">অর্ডার দিয়ে ডাউনলোড খুঁজুন</h2>
        <div className="mt-3 flex gap-2">
          <input
            value={lookupRef}
            onChange={(e) => setLookupRef(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runLookup();
            }}
            placeholder="অর্ডার নম্বর (যেমন ORD-20261025-0001)"
            className={inputCls}
          />
          <Button type="button" onClick={() => void runLookup()} disabled={lookupBusy} className="shrink-0">
            {lookupBusy ? "খোঁজা হচ্ছে…" : "খুঁজুন"}
          </Button>
        </div>
        {lookupError !== null ? <p className="mt-2 text-sm leading-6 text-red-700">{lookupError}</p> : null}
        {lookupResult !== null ? (
          lookupResult.grants.length === 0 ? (
            <p className="mt-3 text-sm leading-6 text-text-muted">
              {lookupResult.orderNo} অর্ডারে কোনো ডাউনলোড গ্রান্ট নেই।
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {lookupResult.grants.map((g) => (
                <li
                  key={g.grantId}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-text-main">
                      {g.productName} — {g.fileName}
                    </span>
                    <span className="mt-0.5 block text-xs text-text-muted">
                      দেওয়া: {fmtDate(g.issuedAt)} · মেয়াদ: {fmtDate(g.expiresAt)} · ব্যবহার{" "}
                      {g.downloadsUsed}/{g.maxDownloads}
                      {g.reissuePending ? " · রি-ইস্যু অনুরোধ অপেক্ষমাণ" : ""}
                    </span>
                  </span>
                  <Badge tone={GRANT_UI[g.status]?.tone ?? "neutral"}>{GRANT_UI[g.status]?.label ?? g.status}</Badge>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => {
              setStatus(f.key);
              setPage(1);
            }}
            className={`rounded-full border px-3 py-1.5 text-sm font-semibold ${
              status === f.key
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-border bg-card text-text-main hover:bg-brand-50"
            }`}
          >
            {f.label}
            {f.key !== "" && counts[f.key] !== undefined ? ` (${counts[f.key]})` : ""}
          </button>
        ))}
        <span className="ml-auto text-xs text-text-muted">মোট {total}টি</span>
      </div>

      {rows === null ? (
        <p className="text-sm text-text-muted">লোড হচ্ছে…</p>
      ) : rows.length === 0 ? (
        <Card className="p-5 text-sm leading-6 text-text-muted">এই ফিল্টারে কোনো অনুরোধ নেই।</Card>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text-main">
                      {row.customerName}
                      <span className="ml-2 font-normal text-text-muted">{row.customerPhoneMasked}</span>
                    </p>
                    <p className="mt-1 text-sm leading-6 text-text-main">
                      {row.productName} — {row.fileName}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-text-muted">
                      অর্ডার{" "}
                      <Link
                        href={`/admin/orders/${row.orderId}`}
                        className="font-semibold text-brand-700 hover:underline"
                      >
                        {row.orderNo}
                      </Link>{" "}
                      · অনুরোধ: {fmtDate(row.createdAt)} · পুরনো গ্রান্ট: ব্যবহার {row.grantDownloadsUsed}/
                      {row.grantMaxDownloads}, মেয়াদ {fmtDate(row.grantExpiresAt)}
                    </p>
                    {row.reason ? (
                      <p className="mt-1 text-xs leading-5 text-text-muted">গ্রাহকের কারণ: {row.reason}</p>
                    ) : null}
                    {row.decisionNote ? (
                      <p className="mt-1 text-xs leading-5 text-text-muted">সিদ্ধান্তের নোট: {row.decisionNote}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge tone={REQUEST_UI[row.status]?.tone ?? "neutral"}>
                      {REQUEST_UI[row.status]?.label ?? row.status}
                    </Badge>
                    <Badge tone={GRANT_UI[row.grantStatus]?.tone ?? "neutral"}>
                      গ্রান্ট: {GRANT_UI[row.grantStatus]?.label ?? row.grantStatus}
                    </Badge>
                  </div>
                </div>

                {row.status === "PENDING" ? (
                  <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3 sm:flex-row">
                    <input
                      value={notes[row.id] ?? ""}
                      onChange={(e) => setNotes((prev) => ({ ...prev, [row.id]: e.target.value }))}
                      placeholder="নোট (বাতিলের জন্য আবশ্যক) / Note (required to reject)"
                      className={inputCls}
                    />
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        disabled={busyId === row.id}
                        onClick={() => void decide(row, "approve")}
                      >
                        {busyId === row.id ? "হচ্ছে…" : "অনুমোদন — নতুন গ্রান্ট"}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busyId === row.id}
                        onClick={() => void decide(row, "reject")}
                      >
                        বাতিল
                      </Button>
                    </div>
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {total > pageSize ? (
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            আগের পেজ
          </Button>
          <span className="text-xs text-text-muted">
            পেজ {page} / {Math.ceil(total / pageSize)}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={page >= Math.ceil(total / pageSize)}
            onClick={() => setPage((p) => p + 1)}
          >
            পরের পেজ
          </Button>
        </div>
      ) : null}
    </div>
  );
}
