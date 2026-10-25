"use client";

/**
 * Review moderation queue (client). Reads GET /api/v1/admin/reviews
 * and PATCHes /api/v1/admin/reviews/[id] with the new status. Props:
 * none — everything is fetched, mirroring the staff list pattern.
 * The phone arrives MASKED from the API and is shown as-is.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Stars } from "@/reviews/components/Stars";

/** Row shape of GET /api/v1/admin/reviews — defined locally (the
 *  staff-list pattern) so this client bundle never imports the
 *  server-side reviews store. Phone arrives MASKED from the API. */
type ReviewStatus = "PENDING" | "APPROVED" | "REJECTED";

interface AdminReview {
  id: string;
  productId: string;
  productTitleBn: string;
  productSlug: string;
  authorName: string;
  phoneMasked: string;
  rating: number;
  title: string | null;
  body: string;
  status: ReviewStatus;
  verifiedPurchase: boolean;
  createdAt: string;
}

type TabKey = ReviewStatus | "ALL";

interface ReviewsResponse {
  data?: {
    reviews: AdminReview[];
    counts: Record<ReviewStatus, number>;
  };
  error?: { code: string; message: string };
}

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "PENDING", label: "অপেক্ষমাণ" },
  { key: "APPROVED", label: "অনুমোদিত" },
  { key: "REJECTED", label: "প্রত্যাখ্যাত" },
  { key: "ALL", label: "সব" },
];

const STATUS_BADGE: Record<ReviewStatus, { label: string; tone: "success" | "warning" | "danger" }> = {
  PENDING: { label: "অপেক্ষমাণ (PENDING)", tone: "warning" },
  APPROVED: { label: "অনুমোদিত (APPROVED)", tone: "success" },
  REJECTED: { label: "প্রত্যাখ্যাত (REJECTED)", tone: "danger" },
};

type LoadState = "loading" | "ready" | "error";

function bnDate(iso: string): string {
  return new Date(iso).toLocaleDateString("bn-BD", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function ReviewsManager() {
  const [tab, setTab] = useState<TabKey>("PENDING");
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [counts, setCounts] = useState<Record<ReviewStatus, number>>({ PENDING: 0, APPROVED: 0, REJECTED: 0 });
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [rowError, setRowError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (forTab: TabKey) => {
    setLoadState("loading");
    try {
      const qs = forTab === "ALL" ? "" : `?status=${forTab}`;
      const res = await fetch(`/api/v1/admin/reviews${qs}`);
      const body = (await res.json().catch(() => null)) as ReviewsResponse | null;
      if (res.ok && body?.data) {
        setReviews(body.data.reviews);
        setCounts(body.data.counts);
        setLoadState("ready");
      } else {
        setLoadError(body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`);
        setLoadState("error");
      }
    } catch {
      setLoadError("নেটওয়ার্ক সমস্যা — API-তে পৌঁছানো যায়নি।");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void load(tab);
  }, [load, tab]);

  async function setStatus(review: AdminReview, status: ReviewStatus) {
    setRowError(null);
    setBusyId(review.id);
    try {
      const res = await fetch(`/api/v1/admin/reviews/${review.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
      if (!res.ok) {
        setRowError(body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`);
        return;
      }
      await load(tab);
    } catch {
      setRowError("নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="রিভিউ স্ট্যাটাস">
        {TABS.map((t) => {
          const count = t.key === "ALL" ? counts.PENDING + counts.APPROVED + counts.REJECTED : counts[t.key];
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`rounded-xl px-4 py-2 text-sm font-bold shadow-sm transition ${
                active
                  ? "brand-gradient text-white"
                  : "border border-border bg-card text-text-main hover:bg-surface-2"
              }`}
            >
              {t.label} ({count})
            </button>
          );
        })}
      </div>

      {rowError ? (
        <p role="alert" className="mt-4 text-sm font-medium text-rose-600">
          {rowError}
        </p>
      ) : null}

      {loadState === "loading" ? (
        <p className="mt-6 text-sm text-text-muted">লোড হচ্ছে…</p>
      ) : loadState === "error" ? (
        <p role="alert" className="mt-6 text-sm font-medium text-rose-600">
          রিভিউ লোড করা যায়নি — {loadError}
        </p>
      ) : reviews.length === 0 ? (
        <p className="mt-6 text-sm text-text-muted">
          এই তালিকায় কোনো রিভিউ নেই। নতুন রিভিউ এলে এখানে মডারেশনের জন্য দেখা যাবে।
        </p>
      ) : (
        <ul className="mt-6 space-y-4">
          {reviews.map((r) => (
            <li key={r.id}>
              <Card className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-text-main">{r.authorName}</span>
                      {r.verifiedPurchase ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                          যাচাইকৃত ক্রেতা
                        </span>
                      ) : null}
                      <span className="text-xs text-text-subtle">
                        {r.phoneMasked} · {bnDate(r.createdAt)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-text-muted">
                      পণ্য:{" "}
                      <a
                        href={`/product/${r.productSlug}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {r.productTitleBn}
                      </a>
                    </p>
                    <div className="mt-2">
                      <Stars rating={r.rating} size={14} />
                    </div>
                    {r.title ? <p className="mt-2 text-sm font-bold text-text-main">{r.title}</p> : null}
                    <p className="mt-1 break-words text-sm leading-6 text-text-muted [overflow-wrap:anywhere]">
                      {r.body}
                    </p>
                  </div>
                  <Badge tone={STATUS_BADGE[r.status].tone}>{STATUS_BADGE[r.status].label}</Badge>
                </div>

                <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
                  {r.status !== "APPROVED" ? (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void setStatus(r, "APPROVED")}
                      className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
                    >
                      অনুমোদন করুন
                    </button>
                  ) : null}
                  {r.status !== "REJECTED" ? (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void setStatus(r, "REJECTED")}
                      className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-wait disabled:opacity-60"
                    >
                      প্রত্যাখ্যান করুন
                    </button>
                  ) : null}
                  {r.status !== "PENDING" ? (
                    <button
                      type="button"
                      disabled={busyId === r.id}
                      onClick={() => void setStatus(r, "PENDING")}
                      className="rounded-xl border border-border bg-surface px-4 py-2 text-sm font-bold text-text-main shadow-sm transition hover:bg-surface-2 disabled:cursor-wait disabled:opacity-60"
                    >
                      আবার অপেক্ষমাণ করুন
                    </button>
                  ) : null}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
