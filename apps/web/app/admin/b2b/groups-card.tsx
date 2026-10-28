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
import { EmptyState } from "@/components/ui/empty-state";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { B2B_STRINGS } from "./strings";

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
  "tnum h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm text-text-main outline-none focus:border-brand-500";
const selectCls = inputCls;

function percentLabel(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2)}%`;
}

export function B2bGroupsCard() {
  const { locale } = useLocale();
  const s = pick(locale, B2B_STRINGS);
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
          setError(body.error?.message ?? s.loadFailed);
          return;
        }
        setDoc(body.data.groups);
        setCustomers(body.data.customers ?? []);
        setVariants(body.data.variants ?? []);
      } catch {
        if (!cancelled) setError(s.serverUnreachable);
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
      groups: [...d.groups, { id, name: s.newGroupName, discountBps: 0 }],
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
      setError(s.overrideInvalid);
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
        setError(body.error?.message ?? s.saveFailed);
        if (Array.isArray(body.error?.details)) {
          setErrorDetails(body.error.details.filter((x): x is string => typeof x === "string"));
        }
        return;
      }
      setDoc(body.data.groups);
      setReason("");
      setMessage(s.savedMsg);
    } catch {
      setError(s.serverUnreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="font-display text-base font-semibold text-text-main">{s.groupsTitle}</h3>
      <p className="mt-1 text-sm leading-6 text-text-muted">
        {s.groupsDesc}
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-text-muted">{s.loading}</p>
      ) : (
        <div className="mt-4 space-y-6">
          <section>
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-display text-sm font-semibold text-text-main">{s.groupsHeading}</h4>
              <Button onClick={addGroup} disabled={busy}>
                {s.addGroup}
              </Button>
            </div>
            {doc.groups.length === 0 ? (
              <div className="mt-2"><EmptyState title={s.groupsEmptyTitle} description={s.groupsEmptyDesc} /></div>
            ) : (
              <ul className="mt-2 space-y-2">
                {doc.groups.map((group) => (
                  <li
                    key={group.id}
                    className="grid gap-2 rounded-2xl border border-border/60 bg-surface-2 p-3 sm:grid-cols-[1fr_160px_auto] sm:items-end"
                  >
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-text-muted">
                        {s.groupNameLabel} <span className="font-mono">({group.id})</span>
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
                        {interpolate(s.discountLabel, { pct: percentLabel(group.discountBps) })}
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
                      {s.remove}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-text-muted">{s.bpsNote}</p>
          </section>

          <section>
            <h4 className="font-display text-sm font-semibold text-text-main">{s.assignmentsHeading}</h4>
            {customers.length === 0 ? (
              <div className="mt-2"><EmptyState title={s.assignEmptyTitle} description={s.assignEmptyDesc} /></div>
            ) : (
              <ul className="mt-2 max-h-64 space-y-2 overflow-auto pr-1">
                {customers.map((customer) => (
                  <li
                    key={customer.id}
                    className="grid gap-2 rounded-2xl border border-border/60 bg-surface-2 p-3 sm:grid-cols-[1fr_220px] sm:items-center"
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
                      aria-label={interpolate(s.customerGroupAria, { name: customer.businessName })}
                    >
                      <option value="">{s.noGroupOption}</option>
                      {doc.groups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name} — {interpolate(s.discountSuffix, { pct: percentLabel(group.discountBps) })}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h4 className="font-display text-sm font-semibold text-text-main">{s.overridesHeading}</h4>
            <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1.4fr_150px_auto] sm:items-end">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">{s.groupLabel}</span>
                <select
                  className={selectCls}
                  value={newOverrideGroup}
                  onChange={(e) => setNewOverrideGroup(e.target.value)}
                  disabled={busy}
                >
                  <option value="">{s.chooseGroup}</option>
                  {doc.groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">{s.variantLabel}</span>
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
                  <option value="">{s.chooseVariant}</option>
                  {variants.map((variant) => (
                    <option key={variant.variantId} value={variant.variantId}>
                      {variant.sku} — {locale === "bn" ? variant.productNameBn : variant.productNameEn} ({formatPoisha(variant.cataloguePricePoisha)})
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-text-muted">{s.overridePriceLabel}</span>
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
                {s.addBtn}
              </Button>
            </div>

            {Object.keys(doc.overrides).length === 0 ? (
              <div className="mt-2"><EmptyState title={s.overridesEmptyTitle} description={s.overridesEmptyDesc} /></div>
            ) : (
              <ul className="mt-2 space-y-2">
                {Object.entries(doc.overrides).map(([groupId, byVariant]) => (
                  <li key={groupId} className="rounded-2xl border border-border/60 bg-surface-2 p-3">
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
                                  ? `${locale === "bn" ? variant.productNameBn : variant.productNameEn} · ${interpolate(s.catalogueSuffix, { price: formatPoisha(variant.cataloguePricePoisha) })}`
                                  : s.variantMissing}
                              </span>
                            </span>
                            <input
                              className={inputCls}
                              type="number"
                              min={0}
                              step={1}
                              value={price}
                              aria-label={interpolate(s.overrideAria, { sku: variant?.sku ?? variantId })}
                              onChange={(e) =>
                                setOverride(groupId, variantId, Math.max(0, Math.trunc(Number(e.target.value) || 0)))
                              }
                              disabled={busy}
                            />
                            <Button onClick={() => removeOverride(groupId, variantId)} disabled={busy}>
                              {s.removeBtn}
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
            label={s.reasonLabel}
            helper={s.reasonHelper}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={s.reasonPlaceholder}
            required
            disabled={busy}
          />

          {error ? (
            <div className="rounded-xl border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
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
            <p className="rounded-xl border border-success-solid/30 bg-success-soft px-3 py-2 text-sm text-success-solid">
              {message}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button onClick={save} disabled={busy || reason.trim() === ""}>
              {busy ? s.saving : s.saveBtn}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
