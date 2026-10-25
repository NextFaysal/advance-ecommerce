"use client";

/**
 * Landing quick-order form — plan 17 batch O2.
 *
 * The classic BD landing flow: the customer fills name + phone +
 * address right on the campaign page and the order is created in one
 * submit — no cart, no checkout detour. It posts DIRECTLY to the one
 * create funnel (POST /api/v1/public/orders) with paymentMethod "cod",
 * so fraud scoring, coupon/attribution plumbing, stock checks and
 * pricing are exactly the storefront's; the server never trusts the
 * prices shown here and recomputes everything.
 *
 * The ঢাকার ভিতরে/বাইরে toggle only supplies the shippingMethod hint —
 * the server's shipping engine derives the real zone from the address.
 * One idempotency UUID per attempt: after ANY server response the key
 * is rotated, because the orders route claims a key before its checks
 * run — retrying a failed attempt with the same key would 409.
 *
 * Validation reuses the checkout module's own schema
 * (checkoutFormSchema incl. bdAddressSchema + the BD phone rule) so
 * the form can never drift from the contract the API enforces.
 */
import { useId, useState } from "react";
import { formatBdt } from "@advance-ecommerce/validators";
import { checkoutFormSchema } from "@/checkout/validation";
import { newIdempotencyKey } from "@/checkout/idempotency";
import type { ResolvedOrderProduct } from "../render";

type Zone = "inside_dhaka" | "outside_dhaka";

type Phase =
  | { kind: "editing" }
  | { kind: "submitting" }
  | { kind: "success"; orderNo: string; totalPoisha: number }
  | { kind: "error"; message: string; details: string[] };

/** Bangla-first copy for the order API's known failure codes. */
const ERROR_BN: Record<string, string> = {
  VALIDATION_ERROR: "কিছু তথ্য ঠিকমতো দেওয়া হয়নি — ঘরগুলো আবার দেখে চেষ্টা করুন।",
  INSUFFICIENT_STOCK: "দুঃখিত, এই মুহূর্তে পর্যাপ্ত স্টক নেই। সংখ্যা কমিয়ে আবার চেষ্টা করুন।",
  VARIANT_NOT_FOUND: "দুঃখিত, এই পণ্যটি এখন পাওয়া যাচ্ছে না।",
  IDEMPOTENCY_CONFLICT: "এই অর্ডারটি ইতিমধ্যে গৃহীত হয়েছে। পেজটি রিফ্রেশ করে আবার চেষ্টা করুন।",
};

const inputCls =
  "min-h-12 w-full rounded-lg border border-border bg-card px-3 py-2 text-base text-text-main outline-none transition placeholder:text-text-muted/70 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";
const labelCls = "mb-1 block text-sm font-semibold text-text-main";

