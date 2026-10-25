"use client";

// Manual order builder v2 (doc 17 batch O2) — replaces the one-item,
// raw-variant-ID form. Staff flow: type the caller's phone (existing
// customer + recent orders surface from the customers API and prefill
// name/address), search products by name/SKU and add variants from a
// picker (catalogue price + stock shown, price editable in TAKA —
// negotiated phone prices stay a feature), pick a delivery method
// (public-checkout rates, or a staff override), add an optional coupon
// code, and submit. The create POSTs to /api/v1/admin/orders without
// an `action` field — the same manual-create branch as before, which
// persists through the shared repository path with fraud scoring; the
// coupon is evaluated server-side by the same evaluator as public
// checkout and its outcome is shown from the response meta.
//
// Wave 27 (doc 17 batch O9-2): the builder also carries the checkout
// delivery-slot + gift fields, and a half-built form can be parked
// with "ড্রাফট হিসেবে রাখুন" (POST /api/v1/admin/orders/drafts) and
// resumed later from the drafts strip (?draft=<id>). Submitting a
// resumed draft converts THAT draft (payload refreshed from the form
// first) instead of creating an unrelated order.
//
// Money display: formatBdt (poisha -> ৳). Live totals are an ESTIMATE
// (subtotal + shipping, before any coupon) and are labelled as such —
// the server total on the success message is the truth.
//
// OD3 (doc 19): the totals aside is now a LIVE SUMMARY RAIL — sticky
// on desktop, a summary card above the submit buttons on mobile —
// listing each line with its line total and the coupon state. The
// figures are the SAME client-side estimate as before (subtotal from
// the line prices as typed + manualShippingPoisha / staff override);
// the rail invents no new evaluator. A coupon's discount and any
// rule-based advance are computed only by the server, so the rail
// labels them as server-determined instead of showing a made-up
// number. Presentation only: payload builders below are unchanged.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Customer, Order } from "../../../src/orders/types";
import {
  manualOrderSchema,
  manualShippingPoisha,
  type ManualShippingMethod,
} from "../../../src/orders/manual-order";
import { formatBdt } from "../../../src/checkout/pricing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

const inputCls =
  "h-11 w-full rounded-md border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";
const labelCls = "mb-1.5 block text-small font-medium text-text-main";

const SHIPPING_OPTIONS: { value: ManualShippingMethod; label: string }[] = [
  { value: "inside_dhaka", label: "ঢাকার ভিতরে" },
  { value: "outside_dhaka", label: "ঢাকার বাইরে" },
  { value: "pickup", label: "পিকআপ (চার্জ নেই)" },
];

const PAYMENT_LABEL: Record<string, string> = {
  cod: "ক্যাশ অন ডেলিভারি",
  bkash: "বিকাশ",
  nagad: "নগদ",
};

interface VariantHit {
  id: string;
  sku: string;
  attributes: Record<string, string>;
  pricePoisha: number;
  stock: number;
  isActive: boolean;
}

interface ProductHit {
  id: string;
  status: string;
  titleBn: string;
  variants: VariantHit[];
}

interface Line {
  variantId: string;
  productTitleBn: string;
  variantLabel: string;
  sku: string;
  catalogPricePoisha: number;
  stock: number;
  quantity: number;
  /** Editable unit price as typed, in TAKA (converted at submit). */
  priceTaka: string;
}

interface RecentOrder {
  id: string;
  orderNo: string;
  status: string;
  totalPoisha: number;
  createdAt: string;
}

type LookupState = "idle" | "searching" | "found" | "notfound" | "unavailable";

/** "1850.5" style input string for a poisha amount (no trailing zeros). */
function poishaToTakaInput(poisha: number): string {
  return (poisha / 100).toFixed(2).replace(/\.?0+$/, "");
}

