"use client";

/**
 * Account downloads section (doc 18, batch F3) — mounted by the
 * /account server page under the returns section.
 *
 * Lists the customer's DownloadGrants (GET
 * /api/v1/public/account/downloads): product/file name, issued +
 * expiry dates, downloads left and a computed status. Downloading
 * goes through the session-authorized access endpoint (a plain form
 * POST → 302 → presigned file URL): grant tokens are hash-only and
 * unrecoverable BY DESIGN, so no token ever appears here — being
 * signed in IS the credential.
 *
 * When a grant is expired / exhausted (or the customer lost the
 * original link), "নতুন লিংক চাই" files a re-issue request. Staff
 * approve it in the admin; approval mints a NEW grant (which then
 * shows up in this list with its own Download button) and revokes
 * the old one. Nothing here promises instant delivery of anything —
 * the copy says approval is a staff decision.
 */
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/icon";

type GrantStatus = "active" | "expired" | "exhausted" | "revoked";

interface DownloadView {
  grantId: string;
  orderId: string;
  orderNo: string;
  productName: string;
  fileName: string;
  issuedAt: string;
  expiresAt: string;
  maxDownloads: number;
  downloadsUsed: number;
  downloadsLeft: number;
  status: GrantStatus;
  statusLabel: { bn: string; en: string };
  reissuePending: boolean;
}

const STATUS_TONE: Record<GrantStatus, string> = {
  active: "bg-emerald-50 text-emerald-700",
  expired: "bg-amber-50 text-amber-700",
  exhausted: "bg-amber-50 text-amber-700",
  revoked: "bg-red-50 text-red-700",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("bn-BD", { dateStyle: "medium" }).format(new Date(iso));
}

function ReissueForm({
  grant,
  onDone,
}: {
  grant: DownloadView;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/public/account/downloads/${grant.grantId}/reissue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reason.trim() ? { reason: reason.trim() } : {}),
      });
      const json = (await res.json()) as { error?: { message?: string } };
      if (!res.ok) {
        setError(json.error?.message ?? "অনুরোধ পাঠানো যায়নি।");
        return;
      }
      onDone(
        "নতুন লিংকের অনুরোধ পাঠানো হয়েছে। আমাদের টিম অনুমোদন দিলে নতুন ডাউনলোডটি এই তালিকাতেই পেয়ে যাবেন — আলাদা কোনো লিংক লাগবে না।",
      );
    } catch {
      setError("অনুরোধ পাঠানো যায়নি। আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-border bg-bg-app p-3.5">
      <p className="text-xs leading-5 text-text-muted">
        কেন নতুন লিংক দরকার লিখুন (ঐচ্ছিক) — যেমন: আগের লিংকটি হারিয়ে ফেলেছি, মেয়াদ শেষ হয়ে
        গেছে।
      </p>
      <input
        type="text"
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="কারণ (ঐচ্ছিক) / Reason (optional)"
        className="mt-2 w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-text-main"
      />
      {error !== null ? <p className="mt-2 text-sm leading-6 text-red-700">{error}</p> : null}
      <div className="mt-3">
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
        >
          {busy ? "পাঠানো হচ্ছে…" : "অনুরোধ পাঠান"}
        </button>
      </div>
    </div>
  );
}

export default function DownloadsSection() {
  const [downloads, setDownloads] = useState<DownloadView[] | null>(null);
  const [openGrantId, setOpenGrantId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/public/account/downloads");
      const json = (await res.json()) as { data?: { downloads: DownloadView[] } };
      setDownloads(json.data?.downloads ?? []);
    } catch {
      setDownloads([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // No digital purchases → render nothing (the section must not
  // clutter accounts that only bought physical goods).
  if (downloads === null || downloads.length === 0) return null;

  return (
    <section
      className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card"
      aria-label="আমার ডাউনলোড"
    >
      <h2 className="flex items-center gap-2.5 text-base font-bold text-text-main">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-white"
        >
          <Icon name="box" size={18} />
        </span>
        আমার ডাউনলোড
      </h2>
      <p className="mt-1.5 text-sm leading-6 text-text-muted">
        কেনা ডিজিটাল পণ্যের ফাইল এখান থেকে সরাসরি ডাউনলোড করা যায় — আলাদা লিংক সংরক্ষণ করার
        দরকার নেই, লগইন থাকলেই হবে। প্রতিটি ডাউনলোডের মেয়াদ ও সর্বোচ্চ সংখ্যা পাশে দেখানো আছে।
      </p>

      {flash !== null ? (
        <p className="mt-3 rounded-lg bg-brand-50 px-3.5 py-2.5 text-sm leading-6 text-brand-700">
          {flash}
        </p>
      ) : null}

      <ul className="mt-4 space-y-3">
        {downloads.map((d) => (
          <li key={d.grantId} className="rounded-xl border border-border px-4 py-3">
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700"
              >
                <Icon name="box" size={16} />
              </span>
              <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-text-main">{d.productName}</p>
                  <p className="mt-0.5 truncate text-xs text-text-muted">{d.fileName}</p>
                  <p className="mt-1 text-xs leading-5 text-text-muted">
                    অর্ডার{" "}
                    <a
                      href={`/track?orderNo=${encodeURIComponent(d.orderNo)}`}
                      className="font-semibold text-brand-700 hover:underline"
                    >
                      {d.orderNo}
                    </a>{" "}
                    · কেনা: {formatDate(d.issuedAt)} · মেয়াদ: {formatDate(d.expiresAt)} · বাকি{" "}
                    {d.downloadsLeft}/{d.maxDownloads}টি ডাউনলোড
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[d.status]}`}
                >
                  {d.statusLabel.bn}
                </span>
              </div>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {d.status === "active" ? (
                <form
                  method="post"
                  action={`/api/v1/public/account/downloads/${d.grantId}/access`}
                >
                  <button
                    type="submit"
                    className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                  >
                    ডাউনলোড করুন
                  </button>
                </form>
              ) : null}
              {d.status !== "revoked" ? (
                d.reissuePending ? (
                  <span className="text-xs font-medium leading-5 text-text-muted">
                    নতুন লিংকের অনুরোধ অপেক্ষমাণ আছে — অনুমোদন হলে নতুন ডাউনলোড এখানেই আসবে।
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setOpenGrantId(openGrantId === d.grantId ? null : d.grantId)}
                    className="rounded-lg border border-border px-3 py-1.5 text-sm font-semibold text-brand-700 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                  >
                    নতুন লিংক চাই
                  </button>
                )
              ) : (
                <span className="text-xs leading-5 text-text-muted">
                  এই ডাউনলোডটি বাতিল করা হয়েছে — নতুনটি উপরের তালিকায় দেখুন।
                </span>
              )}
            </div>

            {openGrantId === d.grantId ? (
              <ReissueForm
                grant={d}
                onDone={(message) => {
                  setFlash(message);
                  setOpenGrantId(null);
                  void load();
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