export function QuickOrderForm({ product }: { product: ResolvedOrderProduct }) {
  const uid = useId();
  const [variantId, setVariantId] = useState(product.defaultVariantId);
  const [quantity, setQuantity] = useState(1);
  const [customerName, setCustomerName] = useState("");
  const [phone, setPhone] = useState("");
  const [division, setDivision] = useState("");
  const [district, setDistrict] = useState("");
  const [upazila, setUpazila] = useState("");
  const [union, setUnion] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [zone, setZone] = useState<Zone>("outside_dhaka");
  const [idempotencyKey, setIdempotencyKey] = useState(() => newIdempotencyKey());
  const [phase, setPhase] = useState<Phase>({ kind: "editing" });

  const selected = product.variants.find((v) => v.variantId === variantId) ?? product.variants[0];
  const anyInStock = product.variants.some((v) => v.inStock);
  const maxQty = Math.max(1, selected?.stock ?? 1);
  const clampedQty = Math.min(Math.max(1, quantity), maxQty);
  const subtotalPoisha = (selected?.pricePoisha ?? 0) * clampedQty;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || phase.kind === "submitting") return;

    const candidate = {
      customerName: customerName.trim(),
      phone: phone.trim(),
      address: {
        division: division.trim(),
        district: district.trim(),
        upazila: upazila.trim(),
        ...(union.trim() ? { union: union.trim() } : {}),
        addressLine: addressLine.trim(),
      },
      shippingMethod: zone,
      paymentMethod: "cod" as const,
      items: [{ variantId: selected.variantId, quantity: clampedQty }],
      idempotencyKey,
    };
    const parsed = checkoutFormSchema.safeParse(candidate);
    if (!parsed.success) {
      setPhase({
        kind: "error",
        message: ERROR_BN.VALIDATION_ERROR,
        details: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
      return;
    }

    setPhase({ kind: "submitting" });
    try {
      const res = await fetch("/api/v1/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = (await res.json().catch(() => null)) as {
        data?: {
          order?: { orderNo?: string; totalPoisha?: number };
          pricing?: { grandTotalPoisha?: number } | null;
        };
        error?: { code?: string; message?: string; details?: unknown };
      } | null;
      // The key is consumed server-side either way — the next attempt
      // (if any) must be a fresh attempt with a fresh key.
      setIdempotencyKey(newIdempotencyKey());

      if (res.ok && body?.data?.order?.orderNo) {
        setPhase({
          kind: "success",
          orderNo: body.data.order.orderNo,
          totalPoisha: body.data.order.totalPoisha ?? body.data.pricing?.grandTotalPoisha ?? subtotalPoisha,
        });
        return;
      }
      const code = body?.error?.code ?? "";
      const serverMessage = body?.error?.message;
      const details = Array.isArray(body?.error?.details)
        ? (body.error.details as unknown[]).map((d) => String(d))
        : [];
      setPhase({
        kind: "error",
        // FRAUD_BLOCKED already carries the server's own generic
        // bilingual message; other codes get the Bangla-first copy.
        message:
          code === "FRAUD_BLOCKED" && serverMessage
            ? serverMessage
            : (ERROR_BN[code] ?? serverMessage ?? "কিছু সমস্যা হয়েছে — আবার চেষ্টা করুন।"),
        details: code === "VALIDATION_ERROR" ? details : [],
      });
    } catch {
      setIdempotencyKey(newIdempotencyKey());
      setPhase({ kind: "error", message: "নেটওয়ার্ক সমস্যা — আবার চেষ্টা করুন।", details: [] });
    }
  }

  if (phase.kind === "success") {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center" role="status">
        <p className="text-3xl" aria-hidden="true">✅</p>
        <h3 className="mt-2 text-xl font-bold text-emerald-900">অর্ডার সম্পন্ন হয়েছে!</h3>
        <p className="mt-2 leading-7 text-emerald-900">
          অর্ডার নম্বর: <span className="font-bold">{phase.orderNo}</span>
          <br />
          মোট: <span className="font-bold">{formatBdt(phase.totalPoisha)}</span> (ডেলিভারি চার্জসহ)
        </p>
        <p className="mt-2 text-sm leading-6 text-emerald-800">
          আমাদের টিম শীঘ্রই ফোন করে অর্ডারটি নিশ্চিত করবে। পণ্য হাতে পেয়ে যাচাই করে তারপর টাকা পরিশোধ করুন।
        </p>
        <a
          href={`/track?orderNo=${encodeURIComponent(phase.orderNo)}`}
          className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white transition hover:bg-emerald-700"
        >
          অর্ডার ট্র্যাক করুন
        </a>
      </div>
    );
  }

  const submitting = phase.kind === "submitting";

  return (
    <form onSubmit={handleSubmit} className="rounded-2xl border border-border bg-card p-5 shadow-sm" noValidate>
      <p className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-bold text-text-main">{product.productTitleBn}</span>
        <a href={`/product/${product.productSlug}`} className="text-sm text-brand-600 underline">
          বিস্তারিত দেখুন
        </a>
      </p>

      {product.variants.length > 1 ? (
        <fieldset className="mt-4">
          <legend className={labelCls}>ভেরিয়েন্ট বেছে নিন</legend>
          <div className="grid gap-2">
            {product.variants.map((v) => (
              <label
                key={v.variantId}
                className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 transition ${
                  v.variantId === selected?.variantId
                    ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600/40"
                    : "border-border hover:border-brand-400"
                } ${v.inStock ? "" : "cursor-not-allowed opacity-60"}`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`${uid}-variant`}
                    value={v.variantId}
                    checked={v.variantId === selected?.variantId}
                    disabled={!v.inStock}
                    onChange={() => {
                      setVariantId(v.variantId);
                      setQuantity(1);
                    }}
                    className="h-4 w-4 accent-brand-600"
                  />
                  <span className="font-medium text-text-main">{v.variantLabel}</span>
                </span>
                <span className="text-right">
                  <span className="font-bold text-brand-600">{formatBdt(v.pricePoisha)}</span>
                  {v.compareAtPoisha && v.compareAtPoisha > v.pricePoisha ? (
                    <span className="ml-1.5 text-sm text-text-muted line-through">{formatBdt(v.compareAtPoisha)}</span>
                  ) : null}
                  <span className="block text-xs text-text-muted">{v.inStock ? `স্টক আছে (${v.stock}টি)` : "স্টক শেষ"}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : selected ? (
        <p className="mt-3 flex flex-wrap items-baseline gap-2">
          <span className="text-2xl font-bold text-brand-600">{formatBdt(selected.pricePoisha)}</span>
          {selected.compareAtPoisha && selected.compareAtPoisha > selected.pricePoisha ? (
            <span className="text-text-muted line-through">{formatBdt(selected.compareAtPoisha)}</span>
          ) : null}
          <span className="text-sm text-text-muted">{selected.inStock ? `স্টক আছে (${selected.stock}টি)` : "স্টক শেষ"}</span>
        </p>
      ) : null}

      <div className="mt-4">
        <label className={labelCls} htmlFor={`${uid}-qty`}>পরিমাণ</label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="পরিমাণ কমান"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={!selected?.inStock}
            className="min-h-12 w-12 rounded-lg border border-border text-xl font-bold text-text-main transition hover:border-brand-400 disabled:opacity-50"
          >
            −
          </button>
          <input
            id={`${uid}-qty`}
            type="number"
            min={1}
            max={maxQty}
            value={clampedQty}
            onChange={(e) => setQuantity(Number(e.target.value) || 1)}
            disabled={!selected?.inStock}
            className={`${inputCls} text-center`}
          />
          <button
            type="button"
            aria-label="পরিমাণ বাড়ান"
            onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}
            disabled={!selected?.inStock}
            className="min-h-12 w-12 rounded-lg border border-border text-xl font-bold text-text-main transition hover:border-brand-400 disabled:opacity-50"
          >
            +
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <div>
          <label className={labelCls} htmlFor={`${uid}-name`}>আপনার নাম *</label>
          <input id={`${uid}-name`} className={inputCls} value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="যেমন: মোঃ রফিকুল ইসলাম" autoComplete="name" />
        </div>
        <div>
          <label className={labelCls} htmlFor={`${uid}-phone`}>মোবাইল নম্বর *</label>
          <input id={`${uid}-phone`} className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="01XXXXXXXXX" inputMode="tel" autoComplete="tel" />
        </div>
        <div>
          <span className={labelCls}>ডেলিভারি এলাকা *</span>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="ডেলিভারি এলাকা">
            {(
              [
                { value: "inside_dhaka", label: "ঢাকার ভিতরে" },
                { value: "outside_dhaka", label: "ঢাকার বাইরে" },
              ] as { value: Zone; label: string }[]
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={zone === opt.value}
                onClick={() => setZone(opt.value)}
                className={`min-h-12 rounded-lg border px-3 py-2 font-semibold transition ${
                  zone === opt.value
                    ? "border-brand-600 bg-brand-50 text-brand-700 ring-1 ring-brand-600/40"
                    : "border-border text-text-main hover:border-brand-400"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls} htmlFor={`${uid}-division`}>বিভাগ *</label>
            <input id={`${uid}-division`} className={inputCls} value={division} onChange={(e) => setDivision(e.target.value)} placeholder="ঢাকা" autoComplete="address-level1" />
          </div>
          <div>
            <label className={labelCls} htmlFor={`${uid}-district`}>জেলা *</label>
            <input id={`${uid}-district`} className={inputCls} value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="ঢাকা" autoComplete="address-level2" />
          </div>
          <div>
            <label className={labelCls} htmlFor={`${uid}-upazila`}>উপজেলা / থানা *</label>
            <input id={`${uid}-upazila`} className={inputCls} value={upazila} onChange={(e) => setUpazila(e.target.value)} placeholder="মিরপুর" />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor={`${uid}-union`}>ইউনিয়ন (যদি থাকে)</label>
          <input id={`${uid}-union`} className={inputCls} value={union} onChange={(e) => setUnion(e.target.value)} placeholder="ঐচ্ছিক" />
        </div>
        <div>
          <label className={labelCls} htmlFor={`${uid}-address`}>সম্পূর্ণ ঠিকানা *</label>
          <textarea id={`${uid}-address`} className={`${inputCls} min-h-20`} value={addressLine} onChange={(e) => setAddressLine(e.target.value)} placeholder="বাসা/হোল্ডিং, রোড, এলাকা — যেমন: বাসা ১২, রোড ৫, মিরপুর ১০" autoComplete="street-address" />
        </div>
      </div>

      {phase.kind === "error" ? (
        <div className="mt-4 rounded-xl bg-red-50 p-3.5 text-sm leading-6 text-red-800" role="alert">
          <p className="font-semibold">{phase.message}</p>
          {phase.details.length > 0 ? (
            <ul className="mt-1 list-inside list-disc">
              {phase.details.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-4">
        <span className="text-sm text-text-muted">পণ্যের মূল্য</span>
        <span className="text-xl font-bold text-text-main">{formatBdt(subtotalPoisha)}</span>
      </div>
      <p className="mt-1 text-xs leading-5 text-text-muted">
        ডেলিভারি চার্জ ঠিকানা অনুযায়ী অর্ডারের মোটে যোগ হবে। পেমেন্ট: ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা দিন।
      </p>

      <button
        type="submit"
        disabled={submitting || !selected?.inStock}
        className="brand-gradient mt-4 min-h-12 w-full rounded-xl px-4 py-3.5 text-lg font-bold text-white shadow-lift transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {!anyInStock || !selected?.inStock ? "স্টক শেষ" : submitting ? "অর্ডার করা হচ্ছে…" : "অর্ডার করুন — ক্যাশ অন ডেলিভারি"}
      </button>
    </form>
  );
}
