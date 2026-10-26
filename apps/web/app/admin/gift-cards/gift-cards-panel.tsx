"use client";

/**
 * Gift cards panel (ADV-18A) — self-fetching admin panel over
 * /api/v1/admin/gift-cards.
 *
 * Issue: amount (entered in taka, sent as integer poisha) + count +
 * optional expiry. The response's plaintext codes are shown ONCE in
 * the success block below — the server stores only hashes, so this
 * panel (and the API) can never display a code again; the block says
 * so in plain words.
 *
 * List: every card with its LEDGER-DERIVED balance and effective
 * status (ACTIVE / DEPLETED / EXPIRED / DISABLED). Disable flips the
 * stored status server-side and is terminal by design.
 */
import { useCallback, useEffect, useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface GiftCardView {
  id: string;
  codeLast4: string;
  initialPoisha: number;
  balancePoisha: number;
  status: "ACTIVE" | "DEPLETED" | "DISABLED" | "EXPIRED";
  storedStatus: string;
  expiresAt: string | null;
  createdAt: string;
}

interface IssuedCard {
  id: string;
  code: string;
  codeLast4: string;
  initialPoisha: number;
  expiresAt: string | null;
}

const STATUS_LABEL: Record<GiftCardView["status"], string> = {
  ACTIVE: "সক্রিয়",
  DEPLETED: "ব্যালেন্স শেষ",
  EXPIRED: "মেয়াদোত্তীর্ণ",
  DISABLED: "নিষ্ক্রিয়",
};

const STATUS_TONE: Record<GiftCardView["status"], "success" | "warning" | "neutral" | "danger"> = {
  ACTIVE: "success",
  DEPLETED: "warning",
  EXPIRED: "neutral",
  DISABLED: "danger",
};

const dateFmt = new Intl.DateTimeFormat("bn-BD", {
  timeZone: "Asia/Dhaka",
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

export function GiftCardsPanel() {
  const [cards, setCards] = useState<GiftCardView[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [locked, setLocked] = useState(false);

  const [amountTaka, setAmountTaka] = useState("");
  const [count, setCount] = useState("1");
  const [expiresDate, setExpiresDate] = useState("");
  const [issuing, setIssuing] = useState(false);
  const [issueError, setIssueError] = useState("");
  const [issued, setIssued] = useState<IssuedCard[] | null>(null);
  const [disablingId, setDisablingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/gift-cards");
      const body = (await res.json().catch(() => null)) as
        | { data?: { cards: GiftCardView[] }; error?: { code: string; message: string } }
        | null;
      if (res.status === 403 && body?.error?.code === "FEATURE_LOCKED") {
        setLocked(true);
        setCards([]);
        return;
      }
      if (res.ok && body?.data?.cards) {
        setCards(body.data.cards);
        setLoadError("");
      } else {
        setLoadError(body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`);
      }
    } catch {
      setLoadError("নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন। (Network error — try again.)");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onIssue(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIssueError("");
    setIssued(null);
    const taka = Number(amountTaka);
    const amountPoisha = Math.round(taka * 100);
    const n = Number(count);
    if (!Number.isFinite(taka) || amountPoisha <= 0) {
      setIssueError("সঠিক পরিমাণ দিন (টাকায়)। / Enter a valid amount in taka.");
      return;
    }
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      setIssueError("সংখ্যা ১–১০০ এর মধ্যে হতে হবে। / Count must be between 1 and 100.");
      return;
    }
    setIssuing(true);
    try {
      const res = await fetch("/api/v1/admin/gift-cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountPoisha,
          count: n,
          expiresAt: expiresDate ? new Date(`${expiresDate}T23:59:59+06:00`).toISOString() : null,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { data?: { issued: IssuedCard[] }; error?: { code: string; message: string } }
        | null;
      if (res.ok && body?.data?.issued) {
        setIssued(body.data.issued);
        setAmountTaka("");
        setCount("1");
        setExpiresDate("");
        void load();
      } else {
        setIssueError(body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`);
      }
    } catch {
      setIssueError("নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন। (Network error — try again.)");
    } finally {
      setIssuing(false);
    }
  }

  async function onDisable(card: GiftCardView) {
    setDisablingId(card.id);
    try {
      const res = await fetch(`/api/v1/admin/gift-cards/${card.id}/disable`, { method: "POST" });
      if (res.ok) void load();
    } finally {
      setDisablingId(null);
    }
  }

  if (locked) {
    return (
      <p className="text-small leading-relaxed text-text-muted">
        মার্কেটিং মেকানিক্স মডিউলটি এই ইনস্টলে বন্ধ আছে (module.marketing_mechanics OFF) — গিফট কার্ড চালু করতে
        Settings → Feature Flags থেকে মডিউলটি চালু করুন। / The marketing mechanics module is OFF for this
        install — enable it under Settings → Feature Flags to use gift cards.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-surface-2/50 px-4 py-4">
        <h2 className="text-body font-semibold text-text-main">নতুন গিফট কার্ড ইস্যু করুন</h2>
        <form onSubmit={onIssue} className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-caption text-text-subtle">পরিমাণ (টাকা)</span>
            <Input
              type="number"
              min="1"
              step="any"
              value={amountTaka}
              onChange={(e) => setAmountTaka(e.target.value)}
              placeholder="500"
              className="w-36"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-caption text-text-subtle">কয়টি কার্ড</span>
            <Input
              type="number"
              min="1"
              max="100"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              className="w-24"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-caption text-text-subtle">মেয়াদ শেষ (ঐচ্ছিক)</span>
            <Input
              type="date"
              value={expiresDate}
              onChange={(e) => setExpiresDate(e.target.value)}
              className="w-44"
            />
          </label>
          <Button type="submit" disabled={issuing}>
            {issuing ? "ইস্যু হচ্ছে…" : "ইস্যু করুন"}
          </Button>
        </form>
        {issueError ? <p className="mt-3 text-small text-rose-600">{issueError}</p> : null}
        {issued ? (
          <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-small font-semibold text-amber-900">
              ⚠ এই কোডগুলো শুধু এই একবারই দেখা যাবে — এখনই কপি করে রাখুন। সার্ভারে শুধু কোডের হ্যাশ থাকে,
              কোড হারালে তা আর উদ্ধার করা যাবে না। / These codes are shown ONCE — copy them now. Only their
              hashes are stored; a lost code cannot be recovered.
            </p>
            <ul className="mt-2 space-y-1">
              {issued.map((c) => (
                <li key={c.id} className="font-mono text-body text-amber-950">
                  {c.code} <span className="text-text-muted">({formatBdt(c.initialPoisha)})</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="text-body font-semibold text-text-main">ইস্যু করা কার্ডসমূহ</h2>
        {loadError ? (
          <p className="mt-2 text-small text-rose-600">কার্ড লোড করা যায়নি: {loadError}</p>
        ) : cards === null ? (
          <p className="mt-2 text-small text-text-muted">লোড হচ্ছে…</p>
        ) : cards.length === 0 ? (
          <p className="mt-2 text-small text-text-muted">এখনো কোনো গিফট কার্ড ইস্যু করা হয়নি।</p>
        ) : (
          <div className="mt-3 space-y-3">
            {cards.map((card) => (
              <div key={card.id} className="rounded-lg border border-border bg-surface-2/50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <span className="min-w-0">
                    <span className="block text-small font-semibold text-text-main">
                      গিফট কার্ড …{card.codeLast4}
                    </span>
                    <span className="mt-0.5 block text-caption text-text-subtle">
                      ইস্যু: {formatDate(card.createdAt)} · মেয়াদ: {card.expiresAt ? formatDate(card.expiresAt) : "মেয়াদ নেই"}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-small text-text-main">
                      ব্যালেন্স {formatBdt(card.balancePoisha)}
                      <span className="text-text-muted"> / {formatBdt(card.initialPoisha)}</span>
                    </span>
                    <Badge tone={STATUS_TONE[card.status]}>{STATUS_LABEL[card.status]}</Badge>
                    {card.storedStatus === "ACTIVE" ? (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={disablingId === card.id}
                        onClick={() => void onDisable(card)}
                      >
                        {disablingId === card.id ? "হচ্ছে…" : "নিষ্ক্রিয় করুন"}
                      </Button>
                    ) : null}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
