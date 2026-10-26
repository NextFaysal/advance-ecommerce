"use client";

/**
 * B2B group pricing card — /admin/b2b (ADV-14 remainder).
 *
 * Self-fetching editor for the `b2b.groups` Setting doc via
 *   GET /api/v1/admin/b2b/groups -> { groups, customers, variants }
 *   PUT /api/v1/admin/b2b/groups -> { groups, reason }
 * One save replaces the whole doc; the API validates shape AND live
 * references (customer ids, variant ids) and rejects the whole write
 * with every problem listed — nothing is partially applied. A reason
 * is required and the change is audited (settings.update).
 *
 * Pricing rule the card explains to the admin: a variant's buyer
 * price is the group OVERRIDE when one is set, else catalogue −
 * group discount %, else catalogue. Prices snapshot into a quotation
 * when the buyer submits an RFQ/bulk order — editing this doc never
 * re-prices an existing quotation.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatPoisha } from "@/components/ui/money";

interface PriceGroup {
  id: string;
  name: string;
  discountBps: number;
}

interface GroupsDoc {
  groups: PriceGroup[];
  assignments: Record<string, string>;
  overrides: Record<string, Record<string, number>>;
}

interface CustomerOption {
  id: string;
  businessName: string;
  contactName: string;
  approvalStatus: string;
}

interface VariantOption {
  variantId: string;
  sku: string;
  productNameBn: string;
  productNameEn: string;
  productStatus: string;
  isActive: boolean;
  cataloguePricePoisha: number;
  stock: number;
}

interface GroupsResponse {
  data?: {
    groups: GroupsDoc;
    customers?: CustomerOption[];
    variants?: VariantOption[];
  };
  error?: { code?: string; message?: string; details?: unknown };
}

const EMPTY_DOC: GroupsDoc = { groups: [], assignments: {}, overrides: {} };
const inputCls =
  "h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-text-main outline-none focus:border-brand-500";
const selectCls = inputCls;

function percentLabel(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

export function B2bGroupsCard() {
  const [doc, setDoc] = useState<GroupsDoc>(EMPTY_DOC);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [variants, setVariants] = useState<VariantOption[]>([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [newOverrideGroup, setNewOverrideGroup] = useState("");
  const [newOverrideVariant, setNewOverrideVariant] = useState("");
  const [newOverridePrice, setNewOverridePrice] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/admin/b2b/groups");
        const body = (await res.json().catch(() => ({}))) as GroupsResponse;
        if (cancelled) return;
        if (!res.ok || !body.data) {
          setError(body.error?.message ?? "গ্রুপ প্রাইসিং লোড করা যায়নি — আবার চেষ্টা করুন।");
          return;
        }
        setDoc(body.data.groups);
        setCustomers(body.data.customers ?? []);
        setVariants(body.data.variants ?? []);
      } catch {
        if (!cancelled) setError("সার্ভারে পৌঁছানো যাচ্ছে না — নেটওয়ার্ক দেখে আবার চেষ্টা করুন।");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const variantById = new Map(variants.map((v) => [v.variantId, v]));
  const groupName = (id: string) => doc.groups.find((g) => g.id === id)?.name ?? id;

  function addGroup() {
    const id = `grp_${Date.now().toString(36)}_${doc.groups.length + 1}`;
    setDoc((d) => ({
      ...d,
      groups: [...d.groups, { id, name: "নতুন গ্রুপ", discountBps: 0 }],
    }));
  }

  function updateGroup(id: string, patch: Partial<PriceGroup>) {
    setDoc((d) => ({
      ...d,
      groups: d.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    }));
  }

  function removeGroup(id: string) {
    setDoc((d) => {
      const assignments = Object.fromEntries(
        Object.entries(d.assignments).filter(([, groupId]) => groupId !== id),
      );
      const overrides = { ...d.overrides };
      delete overrides[id];
      return { groups: d.groups.filter((g) => g.id !== id), assignments, overrides };
    });
  }

  function setAssignment(customerId: string, groupId: string) {
    setDoc((d) => {
      const assignments = { ...d.assignments };
      if (groupId === "") delete assignments[customerId];
      else assignments[customerId] = groupId;
      return { ...d, assignments };
    });
  }

  function setOverride(groupId: string, variantId: string, pricePoisha: number) {
    setDoc((d) => ({
      ...d,
      overrides: {
        ...d.overrides,
        [groupId]: { ...(d.overrides[groupId] ?? {}), [variantId]: pricePoisha },
      },
    }));
  }

  function removeOverride(groupId: string, variantId: string) {
    setDoc((d) => {
      const groupOverrides = { ...(d.overrides[groupId] ?? {}) };
      delete groupOverrides[variantId];
      const overrides = { ...d.overrides };
      if (Object.keys(groupOverrides).length === 0) delete overrides[groupId];
      else overrides[groupId] = groupOverrides;
      return { ...d, overrides };
    });
  }

  function addOverride() {
    if (newOverrideGroup === "" || newOverrideVariant === "") return;
    const price = Number(newOverridePrice);
    if (!Number.isInteger(price) || price < 0) {
      setError("ওভাররাইড মূল্য অবশ্যই ০ বা তার বেশি পূর্ণসংখ্যা (পয়সা) হতে হবে।");
      return;
    }
    setError(null);
    setOverride(newOverrideGroup, newOverrideVariant, price);
    setNewOverridePrice("");
  }

  async function save() {
    setBusy(true);
    setError(null);
    setErrorDetails([]);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/admin/b2b/groups", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groups: doc, reason: reason.trim() }),
      });
      const body = (await res.json().catch(() => ({}))) as GroupsResponse;
      if (!res.ok || !body.data) {
        setError(body.error?.message ?? "গ্রুপ প্রাইসিং সংরক্ষণ করা যায়নি — আবার চেষ্টা করুন।");
        if (Array.isArray(body.error?.details)) {
          setErrorDetails(body.error.details.filter((x): x is string => typeof x === "string"));
        }
        return;
      }
      setDoc(body.data.groups);
      setReason("");
      setMessage("গ্রুপ প্রাইসিং সংরক্ষিত হয়েছে — পোর্টালের মূল্য ও নতুন RFQ-তে এখন থেকে এটাই প্রযোজ্য।");
    } catch {
      setError("সার্ভারে পৌঁছানো যাচ্ছে না — নেটওয়ার্ক দেখে আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="text-base font-semibold text-text-main">গ্রুপ প্রাইসিং (Group pricing)</h3>
      <p className="mt-1 text-sm leading-6 text-text-muted">
        প্রতিটি B2B গ্রাহক সর্বোচ্চ একটি গ্রুপে থাকেন। ক্রেতার মূল্য: গ্রুপের{" "}
        <strong>ওভাররাইড</strong> থাকলে সেটাই, না থাকলে ক্যাটালগ মূল্য − গ্রুপ ছাড়, গ্রুপ না থাকলে
        ক্যাটালগ মূল্য। মূল্য RFQ/বাল্ক জমার সময় কোটেশনে স্ন্যাপশট হয় — এই ডক বদলালে পুরনো
        কোটেশনের মূল্য বদলায় না। স্টাফ-তৈরি কোটেশনে গ্রুপ প্রাইসিং প্রযোজ্য নয়।
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-text-muted">লোড হচ্ছে…</p>
      ) : (
        <div className="mt-4 space-y-6">
          <section>
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-text-main">গ্রুপসমূহ</h4>
              <Button onClick={addGroup} disabled={busy}>
                + নতুন গ্রুপ
              </Button>
            </div>
            {doc.groups.length === 0 ? (
              <p className="mt-2 text-sm text-text-muted">এখনো কোনো গ্রুপ নেই — সব ক্রেতা ক্যাটালগ মূল্যে কিনছেন।</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {doc.groups.map((group) => (
                  <li
                    key={group.id}
                    className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_160px_auto] sm:items-end"
                  >
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-text-muted">
                        গ্রুপের নাম <span className="font-mono">({group.id})</span>
                      </span>
                      <input
                        className={inputCls}
                        value={group.name}
                        onChange={(e) => updateGroup(group.id, { name: e.target.value })}
                        disabled={busy}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-text-muted">
                        ছাড় (bps — {percentLabel(group.discountBps)})
                      </span>
                      <input
                        className={inputCls}
                        type="number"
                        min={0}
                        max={10000}
                        step={1}
                        value={group.discountBps}
                        onChange={(e) =>
                          updateGroup(group.id, {
                            discountBps: Math.max(0, Math.min(10000, Math.trunc(Number(e.target.value) || 0))),
                          })
                        }
                        disabled={busy}
                      />
                    </label>
                    <Button onClick={() => removeGroup(group.id)} disabled={busy}>
                      মুছুন
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-text-muted">bps = শতাংশের ১/১০০ অংশ: 500 bps = 5% ছাড়।</p>
          </section>

          <section>
            <h4 className="text-sm font-semibold text-text-main">গ্রাহক → গ্রুপ অ্যাসাইনমেন্ট</h4>
            {customers.length === 0 ? (
              <p className="mt-2 text-sm text-text-muted">কোনো B2B গ্রাহক নেই।</p>
            ) : (
              <ul className="mt-2 max-h-64 space-y-2 overflow-auto pr-1">
                {customers.map((customer) => (
                  <li
                    key={customer.id}
                    className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-[1fr_220px] sm:items-center"
                  >
                    <span className="text-sm text-text-main">
                      <span className="font-medium">{customer.businessName}</span>{" "}
                      <span className="text-text-muted">
                        ({customer.contactName} · {customer.approvalStatus})
                      </span>
                    </span>
                    <select
                      className={selectCls}
                      value={doc.assignments[customer.id] ?? ""}
                      onChange={(e) => setAssignment(customer.id, e.target.value)}
                      disabled={busy}
                      aria-label={`${customer.businessName}-এর গ্রুপ`}
                    >
                      <option value="">কোনো গ্রুপ নয় (ক্যাটালগ মূল্য)</option>
                      {doc.groups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name} — {percentLabel(group.discountBps)} ছাড়
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h4 className="text-sm font-semibold text-text-main">ভ্যারিয়েন্ট মূল্য ওভাররাইড</h4>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1.4fr_150px_auto] sm:items-end">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">গ্রুপ</span>
                <select
                  className={selectCls}
                  value={newOverrideGroup}
                  onChange={(e) => setNewOverrideGroup(e.target.value)}
                  disabled={busy}
                >
                  <option value="">গ্রুপ বেছে নিন…</option>
                  {doc.groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">ভ্যারিয়েন্ট (SKU)</span>
                <select
                  className={selectCls}
                  value={newOverrideVariant}
                  onChange={(e) => {
                    setNewOverrideVariant(e.target.value);
                    const variant = variantById.get(e.target.value);
                    if (variant) setNewOverridePrice(String(variant.cataloguePricePoisha));
                  }}
                  disabled={busy}
                >
                  <option value="">ভ্যারিয়েন্ট বেছে নিন…</option>
                  {variants.map((variant) => (
                    <option key={variant.variantId} value={variant.variantId}>
                      {variant.sku} — {variant.productNameBn} ({formatPoisha(variant.cataloguePricePoisha)})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">ওভাররাইড মূল্য (পয়সা)</span>
                <input
                  className={inputCls}
                  type="number"
                  min={0}
                  step={1}
                  value={newOverridePrice}
                  onChange={(e) => setNewOverridePrice(e.target.value)}
                  disabled={busy}
                />
              </label>
              <Button
                onClick={addOverride}
                disabled={busy || newOverrideGroup === "" || newOverrideVariant === ""}
              >
                যোগ করুন
              </Button>
            </div>

            {Object.keys(doc.overrides).length === 0 ? (
              <p className="mt-2 text-sm text-text-muted">কোনো ওভাররাইড নেই — সব ভ্যারিয়েন্টে গ্রুপ ছাড়ই প্রযোজ্য।</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {Object.entries(doc.overrides).map(([groupId, byVariant]) => (
                  <li key={groupId} className="rounded-lg border border-border p-3">
                    <p className="text-sm font-semibold text-text-main">{groupName(groupId)}</p>
                    <ul className="mt-2 space-y-2">
                      {Object.entries(byVariant).map(([variantId, price]) => {
                        const variant = variantById.get(variantId);
                        return (
                          <li
                            key={variantId}
                            className="grid gap-2 sm:grid-cols-[1fr_150px_auto] sm:items-center"
                          >
                            <span className="text-sm text-text-main">
                              <span className="font-mono">{variant?.sku ?? variantId}</span>{" "}
                              <span className="text-text-muted">
                                {variant
                                  ? `${variant.productNameBn} · ক্যাটালগ ${formatPoisha(variant.cataloguePricePoisha)}`
                                  : "(ভ্যারিয়েন্ট পাওয়া যায়নি — সংরক্ষণে যাচাই ব্যর্থ হবে)"}
                              </span>
                            </span>
                            <input
                              className={inputCls}
                              type="number"
                              min={0}
                              step={1}
                              value={price}
                              aria-label={`${variant?.sku ?? variantId}-এর ওভাররাইড মূল্য (পয়সা)`}
                              onChange={(e) =>
                                setOverride(groupId, variantId, Math.max(0, Math.trunc(Number(e.target.value) || 0)))
                              }
                              disabled={busy}
                            />
                            <Button onClick={() => removeOverride(groupId, variantId)} disabled={busy}>
                              সরান
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Input
            id="b2b-groups-reason"
            name="b2b-groups-reason"
            label="পরিবর্তনের কারণ"
            helper="মূল্য পরিবর্তনের কারণ অডিট লগে রাখা বাধ্যতামূলক।"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="যেমন: ডিলার গ্রুপের ছাড় ৫% থেকে ৭% করা হলো"
            required
            disabled={busy}
          />

          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <p>{error}</p>
              {errorDetails.length > 0 ? (
                <ul className="mt-1 list-disc pl-5">
                  {errorDetails.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {message ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {message}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button onClick={save} disabled={busy || reason.trim() === ""}>
              {busy ? "সংরক্ষণ হচ্ছে…" : "গ্রুপ প্রাইসিং সংরক্ষণ করুন"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
