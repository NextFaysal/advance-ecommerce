"use client";

// CRM — REAL data from GET /api/v1/admin/customers (Prisma-backed;
// aggregates computed from the Order table server-side). Phone is masked
// by the API for viewers without customers.view_full_phone, and this
// page masks again on display. An empty DB shows an honest empty state.
//
// Presentation (Design Refresh R3): PageHeader + filter card, token
// table with selected-row state, profile card. The "to be wired" tabs
// and quick actions stay labelled as such. Data flow unchanged.
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Customer } from "../../../src/orders/types";
import { customerAovPoisha, customerSuccessRate, displayPhone } from "../../../src/orders/customer";
import { formatBdt } from "../../../src/checkout/pricing";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type LoadState = "loading" | "error" | "ready";

const PROFILE_TABS = ["অর্ডার", "ঠিকানা", "ওয়ালেট ও পয়েন্ট", "নোট", "কার্যকলাপ"];
const QUICK_ACTIONS = ["কল", "SMS", "WhatsApp", "ব্লক/আনব্লক", "নোট যোগ", "ট্যাগ যোগ"];

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (initialSearch: string) => {
    setLoadState("loading");
    try {
      const qs = new URLSearchParams({ pageSize: "100" });
      if (initialSearch) qs.set("search", initialSearch);
      const res = await fetch(`/api/v1/admin/customers?${qs.toString()}`);
      const body = (await res.json().catch(() => null)) as
        | { data?: Customer[]; meta?: { total?: number }; error?: { code: string; message: string } }
        | null;
      if (res.ok && body && "data" in body && body.data) {
        setCustomers(body.data);
        setTotal(body.meta?.total ?? body.data.length);
        setSelectedId((prev) => prev ?? body.data![0]?.id ?? null);
        setLoadState("ready");
      } else {
        setLoadError(
          body && "error" in body && body.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`,
        );
        setLoadState("error");
      }
    } catch {
      setLoadError("নেটওয়ার্ক সমস্যা — API-তে পৌঁছানো যায়নি।");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    // ?search= lands here from the command palette's customer links.
    const initial = new URLSearchParams(window.location.search).get("search") ?? "";
    setSearch(initial);
    void load(initial);
  }, [load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter(
      (c) => c.name.toLowerCase().includes(needle) || c.tags.some((t) => t.toLowerCase().includes(needle)),
    );
  }, [customers, search]);

  const selected = visible.find((c) => c.id === selectedId) ?? visible[0];

  return (
    <main>
      <PageHeader
        title="গ্রাহক / CRM"
        description={`আসল ডেটা — ডাটাবেস থেকে মোট ${total} জন গ্রাহক। ফোন নম্বর ডিফল্টভাবে মাস্ক করা থাকে।`}
        actions={
          <Button variant="outline" onClick={() => void load(search)}>
            রিফ্রেশ
          </Button>
        }
      />

      <Card className="mb-4 shadow-card">
        <div className="relative max-w-md">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="নাম বা ট্যাগ দিয়ে খুঁজুন…"
            aria-label="গ্রাহক খুঁজুন"
            className="h-11 w-full rounded-md border border-border bg-card pl-9 pr-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
        </div>
      </Card>

      {loadState === "loading" && (
        <div role="status" aria-label="গ্রাহক লোড হচ্ছে" className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
          <div className="border-b border-border bg-surface-2 px-4 py-3">
            <div className="h-4 w-40 animate-pulse rounded bg-border" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0">
              <div className="h-4 w-32 animate-pulse rounded bg-border" />
              <div className="h-4 w-24 animate-pulse rounded bg-border" />
              <div className="ml-auto h-4 w-16 animate-pulse rounded bg-border" />
            </div>
          ))}
          <p className="px-4 py-3 text-small text-text-muted">গ্রাহক লোড হচ্ছে…</p>
        </div>
      )}

      {loadState === "error" && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-5 shadow-card">
          <p className="font-semibold text-rose-700">গ্রাহক লোড হয়নি</p>
          <p className="mt-1 text-small text-rose-600">{loadError}</p>
          <Button variant="outline" className="mt-4 bg-card" onClick={() => void load(search)}>
            আবার চেষ্টা করুন
          </Button>
        </div>
      )}

      {loadState === "ready" && visible.length === 0 && (
        <div role="status" className="rounded-lg border border-border bg-card px-6 py-14 text-center shadow-card">
          <span aria-hidden="true" className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-50 text-brand-500">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </span>
          <h2 className="mt-4 text-h3">কোনো গ্রাহক পাওয়া যায়নি</h2>
          <p className="mx-auto mt-1 max-w-md text-small leading-relaxed text-text-muted">
            ডাটাবেসে এখনো কোনো গ্রাহক নেই, অথবা খোঁজের সঙ্গে মেলেনি।
          </p>
          {search.trim() !== "" && (
            <Button variant="outline" className="mt-5" onClick={() => setSearch("")}>
              খোঁজ মুছে ফেলুন
            </Button>
          )}
        </div>
      )}

      {loadState === "ready" && visible.length > 0 && (
        <>
        {/* Desktop table — hidden under md (card list below takes over,
         *  so a 360px screen never scrolls sideways). */}
        <div className="hidden overflow-x-auto rounded-lg border border-border bg-card shadow-card md:block">
          <table className="w-full min-w-[760px] border-collapse text-left text-sm">
            <thead>
              <tr className="bg-surface-2 text-left [&>th]:border-b [&>th]:border-border">
                {["নাম", "ফোন (মাস্ক করা)", "অর্ডার", "সাফল্যের হার", "মোট কেনাকাটা (LTV)", "গড় অর্ডার (AOV)", "ট্যাগ"].map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 text-caption font-semibold text-text-muted">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const isSelected = selected?.id === c.id;
                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    aria-selected={isSelected}
                    className={`cursor-pointer border-t border-border transition motion-fast first:border-t-0 hover:bg-surface-2/70 ${isSelected ? "bg-brand-50/70" : ""}`}
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium leading-snug">{c.name}</span>
                      {c.blocked ? <span className="ml-2 inline-flex"><Badge tone="danger">ব্লক করা</Badge></span> : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-small tabular-nums text-text-muted">{displayPhone(c.phone, false)}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">{c.totalOrders}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">{customerSuccessRate(c)}%</td>
                    <td className="px-4 py-3 font-mono font-semibold tabular-nums">{formatBdt(c.lifetimeValuePoisha)}</td>
                    <td className="px-4 py-3 font-mono tabular-nums">{formatBdt(customerAovPoisha(c))}</td>
                    <td className="px-4 py-3">
                      {c.tags.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {c.tags.map((t) => <Badge key={t} tone="brand">{t}</Badge>)}
                        </span>
                      ) : (
                        <span className="text-text-subtle">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile card list (under md) — tap selects the customer, same
         *  as tapping a table row on desktop. */}
        <div className="space-y-3 md:hidden">
          {visible.map((c) => {
            const isSelected = selected?.id === c.id;
            return (
              <article
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                aria-selected={isSelected}
                className={`cursor-pointer rounded-lg border border-border bg-card p-4 shadow-card transition motion-fast ${isSelected ? "bg-brand-50/70 ring-1 ring-brand-300" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate font-medium leading-snug">{c.name}</p>
                  <span className="flex shrink-0 items-center gap-1.5">
                    {c.blocked ? <Badge tone="danger">ব্লক করা</Badge> : null}
                    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 text-text-subtle">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </span>
                </div>
                <p className="mt-1 font-mono text-small tabular-nums text-text-muted">{displayPhone(c.phone, false)}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
                  <span>
                    <span className="block text-caption text-text-subtle">অর্ডার</span>
                    <span className="font-mono font-semibold tabular-nums">{c.totalOrders}</span>
                  </span>
                  <span>
                    <span className="block text-caption text-text-subtle">সাফল্যের হার</span>
                    <span className="font-mono font-semibold tabular-nums">{customerSuccessRate(c)}%</span>
                  </span>
                  <span>
                    <span className="block text-caption text-text-subtle">মোট কেনাকাটা</span>
                    <span className="font-mono font-semibold tabular-nums">{formatBdt(c.lifetimeValuePoisha)}</span>
                  </span>
                </div>
                {c.tags.length > 0 ? (
                  <p className="mt-3 flex flex-wrap gap-1">
                    {c.tags.map((t) => <Badge key={t} tone="brand">{t}</Badge>)}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
        </>
      )}

      {loadState === "ready" && selected && (
        <Card className="mt-5 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-h3">{selected.name} — প্রোফাইল</h2>
              <p className="mt-1 text-small text-text-muted">
                ফোন: <span className="font-mono tabular-nums">{displayPhone(selected.phone, false)}</span>{" "}
                (পুরো নম্বর দেখতে পারমিশন + অডিট লগ লাগবে — সার্ভার-সাইডে)
              </p>
            </div>
            {selected.blocked ? <Badge tone="danger">ব্লক করা</Badge> : <Badge tone="success">সক্রিয়</Badge>}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "ডেলিভার্ড", value: String(selected.deliveredOrders) },
              { label: "বাতিল", value: String(selected.cancelledOrders) },
              { label: "রিটার্ন", value: String(selected.returnedOrders) },
              { label: "শেষ অর্ডার", value: selected.lastOrderAt ?? "—" },
            ].map((s) => (
              <div key={s.label} className="rounded-md bg-surface-2 px-3.5 py-3">
                <p className="text-caption font-medium text-text-muted">{s.label}</p>
                <p className="mt-0.5 truncate font-mono text-h3 font-bold tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>

          <div className="mt-5 border-t border-border pt-4">
            <p className="flex flex-wrap items-center gap-1.5 text-small">
              <span className="mr-1 font-medium text-text-muted">ট্যাব (এখনো ওয়্যার করা হয়নি):</span>
              {PROFILE_TABS.map((t) => (
                <span key={t} className="rounded-full border border-dashed border-border px-2.5 py-1 text-caption font-medium text-text-muted">{t}</span>
              ))}
            </p>
            <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-small">
              <span className="mr-1 font-medium text-text-muted">কুইক অ্যাকশন (এখনো ওয়্যার করা হয়নি):</span>
              {QUICK_ACTIONS.map((a) => (
                <span key={a} className="rounded-full border border-dashed border-border px-2.5 py-1 text-caption font-medium text-text-muted">{a}</span>
              ))}
            </p>
          </div>
        </Card>
      )}
    </main>
  );
}