/** Taka as typed -> integer poisha, or null when not a valid amount. */
function takaToPoisha(raw: string): number | null {
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function variantLabel(attributes: Record<string, string>): string {
  const values = Object.values(attributes).filter((v) => v.trim() !== "");
  return values.length > 0 ? values.join(" / ") : "স্ট্যান্ডার্ড";
}

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function ManualOrderBuilder({ onCreated }: { onCreated: () => void | Promise<void> }) {
  // Customer + address
  const [phone, setPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [division, setDivision] = useState("");
  const [district, setDistrict] = useState("");
  const [upazila, setUpazila] = useState("");
  const [addressLine, setAddressLine] = useState("");
  // Phone lookup
  const [lookupState, setLookupState] = useState<LookupState>("idle");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [addressPrefilled, setAddressPrefilled] = useState(false);
  const lookupDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lookupSeq = useRef(0);
  // Latest address-field values for the lookup's prefill guard, read
  // via ref so the lookup callback (and its debounce effect) depends
  // on the phone only — never re-fires on address keystrokes.
  const addressRef = useRef({ division: "", district: "", upazila: "", addressLine: "" });
  useEffect(() => {
    addressRef.current = { division, district, upazila, addressLine };
  }, [division, district, upazila, addressLine]);
  // Items
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  // Money + fulfilment choices
  const [paymentMethod, setPaymentMethod] = useState<"cod" | "bkash" | "nagad">("cod");
  const [shippingMethod, setShippingMethod] = useState<ManualShippingMethod>("inside_dhaka");
  const [overrideOn, setOverrideOn] = useState(false);
  const [overrideTaka, setOverrideTaka] = useState("");
  const [couponCode, setCouponCode] = useState("");
  const [note, setNote] = useState("");
  const [resellerCode, setResellerCode] = useState("");
  // Delivery slot + gift (doc 17 batch O9-2): same options as the
  // storefront checkout, from GET /api/v1/public/delivery-slots.
  const [slots, setSlots] = useState<{ id: string; labelBn: string; labelEn: string }[]>([]);
  const [deliverySlotId, setDeliverySlotId] = useState("");
  const [giftOn, setGiftOn] = useState(false);
  const [giftMessage, setGiftMessage] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/public/delivery-slots")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("slots"))))
      .then((json: { data?: { slots?: { id: string; labelBn: string; labelEn: string }[] } }) => {
        if (!cancelled && Array.isArray(json.data?.slots)) setSlots(json.data.slots);
      })
      .catch(() => {
        // No slot picker for staff either; orders are unaffected.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // Draft orders (doc 17 batch O9-2): when this form was resumed from
  // a saved draft (?draft=<id>), draftId holds that draft — saving
  // updates it in place and submitting CONVERTS it (the stored
  // payload is first refreshed from the form, then converted, so the
  // conversion re-validates the CURRENT form, never a stale copy).
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftMsg, setDraftMsg] = useState<string | null>(null);
  // Submit
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  // One idempotency key per create attempt: kept across retries (a
  // double submit replays the stored order) and rotated after success.
  const idemRef = useRef<string | null>(null);

  /* ---------------- Phone lookup ---------------- */

  const runLookup = useCallback(async (rawPhone: string) => {
    const digits = rawPhone.replace(/\D/g, "");
    // Local 11-digit form (01XXXXXXXXX); the customers API searches the
    // stored +8801XXXXXXXXX column by substring, which contains it.
    const local = digits.startsWith("880") ? digits.slice(2) : digits;
    if (local.length < 11) {
      setLookupState("idle");
      setCustomer(null);
      setRecentOrders([]);
      return;
    }
    const seq = ++lookupSeq.current;
    setLookupState("searching");
    try {
      const res = await fetch(
        `/api/v1/admin/customers?search=${encodeURIComponent(local)}&pageSize=5`,
      );
      const body = (await res.json().catch(() => null)) as
        | { data?: Customer[]; error?: { code: string } }
        | null;
      if (seq !== lookupSeq.current) return;
      if (!res.ok || !body?.data) {
        // e.g. the staff role lacks customers.view — the form still works.
        setLookupState("unavailable");
        setCustomer(null);
        setRecentOrders([]);
        return;
      }
      const rows = body.data;
      const match =
        rows.find((c) => c.phone.replace(/\D/g, "").endsWith(local)) ??
        (rows.length === 1 ? rows[0] : undefined);
      if (!match) {
        setLookupState("notfound");
        setCustomer(null);
        setRecentOrders([]);
        return;
      }
      setCustomer(match);
      setLookupState("found");
      setCustomerName((prev) => (prev.trim() === "" ? match.name : prev));
      // Recent orders + last address come from the detail endpoint;
      // failure here only loses the extras, never the match itself.
      try {
        const detailRes = await fetch(`/api/v1/admin/customers/${match.id}`);
        const detail = (await detailRes.json().catch(() => null)) as
          | { data?: { orders?: Order[] } }
          | null;
        if (seq !== lookupSeq.current) return;
        const orders = detail?.data?.orders ?? [];
        setRecentOrders(
          orders.slice(0, 3).map((o) => ({
            id: o.id,
            orderNo: o.orderNo,
            status: o.status,
            totalPoisha: o.totalPoisha,
            createdAt: o.createdAt,
          })),
        );
        const last = orders[0];
        const current = addressRef.current;
        if (
          last &&
          current.division.trim() === "" &&
          current.district.trim() === "" &&
          current.upazila.trim() === "" &&
          current.addressLine.trim() === ""
        ) {
          setDivision(last.address.division);
          setDistrict(last.address.district);
          setUpazila(last.address.upazila);
          setAddressLine(last.address.addressLine);
          setAddressPrefilled(true);
        }
      } catch {
        setRecentOrders([]);
      }
    } catch {
      if (seq !== lookupSeq.current) return;
      setLookupState("unavailable");
      setCustomer(null);
      setRecentOrders([]);
    }
  }, []);

  useEffect(() => {
    if (lookupDebounce.current) clearTimeout(lookupDebounce.current);
    lookupDebounce.current = setTimeout(() => void runLookup(phone), 400);
    return () => {
      if (lookupDebounce.current) clearTimeout(lookupDebounce.current);
    };
  }, [phone, runLookup]);

  /* ---------------- Product search ---------------- */

  const runSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    try {
      const params = new URLSearchParams({ q: q.trim(), status: "ALL", page: "1", pageSize: "10" });
      const res = await fetch(`/api/v1/admin/products?${params.toString()}`);
      const body = (await res.json().catch(() => null)) as
        | {
            data?: Array<{
              id: string;
              status: string;
              title: { bn: string; en: string };
              variants: VariantHit[];
            }>;
          }
        | null;
      if (!res.ok) {
        setSearchFailed(true);
        setHits([]);
        return;
      }
      setSearchFailed(false);
      setHits(
        (body?.data ?? []).map((p) => ({
          id: p.id,
          status: p.status,
          titleBn: p.title.bn,
          variants: p.variants ?? [],
        })),
      );
    } catch {
      setSearchFailed(true);
      setHits([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => void runSearch(query), 250);
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, [query, runSearch]);

  function addLine(product: ProductHit, variant: VariantHit) {
    setResult(null);
    setLines((prev) => {
      const existing = prev.find((l) => l.variantId === variant.id);
      if (existing) {
        return prev.map((l) =>
          l.variantId === variant.id ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          variantId: variant.id,
          productTitleBn: product.titleBn,
          variantLabel: variantLabel(variant.attributes),
          sku: variant.sku,
          catalogPricePoisha: variant.pricePoisha,
          stock: variant.stock,
          quantity: 1,
          priceTaka: poishaToTakaInput(variant.pricePoisha),
        },
      ];
    });
  }

  function updateLine(variantId: string, patch: Partial<Line>) {
    setLines((prev) => prev.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l)));
  }

  function removeLine(variantId: string) {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId));
  }

  /* ---------------- Totals (estimate) ---------------- */

  const subtotalPoisha = lines.reduce((sum, l) => {
    const unit = takaToPoisha(l.priceTaka);
    return sum + (unit ?? 0) * l.quantity;
  }, 0);
  const shippingPoisha = overrideOn
    ? (takaToPoisha(overrideTaka) ?? 0)
    : manualShippingPoisha(shippingMethod);
  const estimatedTotalPoisha = subtotalPoisha + shippingPoisha;

  /* ---------------- Drafts (doc 17 batch O9-2) ---------------- */

  // Resume: /admin/orders?draft=<id> (the drafts strip links here)
  // loads the stored payload back into the form. The payload carries
  // ids + quantities + prices only, so a resumed line shows fallback
  // display data (stock -1 renders as "—") until it is re-picked —
  // the server re-validates everything at submit/convert anyway.
  useEffect(() => {
    const draftParam = new URLSearchParams(window.location.search).get("draft");
    if (!draftParam) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/admin/orders/drafts/${draftParam}`);
        const body = (await res.json().catch(() => null)) as {
          data?: {
            id: string;
            status: string;
            updatedAt: string;
            payload: Record<string, unknown>;
          };
        } | null;
        if (cancelled) return;
        const draft = body?.data;
        if (!res.ok || !draft) {
          setDraftMsg("ড্রাফটটি লোড করা যায়নি — তালিকা থেকে আবার চেষ্টা করুন।");
          return;
        }
        if (draft.status !== "OPEN") {
          setDraftMsg("এই ড্রাফটটি আর খোলা নেই (রূপান্তরিত বা বাতিল) — নতুন করে শুরু করুন।");
          return;
        }
        const p = draft.payload as {
          phone?: string;
          customerName?: string;
          address?: { division?: string; district?: string; upazila?: string; addressLine?: string };
          items?: { variantId: string; quantity: number; unitPricePoisha?: number }[];
          paymentMethod?: string;
          shippingMethod?: string;
          shippingOverridePoisha?: number;
          couponCode?: string;
          note?: string;
          resellerCode?: string;
          deliverySlotId?: string;
          giftMessage?: string;
        };
        if (typeof p.phone === "string") setPhone(p.phone);
        if (typeof p.customerName === "string") setCustomerName(p.customerName);
        if (p.address) {
          setDivision(p.address.division ?? "");
          setDistrict(p.address.district ?? "");
          setUpazila(p.address.upazila ?? "");
          setAddressLine(p.address.addressLine ?? "");
        }
        if (Array.isArray(p.items)) {
          setLines(
            p.items
              .filter((i) => i && typeof i.variantId === "string")
              .map((i) => {
                const price = typeof i.unitPricePoisha === "number" ? i.unitPricePoisha : 0;
                return {
                  variantId: i.variantId,
                  productTitleBn: "ড্রাফট থেকে নেওয়া পণ্য",
                  variantLabel: "",
                  sku: i.variantId,
                  catalogPricePoisha: price,
                  stock: -1,
                  quantity: typeof i.quantity === "number" && i.quantity > 0 ? Math.floor(i.quantity) : 1,
                  priceTaka: poishaToTakaInput(price),
                };
              }),
          );
        }
        if (p.paymentMethod === "cod" || p.paymentMethod === "bkash" || p.paymentMethod === "nagad") {
          setPaymentMethod(p.paymentMethod);
        }
        if (
          p.shippingMethod === "inside_dhaka" ||
          p.shippingMethod === "outside_dhaka" ||
          p.shippingMethod === "pickup"
        ) {
          setShippingMethod(p.shippingMethod);
        }
        if (typeof p.shippingOverridePoisha === "number") {
          setOverrideOn(true);
          setOverrideTaka(poishaToTakaInput(p.shippingOverridePoisha));
        }
        if (typeof p.couponCode === "string") setCouponCode(p.couponCode);
        if (typeof p.note === "string") setNote(p.note);
        if (typeof p.resellerCode === "string") setResellerCode(p.resellerCode);
        if (typeof p.deliverySlotId === "string") setDeliverySlotId(p.deliverySlotId);
        if (typeof p.giftMessage === "string") {
          setGiftOn(true);
          setGiftMessage(p.giftMessage);
        }
        setDraftId(draft.id);
        setDraftMsg(
          `ড্রাফট লোড হয়েছে — সাবমিট করলে এই ড্রাফটটি অর্ডারে রূপান্তরিত হবে; "ড্রাফট হিসেবে রাখুন" চাপলে সম্পাদিত অবস্থায় আবার সংরক্ষিত হবে।`,
        );
        document
          .getElementById("manual-order-builder-form")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {
        if (!cancelled) setDraftMsg("ড্রাফট লোড করা যায়নি — নেটওয়ার্ক সমস্যা হতে পারে।");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The form as a ManualCreateInput-shaped payload. Strict mode is
   * the submit path (a bad price aborts with null, exactly as before);
   * lenient mode is the draft-save path — a half-built form must save
   * as-is, so an unparseable price is stored as "no price yet" and an
   * empty cart is fine. Conversion re-validates strictly server-side.
   */
  function buildPayload(lenient: boolean): Record<string, unknown> | null {
    const items: { variantId: string; quantity: number; unitPricePoisha?: number }[] = [];
    for (const l of lines) {
      const unit = takaToPoisha(l.priceTaka);
      if (unit === null) {
        if (!lenient) return null;
        items.push({ variantId: l.variantId, quantity: l.quantity });
      } else {
        items.push({ variantId: l.variantId, quantity: l.quantity, unitPricePoisha: unit });
      }
    }
    const overridePoisha = overrideOn ? takaToPoisha(overrideTaka) : undefined;
    if (overrideOn && overridePoisha === null && !lenient) return null;
    return {
      phone,
      customerName,
      ...(customer?.id ? { customerId: customer.id } : {}),
      address: { division, district, upazila, addressLine },
      items,
      paymentMethod,
      shippingMethod,
      ...(overridePoisha !== undefined && overridePoisha !== null
        ? { shippingOverridePoisha: overridePoisha }
        : {}),
      ...(couponCode.trim() ? { couponCode: couponCode.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(resellerCode.trim() ? { resellerCode: resellerCode.trim() } : {}),
      ...(deliverySlotId ? { deliverySlotId } : {}),
      ...(giftOn ? { giftMessage } : {}),
    };
  }

  async function onSaveDraft() {
    setDraftMsg(null);
    const payload = buildPayload(true);
    if (!payload) return;
    setDraftBusy(true);
    try {
      const res = await fetch("/api/v1/admin/orders/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(draftId ? { id: draftId } : {}), payload }),
      });
      const body = (await res.json().catch(() => null)) as {
        data?: { id: string; totalPreviewPoisha: number | null };
        error?: { code: string; message: string };
      } | null;
      if (res.ok && body?.data) {
        setDraftId(body.data.id);
        setDraftMsg(
          `ড্রাফট সংরক্ষিত হয়েছে${body.data.totalPreviewPoisha !== null ? ` — আনুমানিক মোট ${formatBdt(body.data.totalPreviewPoisha)}` : ""}। উপরের ড্রাফট তালিকা থেকে পরে আবার খুলতে পারবেন।`,
        );
      } else {
        setDraftMsg(body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status} — ড্রাফট সংরক্ষণ হয়নি।`);
      }
    } catch {
      setDraftMsg("নেটওয়ার্ক সমস্যা — ড্রাফট সংরক্ষণ করা যায়নি।");
    } finally {
      setDraftBusy(false);
    }
  }

  /* ---------------- Submit ---------------- */

  /**
   * Submit for a RESUMED draft: refresh the stored payload from the
   * current form first (strict — a bad price aborts here with the
   * same message as the direct path), then convert. The conversion
   * re-validates everything server-side, so what converts is exactly
   * what is on screen, never the stale stored copy.
   */
  async function submitViaDraftConvert(activeDraftId: string) {
    for (const l of lines) {
      if (takaToPoisha(l.priceTaka) === null) {
        setResult({ ok: false, text: `"${l.productTitleBn}" — একক দাম সঠিক টাকায় লিখুন।` });
        return;
      }
    }
    if (overrideOn && takaToPoisha(overrideTaka) === null) {
      setResult({ ok: false, text: "ডেলিভারি চার্জের override সঠিক টাকায় লিখুন, অথবা override বন্ধ করুন।" });
      return;
    }
    const payload = buildPayload(false);
    if (!payload) return;
    setBusy(true);
    try {
      const saveRes = await fetch("/api/v1/admin/orders/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: activeDraftId, payload }),
      });
      if (!saveRes.ok) {
        const saveBody = (await saveRes.json().catch(() => null)) as {
          error?: { code: string; message: string };
        } | null;
        setResult({
          ok: false,
          text: saveBody?.error
            ? `${saveBody.error.code}: ${saveBody.error.message}`
            : `HTTP ${saveRes.status} — ড্রাফট হালনাগাদ হয়নি, অর্ডার তৈরি হয়নি।`,
        });
        return;
      }
      const res = await fetch(`/api/v1/admin/orders/drafts/${activeDraftId}/convert`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => null)) as {
        data?: {
          order?: Order | null;
          pricing?: { discountPoisha: number; shippingPoisha: number; totalPoisha: number } | null;
        };
        meta?: { convertedReplay?: boolean };
        error?: { code: string; message: string };
      } | null;
      if (res.ok && body?.data?.order) {
        const order = body.data.order;
        const parts = [
          body.meta?.convertedReplay
            ? `এই ড্রাফটটি আগেই অর্ডারে রূপান্তরিত হয়েছে: ${order.orderNo} — মোট ${formatBdt(order.totalPoisha)}।`
            : `ড্রাফট থেকে অর্ডার তৈরি হয়েছে: ${order.orderNo} — মোট ${formatBdt(order.totalPoisha)}।`,
        ];
        if (body.data.pricing) {
          parts.push(
            `ডেলিভারি চার্জ ${formatBdt(body.data.pricing.shippingPoisha)}` +
              (body.data.pricing.discountPoisha > 0
                ? `, কুপন ছাড় ${formatBdt(body.data.pricing.discountPoisha)}`
                : ""),
          );
        }
        parts.push("নিচের তালিকায় দেখুন।");
        setResult({ ok: true, text: parts.join(" ") });
        setDraftId(null);
        setDraftMsg(null);
        setLines([]);
        setCouponCode("");
        setNote("");
        await onCreated();
      } else {
        setResult({
          ok: false,
          text: body?.error
            ? `${body.error.code}: ${body.error.message}`
            : `HTTP ${res.status} — ড্রাফট থেকে অর্ডার তৈরি হয়নি।`,
        });
      }
    } catch {
      setResult({
        ok: false,
        text: "নেটওয়ার্ক সমস্যা — API-তে পৌঁছানো যায়নি। আবার চেষ্টা করুন; রূপান্তর idempotent, ডুপ্লিকেট অর্ডার হবে না।",
      });
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setResult(null);
    // A resumed draft submits THROUGH its conversion (see above).
    if (draftId) {
      await submitViaDraftConvert(draftId);
      return;
    }
    // Convert every line's taka price first so a bad price names its row.
    const items: { variantId: string; quantity: number; unitPricePoisha: number }[] = [];
    for (const l of lines) {
      const unit = takaToPoisha(l.priceTaka);
      if (unit === null) {
        setResult({ ok: false, text: `"${l.productTitleBn}" — একক দাম সঠিক টাকায় লিখুন।` });
        return;
      }
      items.push({ variantId: l.variantId, quantity: l.quantity, unitPricePoisha: unit });
    }
    const overridePoisha = overrideOn ? takaToPoisha(overrideTaka) : undefined;
    if (overrideOn && overridePoisha === null) {
      setResult({ ok: false, text: "ডেলিভারি চার্জের override সঠিক টাকায় লিখুন, অথবা override বন্ধ করুন।" });
      return;
    }
    const parsed = manualOrderSchema.safeParse({
      phone,
      customerName,
      customerId: customer?.id,
      address: { division, district, upazila, addressLine },
      items,
      paymentMethod,
      shippingMethod,
      shippingOverridePoisha: overridePoisha ?? undefined,
      couponCode: couponCode.trim() === "" ? undefined : couponCode.trim(),
      note: note.trim() === "" ? undefined : note.trim(),
      deliverySlotId: deliverySlotId === "" ? undefined : deliverySlotId,
      giftMessage: giftOn ? giftMessage : undefined,
    });
    if (!parsed.success) {
      setResult({
        ok: false,
        text: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" | "),
      });
      return;
    }
    if (!idemRef.current) idemRef.current = newIdempotencyKey();
    const reseller = resellerCode.trim();
    setBusy(true);
    try {
      const res = await fetch("/api/v1/admin/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...parsed.data,
          idempotencyKey: idemRef.current,
          ...(reseller ? { resellerCode: reseller } : {}),
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | {
            data?: { order?: Order | null };
            meta?: {
              idempotentReplay?: boolean;
              pricing?: { discountPoisha: number; shippingPoisha: number; totalPoisha: number };
              couponStatus?: string;
              couponReasonBn?: string | null;
            };
            error?: { code: string; message: string };
          }
        | null;
      if (res.ok && body?.data?.order) {
        const order = body.data.order;
        const parts = [
          body.meta?.idempotentReplay
            ? `এই অর্ডারটি আগেই তৈরি হয়েছে: ${order.orderNo} — মোট ${formatBdt(order.totalPoisha)}।`
            : `অর্ডার তৈরি হয়েছে: ${order.orderNo} — মোট ${formatBdt(order.totalPoisha)}।`,
        ];
        if (body.meta?.pricing) {
          parts.push(
            `ডেলিভারি চার্জ ${formatBdt(body.meta.pricing.shippingPoisha)}` +
              (body.meta.pricing.discountPoisha > 0
                ? `, কুপন ছাড় ${formatBdt(body.meta.pricing.discountPoisha)}`
                : ""),
          );
        }
        if (body.meta?.couponStatus === "rejected") {
          parts.push(`কুপন প্রয়োগ হয়নি: ${body.meta.couponReasonBn ?? "কুপনটি ব্যবহার করা যাচ্ছে না।"}`);
        }
        parts.push("নিচের তালিকায় দেখুন।");
        setResult({ ok: true, text: parts.join(" ") });
        idemRef.current = null;
        // Ready for the next call: keep caller + address, clear the cart.
        setLines([]);
        setCouponCode("");
        setNote("");
        await onCreated();
      } else {
        setResult({
          ok: false,
          text: body?.error
            ? `${body.error.code}: ${body.error.message}`
            : `HTTP ${res.status} — অর্ডার তৈরি হয়নি।`,
        });
      }
    } catch {
      setResult({
        ok: false,
        text: "নেটওয়ার্ক সমস্যা — API-তে পৌঁছানো যায়নি। আবার চেষ্টা করুন; একই চেষ্টায় ডুপ্লিকেট অর্ডার হবে না।",
      });
    } finally {
      setBusy(false);
    }
  }

  /* ---------------- Render ---------------- */

  return (
    <form id="manual-order-builder-form" onSubmit={onSubmit} className="mt-5 space-y-5">
      {/* Draft state banner (OD3): a resumed draft is visibly a draft
          until it converts — the submit/save behaviour is unchanged. */}
      {draftId && (
        <p role="status" className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-small font-medium text-amber-800">
          <Icon name="info" size={16} className="shrink-0" />
          আপনি একটি সংরক্ষিত ড্রাফট সম্পাদনা করছেন — সাবমিট করলে এই ড্রাফটটিই অর্ডারে রূপান্তরিত হবে।
        </p>
      )}

      {/* Customer + address */}
      <section aria-label="গ্রাহক ও ঠিকানা" className="rounded-lg border border-border bg-surface-2/50 p-4">
        <h3 className="text-small font-bold">১. গ্রাহক ও ঠিকানা</h3>
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelCls} htmlFor="mob-phone">ফোন</label>
            <input
              id="mob-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01XXXXXXXXX"
              required
              className={inputCls}
              inputMode="tel"
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="mob-name">গ্রাহকের নাম</label>
            <input
              id="mob-name"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="নাম"
              required
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls} htmlFor="mob-division">বিভাগ</label>
            <input id="mob-division" value={division} onChange={(e) => setDivision(e.target.value)} placeholder="বিভাগ" required className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="mob-district">জেলা</label>
            <input id="mob-district" value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="জেলা" required className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="mob-upazila">উপজেলা</label>
            <input id="mob-upazila" value={upazila} onChange={(e) => setUpazila(e.target.value)} placeholder="উপজেলা" required className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="mob-address">পুরো ঠিকানা</label>
            <input id="mob-address" value={addressLine} onChange={(e) => setAddressLine(e.target.value)} placeholder="বাসা/হোল্ডিং/এলাকা" required className={inputCls} />
          </div>
        </div>

        {/* Lookup outcome */}
        {lookupState === "searching" && (
          <p role="status" className="mt-3 text-small text-text-muted">গ্রাহক খোঁজা হচ্ছে…</p>
        )}
        {lookupState === "notfound" && (
          <p role="status" className="mt-3 text-small text-text-muted">এই নম্বরে আগের কোনো গ্রাহক পাওয়া যায়নি — নতুন গ্রাহক হিসেবে অর্ডার তৈরি হবে।</p>
        )}
        {lookupState === "unavailable" && (
          <p role="status" className="mt-3 text-small text-text-muted">গ্রাহক খোঁজা যাচ্ছে না (customers.view অনুমতি লাগতে পারে) — ফর্মটি হাতে পূরণ করে এগিয়ে যান।</p>
        )}
        {lookupState === "found" && customer && (
          <div className="mt-3 rounded-md border border-brand-200 bg-brand-50/70 px-3.5 py-3">
            {/* Customer card (OD3): who was picked, at a glance — the
                phone shown is the number as provided in the form, the
                address summary mirrors the current address fields. */}
            <div className="flex items-start gap-3">
              <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                <Icon name="user" size={20} />
              </span>
              <div className="min-w-0">
                <p className="text-small font-bold text-brand-800">আগের গ্রাহক: {customer.name}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-text-muted">
                  <span className="inline-flex items-center gap-1">
                    <Icon name="phone" size={12} />
                    <span className="font-mono tabular-nums">{phone}</span>
                  </span>
                  {[division, district, upazila, addressLine].filter((v) => v.trim() !== "").length > 0 && (
                    <span className="truncate">
                      {[division, district, upazila, addressLine].filter((v) => v.trim() !== "").join(", ")}
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Badge tone="info">মোট অর্ডার {customer.totalOrders}টি</Badge>
              <Badge tone="neutral">সর্বমোট কেনাকাটা {formatBdt(customer.lifetimeValuePoisha)}</Badge>
              {customer.blocked && <Badge tone="danger">ব্লক করা</Badge>}
              {addressPrefilled && <Badge tone="success">সর্বশেষ অর্ডারের ঠিকানা বসানো হয়েছে</Badge>}
            </div>
            {recentOrders.length > 0 && (
              <ul className="mt-2 space-y-1 text-small text-text-muted">
                {recentOrders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center gap-x-2">
                    <a href={`/admin/orders/${o.id}`} className="font-mono font-semibold text-brand-700 hover:underline">
                      {o.orderNo}
                    </a>
                    <span>{o.status}</span>
                    <span className="font-mono tabular-nums">{formatBdt(o.totalPoisha)}</span>
                    <span>{new Date(o.createdAt).toLocaleDateString("bn-BD")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Items */}
      <section aria-label="পণ্য" className="rounded-lg border border-border bg-surface-2/50 p-4">
        <h3 className="text-small font-bold">২. পণ্য</h3>
        <div className="relative mt-3">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="পণ্যের নাম বা SKU লিখে খুঁজুন…"
            aria-label="পণ্য খুঁজুন"
            className={`${inputCls} pl-9`}
          />
        </div>
        {searching && <p role="status" className="mt-2 text-small text-text-muted">খোঁজা হচ্ছে…</p>}
        {searchFailed && (
          <p role="alert" className="mt-2 text-small text-rose-600">পণ্য খোঁজা যাচ্ছে না — products.view অনুমতি বা নেটওয়ার্ক সমস্যা হতে পারে।</p>
        )}
        {!searching && query.trim().length >= 2 && !searchFailed && hits.length === 0 && (
          <p role="status" className="mt-2 text-small text-text-muted">কোনো পণ্য পাওয়া যায়নি।</p>
        )}
        {hits.length > 0 && (
          <ul className="mt-3 space-y-3">
            {hits.map((p) => (
              <li key={p.id} className="rounded-md border border-border bg-card px-3.5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-small font-semibold">{p.titleBn}</span>
                  {p.status !== "ACTIVE" && <Badge tone="warning">{p.status}</Badge>}
                </div>
                <ul className="mt-2 divide-y divide-border">
                  {p.variants.map((v) => {
                    const out = v.stock <= 0;
                    const added = lines.some((l) => l.variantId === v.id);
                    return (
                      <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 text-small">
                        <span className="font-medium">{variantLabel(v.attributes)}</span>
                        <span className="font-mono text-caption text-text-muted">{v.sku}</span>
                        <span className="font-mono tabular-nums">{formatBdt(v.pricePoisha)}</span>
                        {out ? (
                          <Badge tone="danger">স্টক নেই</Badge>
                        ) : (
                          <span className="text-caption text-text-muted">স্টক {v.stock}</span>
                        )}
                        {!v.isActive && <Badge tone="neutral">নিষ্ক্রিয়</Badge>}
                        <button
                          type="button"
                          disabled={out || !v.isActive}
                          onClick={() => addLine(p, v)}
                          className="ml-auto min-h-[36px] rounded-md bg-brand-600 px-3 text-small font-semibold text-white transition motion-fast hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-text-subtle"
                        >
                          {added ? "আরও একটা যোগ করুন" : "যোগ করুন"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}

        {/* Chosen lines */}
        {lines.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed border-border px-3.5 py-3 text-small text-text-muted">
            এখনো কোনো পণ্য যোগ হয়নি — উপরে খুঁজে পণ্য যোগ করুন।
          </p>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {lines.map((l) => {
              const unit = takaToPoisha(l.priceTaka);
              const overridden = unit !== null && unit !== l.catalogPricePoisha;
              return (
                <li key={l.variantId} className="rounded-md border border-border bg-card px-3.5 py-3">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-small font-semibold">{l.productTitleBn}{l.variantLabel ? ` — ${l.variantLabel}` : ""}</p>
                      <p className="text-caption text-text-muted">
                        <span className="font-mono">{l.sku}</span> · ক্যাটালগ দাম {formatBdt(l.catalogPricePoisha)} · {l.stock >= 0 ? `স্টক ${l.stock}` : "স্টক — (ড্রাফট থেকে; সাবমিটে যাচাই হবে)"}
                        {overridden && <span className="ml-1 font-semibold text-amber-600">কর্মীর দাম — নোটে লেখা থাকবে</span>}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(l.variantId)}
                      aria-label={`${l.productTitleBn} সরান`}
                      className="min-h-[36px] rounded-md border border-border px-3 text-small font-semibold text-rose-600 transition motion-fast hover:bg-rose-50"
                    >
                      সরান
                    </button>
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-3 sm:max-w-sm">
                    <div>
                      <label className={labelCls} htmlFor={`mob-qty-${l.variantId}`}>পরিমাণ</label>
                      <input
                        id={`mob-qty-${l.variantId}`}
                        type="number"
                        min={1}
                        value={l.quantity}
                        onChange={(e) =>
                          updateLine(l.variantId, { quantity: Math.max(1, Math.floor(Number(e.target.value) || 1)) })
                        }
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={labelCls} htmlFor={`mob-price-${l.variantId}`}>একক দাম (টাকা)</label>
                      <input
                        id={`mob-price-${l.variantId}`}
                        type="number"
                        min={0}
                        step="0.01"
                        value={l.priceTaka}
                        onChange={(e) => updateLine(l.variantId, { priceTaka: e.target.value })}
                        className={inputCls}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Delivery + payment + totals */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
        <section aria-label="ডেলিভারি ও পেমেন্ট" className="rounded-lg border border-border bg-surface-2/50 p-4">
          <h3 className="text-small font-bold">৩. ডেলিভারি ও পেমেন্ট</h3>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="mob-shipping">ডেলিভারি পদ্ধতি</label>
              <select
                id="mob-shipping"
                value={shippingMethod}
                onChange={(e) => setShippingMethod(e.target.value as ManualShippingMethod)}
                className={inputCls}
              >
                {SHIPPING_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label} — {formatBdt(manualShippingPoisha(o.value))}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls} htmlFor="mob-pay">পেমেন্ট</label>
              <select
                id="mob-pay"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as "cod" | "bkash" | "nagad")}
                className={inputCls}
              >
                {Object.entries(PAYMENT_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-small font-medium">
                <input
                  type="checkbox"
                  checked={overrideOn}
                  onChange={(e) => setOverrideOn(e.target.checked)}
                  className="h-4 w-4 rounded accent-[#4F46E5]"
                />
                নিজে ডেলিভারি চার্জ বসান (override) — যেমন ফ্রি ডেলিভারির প্রতিশ্রুতি দিলে ০ বসান; নোটে লেখা থাকবে
              </label>
              {overrideOn && (
                <input
                  value={overrideTaka}
                  onChange={(e) => setOverrideTaka(e.target.value)}
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder="ডেলিভারি চার্জ (টাকা)"
                  aria-label="ডেলিভারি চার্জ override (টাকা)"
                  className={inputCls}
                />
              )}
            </div>
            <div>
              <label className={labelCls} htmlFor="mob-coupon">কুপন কোড (ঐচ্ছিক)</label>
              <input
                id="mob-coupon"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value)}
                placeholder="যেমন: WELCOME10"
                className={inputCls}
              />
              <p className="mt-1 text-caption text-text-subtle">কুপন সার্ভারে যাচাই হয় — ফলাফল তৈরি হওয়ার পর নিচে দেখানো হবে।</p>
            </div>
            <div>
              <label className={labelCls} htmlFor="mob-reseller">রিসেলার কোড (ঐচ্ছিক)</label>
              <input
                id="mob-reseller"
                value={resellerCode}
                onChange={(e) => setResellerCode(e.target.value)}
                placeholder="যেমন: TESTAB24"
                className={inputCls}
              />
            </div>
            {slots.length > 0 && (
              <div>
                <label className={labelCls} htmlFor="mob-slot">ডেলিভারির সময় (ঐচ্ছিক)</label>
                <select
                  id="mob-slot"
                  value={deliverySlotId}
                  onChange={(e) => setDeliverySlotId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">যেকোনো সময়</option>
                  {slots.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.labelBn} / {s.labelEn}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-small font-medium">
                <input
                  type="checkbox"
                  checked={giftOn}
                  onChange={(e) => setGiftOn(e.target.checked)}
                  className="h-4 w-4 rounded accent-[#4F46E5]"
                />
                উপহার হিসেবে পাঠানো হবে 🎁
              </label>
              {giftOn && (
                <input
                  value={giftMessage}
                  onChange={(e) => setGiftMessage(e.target.value)}
                  maxLength={500}
                  placeholder="উপহারের বার্তা (ঐচ্ছিক)"
                  aria-label="উপহারের বার্তা"
                  className={inputCls}
                />
              )}
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="mob-note">নোট (ঐচ্ছিক)</label>
              <input
                id="mob-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="নোট"
                className={inputCls}
              />
            </div>
          </div>
        </section>

        <aside aria-label="অর্ডার সারাংশ" className="rounded-lg border border-border bg-card p-4 shadow-card lg:sticky lg:top-5 lg:self-start">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-small font-bold">অর্ডার সারাংশ</h3>
            <Badge tone="warning">আনুমানিক</Badge>
          </div>

          {/* Live line items — per-line totals from the same typed
              prices the subtotal below sums (no new evaluator). */}
          {lines.length === 0 ? (
            <p className="mt-3 rounded-md border border-dashed border-border px-3 py-2.5 text-caption text-text-muted">
              এখনো কোনো পণ্য যোগ হয়নি।
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {lines.map((l) => {
                const unit = takaToPoisha(l.priceTaka);
                return (
                  <li key={l.variantId} className="py-2 text-small">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate font-medium">
                          {l.productTitleBn}
                          {l.variantLabel ? ` — ${l.variantLabel}` : ""}
                        </span>
                        <span className="text-caption text-text-muted">
                          {unit === null ? (
                            <span className="font-medium text-rose-600">একক দাম ঠিক করুন</span>
                          ) : (
                            <>
                              {l.quantity} × {formatBdt(unit)}
                            </>
                          )}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono font-semibold tabular-nums">
                        {unit === null ? "—" : formatBdt(unit * l.quantity)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <dl className="mt-3 space-y-2 text-small">
            <div className="flex items-center justify-between">
              <dt className="text-text-muted">পণ্যের মোট</dt>
              <dd className="font-mono font-semibold tabular-nums">{formatBdt(subtotalPoisha)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-text-muted">ডেলিভারি চার্জ{overrideOn ? " (override)" : ""}</dt>
              <dd className="font-mono font-semibold tabular-nums">{formatBdt(shippingPoisha)}</dd>
            </div>
            {couponCode.trim() !== "" && (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-text-muted">কুপন ({couponCode.trim()})</dt>
                <dd className="text-caption text-text-muted">ছাড় সার্ভারে যাচাই হবে</dd>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-border pt-2">
              <dt className="font-semibold">মোট</dt>
              <dd className="font-mono text-base font-bold tabular-nums">{formatBdt(estimatedTotalPoisha)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-caption leading-relaxed text-text-subtle">
            কুপন ছাড় থাকলে চূড়ান্ত মোট আরও কম হবে — সার্ভারের হিসাবই চূড়ান্ত, তৈরি হওয়ার পর নিচে দেখানো হবে।
            অগ্রিম প্রযোজ্য হলে তা সার্ভারের নিয়মেই নির্ধারিত হয় — এই ফর্মে আগাম দেখানো যায় না।
          </p>
          <Button type="submit" variant="primary" className="mt-4 w-full" disabled={busy || lines.length === 0}>
            {busy ? "তৈরি হচ্ছে…" : draftId ? "ড্রাফট থেকে অর্ডার তৈরি করুন" : "ম্যানুয়াল অর্ডার তৈরি করুন"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="mt-2 w-full"
            disabled={draftBusy || busy}
            onClick={() => void onSaveDraft()}
          >
            {draftBusy ? "সংরক্ষণ হচ্ছে…" : draftId ? "ড্রাফট হালনাগাদ রাখুন" : "ড্রাফট হিসেবে রাখুন"}
          </Button>
          <p className="mt-2 text-caption leading-relaxed text-text-subtle">
            ড্রাফটে কোনো অর্ডার নম্বর বা স্টক রিজার্ভ হয় না — অর্ধেক ফর্মও রেখে দেওয়া যায়, পরে ড্রাফট তালিকা থেকে খুলে শেষ করা যায়।
          </p>
          {draftMsg && (
            <p role="status" className="mt-2 rounded-md bg-brand-50 px-3 py-2 text-caption leading-relaxed text-brand-800">
              {draftMsg}
            </p>
          )}
        </aside>
      </div>

      {result && (
        <p
          role="status"
          className={`rounded-md px-3.5 py-2.5 text-small leading-relaxed ${
            result.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"
          }`}
        >
          {result.text}
        </p>
      )}
    </form>
  );
}
