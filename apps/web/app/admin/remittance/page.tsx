"use client";

/**
 * COD remittance ledger — REAL data from /api/v1/admin/remittances
 * (wave 26, doc 17 batch O8). Answers: "the courier collected ৳X for
 * us — how much did they actually send back, and which orders are
 * still missing?"
 *
 * A batch covers an exact set of RECORDED COD collections (Payment
 * rows the courier/rider flow wrote) for one provider + collection
 * period; expected is always Σ those rows, never an order total.
 * Marking a batch RECEIVED records what actually came back + the
 * courier's fee; the variance (expected − received − fee) is shown
 * in red whenever it is non-zero, and a batch with a variance can
 * only be CLOSED with a note explaining it. Collections whose
 * provider cannot be proven from the collection marker (e.g. a COD
 * payment recorded by hand) are shown as "unattributed" and can
 * never enter a batch. Phones arrive MASKED from the API.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatPoisha } from "@/components/ui/money";

interface OutstandingOrder {
  paymentId: string;
  orderId: string;
  orderNo: string;
  customerName: string;
  customerPhoneMasked: string;
  amountPoisha: number;
  collectedAt: string;
  ageDays: number;
}

interface Outstanding {
  providers: {
    provider: string;
    count: number;
    totalPoisha: number;
    oldestAgeDays: number;
    orders: OutstandingOrder[];
  }[];
  unattributed: { count: number; totalPoisha: number; orders: OutstandingOrder[] };
}

interface Batch {
  id: string;
  provider: string;
  periodStart: string;
  periodEnd: string;
  expectedPoisha: number;
  receivedPoisha: number | null;
  feePoisha: number | null;
  variancePoisha: number | null;
  status: string;
  receivedAt: string | null;
  note: string | null;
  itemCount: number;
  createdAt: string;
}

interface BatchItem {
  id: string;
  orderId: string;
  orderNo: string;
  customerName: string;
  customerPhoneMasked: string;
  paymentId: string;
  expectedPoisha: number;
  collectedAt: string;
}

const PROVIDERS = ["steadfast", "pathao", "redx", "paperfly", "ecourier", "rider"] as const;

const STATUS_UI: Record<string, { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  OPEN: { label: "খোলা — প্রাপ্তি বাকি", tone: "warning" },
  RECEIVED: { label: "টাকা এসেছে", tone: "info" },
  CLOSED: { label: "বন্ধ", tone: "success" },
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka" });
}

export default function RemittancePage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [outstanding, setOutstanding] = useState<Outstanding | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [provider, setProvider] = useState<string>("steadfast");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [creating, setCreating] = useState(false);

  const [openBatchId, setOpenBatchId] = useState<string | null>(null);
  const [items, setItems] = useState<BatchItem[]>([]);
  const [receivedTaka, setReceivedTaka] = useState("");
  const [feeTaka, setFeeTaka] = useState("");
  const [actionNote, setActionNote] = useState("");
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/admin/remittances?pageSize=50");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "লোড ব্যর্থ হয়েছে।");
      setBatches(json.data ?? []);
      setOutstanding(json.meta?.outstanding ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "লোড ব্যর্থ হয়েছে।");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createBatch = async () => {
    if (!periodStart || !periodEnd) {
      setError("শুরুর ও শেষের তারিখ দুটোই দিন। / Both period dates are required.");
      return;
    }
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/admin/remittances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          periodStart: new Date(`${periodStart}T00:00:00+06:00`).toISOString(),
          periodEnd: new Date(`${periodEnd}T23:59:59.999+06:00`).toISOString(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "ব্যাচ তৈরি ব্যর্থ হয়েছে।");
      setNotice(
        `ব্যাচ তৈরি হয়েছে — ${json.data.itemCount}টি সংগ্রহ, প্রত্যাশিত ${formatPoisha(json.data.expectedPoisha)}।`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ব্যাচ তৈরি ব্যর্থ হয়েছে।");
    } finally {
      setCreating(false);
    }
  };

  const toggleBatch = async (batch: Batch) => {
    if (openBatchId === batch.id) {
      setOpenBatchId(null);
      return;
    }
    setOpenBatchId(batch.id);
    setItems([]);
    setReceivedTaka(batch.expectedPoisha ? String(batch.expectedPoisha / 100) : "");
    setFeeTaka("");
    setActionNote(batch.note ?? "");
    try {
      const res = await fetch(`/api/v1/admin/remittances/${batch.id}`);
      const json = await res.json();
      if (res.ok) setItems(json.data?.items ?? []);
    } catch {
      /* items stay empty; the batch row itself still shows totals */
    }
  };

  const postAction = async (batch: Batch, kind: "receive" | "close") => {
    setActing(true);
    setError(null);
    setNotice(null);
    try {
      const body =
        kind === "receive"
          ? {
              receivedPoisha: Math.round(Number(receivedTaka || "0") * 100),
              feePoisha: Math.round(Number(feeTaka || "0") * 100),
              note: actionNote || undefined,
            }
          : { note: actionNote || undefined };
      const res = await fetch(`/api/v1/admin/remittances/${batch.id}/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "ব্যর্থ হয়েছে।");
      setNotice(
        kind === "receive"
          ? `প্রাপ্তি রেকর্ড হয়েছে — অমিল (variance): ${formatPoisha(json.data.variancePoisha ?? 0)}।`
          : "ব্যাচ বন্ধ করা হয়েছে।",
      );
      setOpenBatchId(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ব্যর্থ হয়েছে।");
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="কুরিয়ার রেমিট্যান্স (COD)"
        description="কুরিয়ার/রাইডার গ্রাহকের কাছ থেকে যে COD টাকা তুলেছে, তার মধ্যে কতটা দোকানে ফেরত এসেছে — ব্যাচ ধরে হিসাব। প্রত্যাশিত অর্থ সবসময় রেকর্ড-হওয়া সংগ্রহের যোগফল, অর্ডারের মোট থেকে অনুমান নয়।"
      />

      {error ? (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-small text-danger">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded-lg border border-success/40 bg-success/10 px-4 py-3 text-small text-success">{notice}</div>
      ) : null}

      {/* ------- Outstanding: the "courier owes us" view ------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(outstanding?.providers ?? []).map((p) => (
          <Card key={p.provider} className="p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium capitalize text-text-main">{p.provider}</span>
              <Badge tone={p.oldestAgeDays >= 7 ? "danger" : p.oldestAgeDays >= 3 ? "warning" : "neutral"}>
                সবচেয়ে পুরনো {p.oldestAgeDays} দিন
              </Badge>
            </div>
            <div className="mt-2 text-h3 font-semibold text-text-main">{formatPoisha(p.totalPoisha)}</div>
            <p className="text-small text-text-muted">
              {p.count}টি সংগ্রহ এখনো কোনো ব্যাচে যায়নি — কুরিয়ারের কাছে পাওনা।
            </p>
          </Card>
        ))}
        {outstanding && outstanding.unattributed.count > 0 ? (
          <Card className="border-warning/50 p-4">
            <div className="flex items-center justify-between">
              <span className="font-medium text-text-main">প্রোভাইডার অজানা</span>
              <Badge tone="warning">unattributed</Badge>
            </div>
            <div className="mt-2 text-h3 font-semibold text-text-main">
              {formatPoisha(outstanding.unattributed.totalPoisha)}
            </div>
            <p className="text-small text-text-muted">
              {outstanding.unattributed.count}টি COD পেমেন্টের প্রোভাইডার সংগ্রহ-মার্কার থেকে প্রমাণ করা যায়নি
              (যেমন হাতে রেকর্ড করা) — এগুলো কোনো ব্যাচে যাবে না।
            </p>
          </Card>
        ) : null}
        {!loading && outstanding && outstanding.providers.length === 0 && outstanding.unattributed.count === 0 ? (
          <Card className="p-4">
            <p className="text-small text-text-muted">সব সংগ্রহ ব্যাচে চলে গেছে — কারো কাছে পাওনা নেই।</p>
          </Card>
        ) : null}
      </div>

      {/* ------- Outstanding orders table ------- */}
      {(outstanding?.providers ?? []).map((p) => (
        <Card key={`tbl-${p.provider}`} className="p-4">
          <h3 className="mb-3 font-medium capitalize text-text-main">
            {p.provider} — ব্যাচের বাইরে থাকা সংগ্রহ ({p.count})
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-small">
              <thead>
                <tr className="text-left text-text-muted">
                  <th className="py-1 pr-3">অর্ডার</th>
                  <th className="py-1 pr-3">গ্রাহক</th>
                  <th className="py-1 pr-3">ফোন</th>
                  <th className="py-1 pr-3">সংগ্রহের তারিখ</th>
                  <th className="py-1 pr-3">বয়স</th>
                  <th className="py-1 text-right">পরিমাণ</th>
                </tr>
              </thead>
              <tbody>
                {p.orders.map((o) => (
                  <tr key={o.paymentId} className="border-t border-border">
                    <td className="py-1.5 pr-3">
                      <Link href={`/admin/orders/${o.orderId}`} className="text-primary hover:underline">
                        {o.orderNo}
                      </Link>
                    </td>
                    <td className="py-1.5 pr-3">{o.customerName}</td>
                    <td className="py-1.5 pr-3 font-mono">{o.customerPhoneMasked}</td>
                    <td className="py-1.5 pr-3">{fmtDate(o.collectedAt)}</td>
                    <td className="py-1.5 pr-3">{o.ageDays} দিন</td>
                    <td className="py-1.5 text-right">{formatPoisha(o.amountPoisha)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}

      {/* ------- Create batch ------- */}
      <Card className="p-4">
        <h3 className="mb-3 font-medium text-text-main">নতুন রেমিট্যান্স ব্যাচ</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-small text-text-muted">
            প্রোভাইডার
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              className="mt-1 block rounded-md border border-border bg-bg-surface px-3 py-2 text-text-main"
            >
              {PROVIDERS.map((p) => (
                <option key={p} value={p}>
                  {p === "rider" ? "নিজস্ব রাইডার (rider)" : p}
                </option>
              ))}
            </select>
          </label>
          <label className="text-small text-text-muted">
            সংগ্রহের শুরু
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="mt-1 block rounded-md border border-border bg-bg-surface px-3 py-2 text-text-main"
            />
          </label>
          <label className="text-small text-text-muted">
            সংগ্রহের শেষ
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="mt-1 block rounded-md border border-border bg-bg-surface px-3 py-2 text-text-main"
            />
          </label>
          <Button onClick={createBatch} disabled={creating}>
            {creating ? "তৈরি হচ্ছে…" : "ব্যাচ তৈরি করুন"}
          </Button>
        </div>
        <p className="mt-2 text-small text-text-muted">
          ঐ সময়ে ঐ প্রোভাইডারের যেসব সংগ্রহ এখনো কোনো ব্যাচে যায়নি, সেগুলোই এই ব্যাচে আসবে।
        </p>
      </Card>

      {/* ------- Batches ------- */}
      <Card className="p-4">
        <h3 className="mb-3 font-medium text-text-main">ব্যাচসমূহ</h3>
        {loading ? (
          <p className="text-small text-text-muted">লোড হচ্ছে…</p>
        ) : batches.length === 0 ? (
          <p className="text-small text-text-muted">এখনো কোনো ব্যাচ নেই।</p>
        ) : (
          <div className="space-y-3">
            {batches.map((b) => {
              const ui = STATUS_UI[b.status] ?? { label: b.status, tone: "neutral" as const };
              const open = openBatchId === b.id;
              return (
                <div key={b.id} className="rounded-lg border border-border p-3">
                  <button type="button" onClick={() => void toggleBatch(b)} className="flex w-full flex-wrap items-center gap-3 text-left">
                    <span className="font-medium capitalize text-text-main">{b.provider}</span>
                    <Badge tone={ui.tone}>{ui.label}</Badge>
                    <span className="text-small text-text-muted">
                      {fmtDate(b.periodStart)} → {fmtDate(b.periodEnd)} · {b.itemCount}টি সংগ্রহ
                    </span>
                    <span className="ml-auto text-small text-text-main">
                      প্রত্যাশিত {formatPoisha(b.expectedPoisha)}
                      {b.receivedPoisha !== null ? <> · এসেছে {formatPoisha(b.receivedPoisha)}</> : null}
                      {b.feePoisha !== null && b.feePoisha > 0 ? <> · ফি {formatPoisha(b.feePoisha)}</> : null}
                    </span>
                    {b.variancePoisha !== null && b.variancePoisha !== 0 ? (
                      <Badge tone="danger">অমিল {formatPoisha(b.variancePoisha)}</Badge>
                    ) : null}
                  </button>
                  {open ? (
                    <div className="mt-3 space-y-3 border-t border-border pt-3">
                      {items.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-small">
                            <thead>
                              <tr className="text-left text-text-muted">
                                <th className="py-1 pr-3">অর্ডার</th>
                                <th className="py-1 pr-3">গ্রাহক</th>
                                <th className="py-1 pr-3">ফোন</th>
                                <th className="py-1 pr-3">সংগ্রহ</th>
                                <th className="py-1 text-right">পরিমাণ</th>
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((i) => (
                                <tr key={i.id} className="border-t border-border">
                                  <td className="py-1.5 pr-3">
                                    <Link href={`/admin/orders/${i.orderId}`} className="text-primary hover:underline">
                                      {i.orderNo}
                                    </Link>
                                  </td>
                                  <td className="py-1.5 pr-3">{i.customerName}</td>
                                  <td className="py-1.5 pr-3 font-mono">{i.customerPhoneMasked}</td>
                                  <td className="py-1.5 pr-3">{fmtDate(i.collectedAt)}</td>
                                  <td className="py-1.5 text-right">{formatPoisha(i.expectedPoisha)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-small text-text-muted">আইটেম লোড হচ্ছে…</p>
                      )}
                      {b.status === "OPEN" ? (
                        <div className="flex flex-wrap items-end gap-3">
                          <label className="text-small text-text-muted">
                            প্রাপ্ত টাকা (৳)
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={receivedTaka}
                              onChange={(e) => setReceivedTaka(e.target.value)}
                              className="mt-1 block w-36 rounded-md border border-border bg-bg-surface px-3 py-2 text-text-main"
                            />
                          </label>
                          <label className="text-small text-text-muted">
                            কুরিয়ার ফি (৳)
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={feeTaka}
                              onChange={(e) => setFeeTaka(e.target.value)}
                              className="mt-1 block w-32 rounded-md border border-border bg-bg-surface px-3 py-2 text-text-main"
                            />
                          </label>
                          <label className="flex-1 text-small text-text-muted">
                            নোট
                            <input
                              type="text"
                              value={actionNote}
                              onChange={(e) => setActionNote(e.target.value)}
                              className="mt-1 block w-full rounded-md border border-border bg-bg-surface px-3 py-2 text-text-main"
                            />
                          </label>
                          <Button onClick={() => void postAction(b, "receive")} disabled={acting}>
                            প্রাপ্তি রেকর্ড করুন
                          </Button>
                        </div>
                      ) : null}
                      {b.status === "RECEIVED" ? (
                        <div className="flex flex-wrap items-end gap-3">
                          <label className="flex-1 text-small text-text-muted">
                            বন্ধের নোট{(b.variancePoisha ?? 0) !== 0 ? " (অমিল থাকায় আবশ্যক)" : ""}
                            <input
                              type="text"
                              value={actionNote}
                              onChange={(e) => setActionNote(e.target.value)}
                              className="mt-1 block w-full rounded-md border border-border bg-bg-surface px-3 py-2 text-text-main"
                            />
                          </label>
                          <Button onClick={() => void postAction(b, "close")} disabled={acting}>
                            ব্যাচ বন্ধ করুন
                          </Button>
                        </div>
                      ) : null}
                      {b.status === "CLOSED" && b.note ? (
                        <p className="text-small text-text-muted">নোট: {b.note}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
