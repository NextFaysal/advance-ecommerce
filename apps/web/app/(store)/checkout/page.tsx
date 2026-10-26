"use client";

// Checkout — wired to the REAL cart and the REAL orders API.
// Cart source of truth: the guest cart in localStorage via
// src/cart/persistence (loadGuestCart / clearGuestCart) — the exact
// same store the cart page reads and AddToCartButton writes. There is
// no second cart: the old in-memory /api/v1/public/carts stub route was
// removed (wave 5) — the guest cart is the only storefront cart.
// Submit: POST /api/v1/public/orders with the validateCheckoutForm()
// output (the route parses the same checkoutFormSchema). The client
// sends NO prices — the server re-reads variant prices/stock from the
// DB; the totals below are a preview of the server's own pipeline
// (a coupon's discount is evaluated server-side only, so the preview
// carries 0 until the order returns).
//
// Address + shipping (doc 17 O2): division/district/upazila are
// cascade selects fed by GET /api/v1/public/geo, so the submitted
// values are canonical geo-dataset names by construction. The
// customer no longer picks a delivery zone — the zone is derived
// from the chosen district, and the preview charge comes from the
// shipping engine's pure calculator (src/checkout/shipping-core) at
// the built-in default rates. There is no public settings endpoint,
// so the preview is labelled আনুমানিক; the server's engine result
// (live Settings rates, real order weight) is authoritative.
//
// OD3 (doc 19): presentation only — the form sections are grouped
// into numbered visual steps (১ তথ্য → ২ ঠিকানা → ৩ ডেলিভারি →
// ৪ পেমেন্ট) under a slim progress header, the cart summary becomes
// a sticky right rail on desktop, delivery slots render as radio
// cards, and the gift toggle becomes a card. Every field name, the
// validateCheckoutForm() payload, the abandoned-capture debounce and
// the checkoutSessionKey flow are exactly as before; the mobile
// sticky bar's button is a form-associated submit for the SAME form
// (one submit path — see the bar's comment below).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Cart } from "../../../src/cart/types";
import { cartSubtotalPoisha } from "../../../src/cart/types";
import { clearGuestCart, loadGuestCart } from "../../../src/cart/persistence";
import { readStoredResellerRef } from "../../../src/reseller/attribution";
import { findStockProblems } from "../../../src/checkout/stock";
import { computePricing, formatBdt } from "../../../src/checkout/pricing";
import {
  calculateShipping,
  DEFAULT_SHIPPING_RATES,
  zoneForDistrict,
  type ShippingZone,
} from "../../../src/checkout/shipping-core";
import {
  districtsOf,
  findDistrict,
  upazilasOf,
  type GeoTree,
} from "../../../src/checkout/geo-tree";
import { parseAddress } from "../../../src/bd/address-parser";
import { useDigitText } from "@/components/ui/numerals";
import { newIdempotencyKey, normalizeBdPhone, validateCheckoutForm } from "../../../src/checkout";
import { BkashMark, CodMark, NagadMark, RocketMark, SslCommerzMark, UpayMark } from "@/components/brand-marks";
import RocketPaymentPanel from "./RocketPaymentPanel";
import { Icon } from "@/components/ui/icon";
import OrderOtpPanel from "@/storefront-ux/order-otp-panel";
import { EmiCheckoutNote } from "@/marketing/components/EmiCheckoutNote";
import { ExperimentConversionPing } from "@/marketing/components/ExperimentConversionPing";
import { PAYMENT_NOT_LIVE_MESSAGE_BN } from "../../../src/checkout/payment-methods";

// Responsive pass (Design v3 §3): single-column flow at every width,
// 44px+ touch targets (h-12 fields, 52px payment tiles), numeric keypad
// hint on the phone field, and a sticky order-summary bar on small
// screens (real cart totals). Field names/values and validation are
// exactly as before.
const INPUT_CLASS =
  "h-12 w-full rounded-xl border border-border bg-card px-4 text-sm text-text-main outline-none transition placeholder:text-text-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30";
const PAYMENT_TILE_CLASS =
  "inline-flex h-[52px] cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-3 transition has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:checked]:ring-1 has-[:checked]:ring-brand-500/40";
// Delivery-slot radio cards (OD3): same checked-tile language as the
// payment tiles, sized for a Bn label + En/time line.
const SLOT_CARD_CLASS =
  "flex min-h-[52px] cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-card px-3.5 py-2.5 transition has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50 has-[:checked]:ring-1 has-[:checked]:ring-brand-500/40";

type PlacedOrder = {
  /** Order row id — the OTP endpoints are addressed by it. */
  id: string;
  orderNo: string;
  /** The phone as submitted (normalized) — the OTP endpoints bind by it. */
  phone: string;
  totalPoisha: number;
  paymentMethod: string;
  advanceRequired: boolean;
  /** meta.advance from the create response: the required amount and,
   *  when issuing succeeded, the one-time payment link (hash-only at
   *  rest — this confirmation is the ONLY place it can ever be shown). */
  advance: { requiredPoisha: number; linkUrl?: string } | null;
  requiresOtp: boolean;
  /** meta.otp.sms — whether the first OTP code's SMS was queued. */
  otpSms?: string;
  couponStatus?: string;
  /** meta.paymentInitiation — the hosted-payment initiation result
   *  for non-COD orders. "initiated" carries the hosted checkout URL;
   *  "not_configured" means the picked method has no working
   *  initiation path (adapter-less method, disabled in Settings, or
   *  a mode flipped ahead of its adapter) — the confirmation must
   *  say so plainly instead of silently promising a payment step. */
  paymentInitiation?: { status: string; url?: string };
  /** ADV-19: meta.pickupPoint — the resolved pickup point for a
   *  pickup order, shown on the confirmation so the customer knows
   *  exactly where to collect from. */
  pickupPoint?: { id: string; name: string; address: string; hours: string } | null;
  /** ADV-18: meta.giftCard — the gift-card outcome of THIS order.
   *  "applied" carries the exact amounts the server recorded;
   *  "rejected" carries the server's bn/en reason (the order still
   *  went through at full price); absent when no code was sent. */
  giftCard?:
    | { status: "applied"; appliedPoisha: number; codeLast4: string; remainingPoisha: number }
    | { status: "rejected"; reasonBn: string; reasonEn: string }
    | { status: "disabled" };
  /** ADV-18: meta.membershipTier — the tier benefit applied to this
   *  order (discount and/or free shipping), when the module is on. */
  membershipTier?: { tier: string | null; discountPoisha: number; freeShippingApplied: boolean };
  /** ADV-22: meta.pharmacyRx — present only when the order contains
   *  a prescription-required item. PENDING_REVIEW means a pharmacist
   *  must approve before the order can be confirmed. */
  pharmacyRx?: { reviewRequired: boolean; reviewStatus: string };
  /** ADV-22: meta.warrantyTerms — electronics warranty periods in
   *  this order (terms only; serials arrive at delivery and show on
   *  the account warranty card). Warranty starts at delivery. */
  warrantyTerms?: Array<{ categorySlug: string; months: number }>;
  /** ADV-23: meta.restaurant — present only when a kitchen ticket
   *  was created with this order (restaurant module on + a dine-in /
   *  takeaway choice submitted). The ticket starts QUEUED; its live
   *  state is watched on /track. */
  restaurant?: { fulfilmentType: "DINE_IN" | "TAKEAWAY"; tableLabel: string | null; kitchenStatus: string };
};

export default function CheckoutPage() {
  const digits = useDigitText();
  const [cart, setCart] = useState<Cart | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [placedOrder, setPlacedOrder] = useState<PlacedOrder | null>(null);
  // Advance-link copy feedback on the confirmation screen.
  const [linkCopied, setLinkCopied] = useState(false);
  // Geo cascade (doc 17 O2): division/district/upazila are picked
  // from the canonical geo tree, so submitted values are dataset
  // names by construction. If the geo fetch fails, the form falls
  // back to free-text inputs under the same field names — checkout
  // never blocks on it.
  const [geoTree, setGeoTree] = useState<GeoTree | null>(null);
  const [geoFailed, setGeoFailed] = useState(false);
  const [division, setDivision] = useState("");
  const [district, setDistrict] = useState("");
  const [upazila, setUpazila] = useState("");
  // Delivery vs pickup is the only shipping choice left to the
  // customer; the zone itself is derived from the district.
  const [deliveryType, setDeliveryType] = useState<"delivery" | "pickup">("delivery");
  // Delivery slot + gift (doc 17 batch O9-2): slots come from
  // GET /api/v1/public/delivery-slots (Settings orders.delivery_slots,
  // BD defaults when unconfigured). A failed fetch simply hides the
  // slot picker — checkout never blocks on a display preference. The
  // server re-resolves the submitted id against the configured set.
  const [slots, setSlots] = useState<{ id: string; labelBn: string; labelEn: string }[]>([]);
  const [deliverySlotId, setDeliverySlotId] = useState("");
  // Pickup points (ADV-19, click & collect): from GET
  // /api/v1/public/pickup-points (Settings stores.pickup_points).
  // Empty until the merchant configures real points — pickup itself
  // stays available without a named point. The server re-resolves the
  // submitted id; a failed fetch simply hides the picker.
  const [pickupPoints, setPickupPoints] = useState<{ id: string; name: string; address: string; hours: string }[]>([]);
  const [pickupPointId, setPickupPointId] = useState("");
  // Restaurant fulfilment (ADV-23, wave 56): from GET
  // /api/v1/public/restaurant/config — rendered ONLY when the
  // restaurant module is enabled for this install. dineInEnabled in
  // that response is already EFFECTIVE (no tables configured = no
  // dine-in offered). A failed fetch hides the section — checkout
  // never blocks on it, and the server re-validates the submitted
  // selection anyway.
  const [restaurantConfig, setRestaurantConfig] = useState<{
    enabled: boolean;
    dineInEnabled: boolean;
    takeawayEnabled: boolean;
    tables: string[];
  } | null>(null);
  const [fulfilmentType, setFulfilmentType] = useState<"DINE_IN" | "TAKEAWAY" | "">("");
  const [tableLabel, setTableLabel] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/public/restaurant/config")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("restaurant config fetch failed"))))
      .then(
        (json: {
          data?: { enabled?: boolean; dineInEnabled?: boolean; takeawayEnabled?: boolean; tables?: string[] };
        }) => {
          if (cancelled) return;
          const cfg = {
            enabled: json.data?.enabled === true,
            dineInEnabled: json.data?.dineInEnabled === true,
            takeawayEnabled: json.data?.takeawayEnabled === true,
            tables: Array.isArray(json.data?.tables) ? json.data.tables : [],
          };
          setRestaurantConfig(cfg);
          if (cfg.enabled) {
            // Pre-select the one sensible default: takeaway when it
            // is offered, else dine-in (whose table is picked below).
            setFulfilmentType(cfg.takeawayEnabled ? "TAKEAWAY" : "DINE_IN");
          }
        },
      )
      .catch(() => {
        // No restaurant section; the order flow is unaffected.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // Gift cards (ADV-18): the code field renders ONLY when the module
  // is on — GET /api/v1/public/gift-cards/status returns {enabled}
  // and nothing else (no code is ever sent there; validation happens
  // inside the order attempt itself, rate-limited server-side). A
  // failed fetch hides the field — checkout never blocks on it.
  const [giftCardsEnabled, setGiftCardsEnabled] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/public/gift-cards/status")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("gift card status fetch failed"))))
      .then((json: { data?: { enabled?: boolean } }) => {
        if (cancelled) return;
        if (json.data?.enabled) setGiftCardsEnabled(true);
      })
      .catch(() => {
        // No gift-card field; the order flow is unaffected.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/public/pickup-points")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("pickup points fetch failed"))))
      .then((json: { data?: { points?: { id: string; name: string; address: string; hours: string }[] } }) => {
        if (cancelled) return;
        if (Array.isArray(json.data?.points)) setPickupPoints(json.data.points);
      })
      .catch(() => {
        // No point picker; pickup ordering is unaffected.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [gift, setGift] = useState(false);
  const [giftMessage, setGiftMessage] = useState("");
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/public/delivery-slots")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("slots fetch failed"))))
      .then((json: { data?: { slots?: { id: string; labelBn: string; labelEn: string }[] } }) => {
        if (cancelled) return;
        if (Array.isArray(json.data?.slots)) setSlots(json.data.slots);
      })
      .catch(() => {
        // No slot picker; the order is unaffected.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // Payment methods (doc 22 ADV-4): the gateway tiles are NOT
  // hardcoded. GET /api/v1/public/payment-methods returns only the
  // methods that are enabled in Admin > Settings > Payments AND have
  // a working initiation path for their configured mode — the rule
  // lives in the capability map (src/checkout/payment-methods), so
  // adapter-less methods (AamarPay, ShurjoPay, Rocket, …) can never
  // be offered and dead-end a customer again. A failed fetch leaves
  // COD only — checkout never blocks on the method list.
  const [gatewayMethods, setGatewayMethods] = useState<{ method: string; label: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/public/payment-methods")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("payment methods fetch failed"))))
      .then((json: { data?: { methods?: { method: string; label: string }[] } }) => {
        if (cancelled) return;
        if (Array.isArray(json.data?.methods)) setGatewayMethods(json.data.methods);
      })
      .catch(() => {
        // COD only; the order flow is unaffected.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  // Paste-a-full-address helper: the parser's reading is offered as
  // a suggestion chip and applied ONLY on the customer's tap — the
  // form is never silently rewritten.
  const [pasteText, setPasteText] = useState("");
  const [suggestion, setSuggestion] = useState<{
    division: string;
    district: string;
    upazila: string;
  } | null>(null);
  // One key per checkout attempt; reused on retry, never regenerated on retry.
  const [idempotencyKey] = useState<string>(() => newIdempotencyKey());

  // Abandoned-checkout capture (wave 22, doc 17 batch O4): one session
  // key per browser checkout session, kept in sessionStorage so a
  // reload continues the SAME capture row server-side. The initial
  // value is a throwaway UUID; on mount the stored key is adopted (or
  // the fresh one stored), so the state always holds a valid UUID.
  const [checkoutSessionKey, setCheckoutSessionKey] = useState<string>(() => newIdempotencyKey());
  useEffect(() => {
    const STORAGE_KEY = "advance-ecommerce:checkout-session";
    try {
      const stored = window.sessionStorage.getItem(STORAGE_KEY);
      if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stored)) {
        setCheckoutSessionKey(stored);
      } else {
        window.sessionStorage.setItem(STORAGE_KEY, checkoutSessionKey);
      }
    } catch {
      // Storage unavailable (private mode): capture just uses the
      // in-memory key for this page view.
    }
    // Mount-only adoption by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formRef = useRef<HTMLFormElement | null>(null);
  const captureTimerRef = useRef<number | null>(null);

  // Post a capture snapshot when the shopper has a VALID phone and a
  // non-empty cart. Fire-and-forget by design: the response is ignored
  // and a failure (offline, rate limit, closed session) must never
  // surface in the checkout UX. Prices are NOT sent — the server
  // snapshots the catalog itself.
  const fireCapture = useCallback(
    (keepalive = false) => {
      const formEl = formRef.current;
      if (!formEl || !cart || cart.items.length === 0) return;
      const data = new FormData(formEl);
      const phone = normalizeBdPhone(String(data.get("phone") ?? ""));
      if (!phone) return;
      const name = String(data.get("customerName") ?? "").trim();
      const union = String(data.get("union") ?? "").trim();
      const addressLine = String(data.get("addressLine") ?? "").trim();
      fetch("/api/v1/public/checkout/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionKey: checkoutSessionKey,
          phone,
          ...(name ? { name } : {}),
          items: cart.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
          address: {
            ...(division ? { division } : {}),
            ...(district ? { district } : {}),
            ...(upazila ? { upazila } : {}),
            ...(union ? { union } : {}),
            ...(addressLine ? { addressLine } : {}),
          },
        }),
        keepalive,
      }).catch(() => {});
    },
    [cart, checkoutSessionKey, division, district, upazila],
  );

  const scheduleCapture = useCallback(() => {
    if (captureTimerRef.current !== null) window.clearTimeout(captureTimerRef.current);
    captureTimerRef.current = window.setTimeout(() => fireCapture(false), 1200);
  }, [fireCapture]);

  // pagehide is the last chance to capture when the shopper leaves
  // mid-form; keepalive lets the request outlive the page.
  useEffect(() => {
    const onPageHide = () => fireCapture(true);
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [fireCapture]);

  useEffect(
    () => () => {
      if (captureTimerRef.current !== null) window.clearTimeout(captureTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    setCart(loadGuestCart());
    setLoaded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/public/geo")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("geo fetch failed"))))
      .then((json: { data?: GeoTree }) => {
        if (cancelled) return;
        if (Array.isArray(json.data)) setGeoTree(json.data);
        else setGeoFailed(true);
      })
      .catch(() => {
        if (!cancelled) setGeoFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Zone from the district alone (before any district is picked the
  // preview assumes Dhaka, the pre-O2 default — it is a preview only).
  const districtZone: ShippingZone = zoneForDistrict(district || "Dhaka");
  const submittedZone: ShippingZone = deliveryType === "pickup" ? "pickup" : districtZone;

  function onDivisionChange(value: string) {
    setDivision(value);
    setDistrict("");
    setUpazila("");
  }

  function onDistrictChange(value: string) {
    setDistrict(value);
    setUpazila("");
  }

  function onPasteChange(value: string) {
    setPasteText(value);
    if (!geoTree || value.trim().length < 8) {
      setSuggestion(null);
      return;
    }
    const parsed = parseAddress(value);
    if (!parsed.district) {
      setSuggestion(null);
      return;
    }
    const located = findDistrict(geoTree, parsed.district);
    if (!located) {
      setSuggestion(null);
      return;
    }
    const candidate = parsed.upazila ?? parsed.area;
    const upazilaPick =
      candidate && located.district.upazilas.some((u) => u.nameEn === candidate) ? candidate : "";
    const next = {
      division: located.division.nameEn,
      district: located.district.nameEn,
      upazila: upazilaPick,
    };
    setSuggestion(next.division !== division || next.district !== district ? next : null);
  }

  function applySuggestion() {
    if (!suggestion) return;
    setDivision(suggestion.division);
    setDistrict(suggestion.district);
    setUpazila(suggestion.upazila);
    setSuggestion(null);
  }

  // Bangla label for the suggestion chip, from the tree's names.
  const suggestionLabel = (() => {
    if (!suggestion || !geoTree) return "";
    const located = findDistrict(geoTree, suggestion.district);
    if (!located) return suggestion.district;
    const parts = [`${located.district.nameBn} জেলা`];
    const up = located.district.upazilas.find((u) => u.nameEn === suggestion.upazila);
    if (up) parts.push(`${up.nameBn} উপজেলা`);
    return parts.join(", ");
  })();

  const items = useMemo(() => cart?.items ?? [], [cart]);
  // Prescription (ADV-22, pharmacy pack): when the cart contains an
  // Rx-required item, the prescription record fields render and are
  // submitted with the order. The check endpoint only drives the
  // form — the server re-derives the requirement from DB product
  // tags at submit and refuses an Rx order without a valid record.
  const [rxRequired, setRxRequired] = useState(false);
  useEffect(() => {
    if (items.length === 0) {
      setRxRequired(false);
      return;
    }
    let cancelled = false;
    fetch("/api/v1/public/pharmacy/rx-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantIds: items.map((i) => i.variantId) }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("rx check failed"))))
      .then((json: { data?: { required?: boolean } }) => {
        if (!cancelled) setRxRequired(json.data?.required === true);
      })
      .catch(() => {
        // Display helper only; the server gate still applies.
      });
    return () => {
      cancelled = true;
    };
  }, [items]);
  // Age gate (ADV-29): when the cart contains an item from an
  // age-restricted category (Settings catalog.age_restricted_categories),
  // the attestation checkbox renders and is submitted with the order.
  // The check endpoint only drives the form — the server re-derives
  // the requirement from DB category slugs at submit and refuses a
  // restricted order without the attestation. The attestation is a
  // self-declaration, NOT age/identity verification — the copy says so.
  const [ageGate, setAgeGate] = useState<{ required: boolean; minAge: number | null }>({
    required: false,
    minAge: null,
  });
  useEffect(() => {
    if (items.length === 0) {
      setAgeGate({ required: false, minAge: null });
      return;
    }
    let cancelled = false;
    fetch("/api/v1/public/catalog/age-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variantIds: items.map((i) => i.variantId) }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("age check failed"))))
      .then((json: { data?: { required?: boolean; minAge?: number | null } }) => {
        if (!cancelled) {
          setAgeGate({
            required: json.data?.required === true,
            minAge: typeof json.data?.minAge === "number" ? json.data.minAge : null,
          });
        }
      })
      .catch(() => {
        // Display helper only; the server gate still applies.
      });
    return () => {
      cancelled = true;
    };
  }, [items]);
  const stockProblems = useMemo(() => findStockProblems(items), [items]);  const totalQuantity = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items],
  );
  // Preview via the shipping engine's pure calculator at the
  // built-in default rates (no public settings endpoint exists) and
  // with no weight data (the cart carries none) — labelled আনুমানিক
  // in the summary; the server's engine result is authoritative.
  const shippingPreview = useMemo(
    () =>
      calculateShipping(DEFAULT_SHIPPING_RATES, {
        district: district || undefined,
        shippingMethod: submittedZone,
        totalWeightGrams: 0,
        subtotalPoisha: cart ? cartSubtotalPoisha(cart) : 0,
      }),
    [cart, district, submittedZone],
  );
  const pricing = useMemo(
    () =>
      computePricing({
        itemsSubtotalPoisha: cart ? cartSubtotalPoisha(cart) : 0,
        couponDiscountPoisha: 0,
        shippingPoisha: shippingPreview.shippingPoisha,
        codFeePoisha: 0,
        taxBps: 0,
      }),
    [cart, shippingPreview],
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!cart || submitting) return;
    const data = new FormData(e.currentTarget);
    const result = validateCheckoutForm({
      customerName: data.get("customerName"),
      phone: data.get("phone"),
      email: data.get("email") ?? "",
      address: {
        division: data.get("division"),
        district: data.get("district"),
        upazila: data.get("upazila"),
        union: data.get("union") || undefined,
        addressLine: data.get("addressLine"),
      },
      note: data.get("note") ?? undefined,
      shippingMethod: data.get("shippingMethod"),
      paymentMethod: data.get("paymentMethod"),
      items: cart.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })),
      idempotencyKey,
      couponCode: data.get("couponCode") || undefined,
      // Gift card (ADV-18): submitted only when the module is on (the
      // field renders only then). The server validates the code
      // inside the order attempt — a rejected code never fails the
      // order; the outcome comes back in meta.giftCard.
      giftCardCode: giftCardsEnabled ? data.get("giftCardCode") || undefined : undefined,
      // Prescription record (ADV-22): submitted only when the cart
      // contains an Rx item (rxRequired). The attestation checkbox
      // maps to the schema's literal true — unticked fails client
      // validation with an error, and the server gate refuses anyway.
      prescription: rxRequired
        ? {
            prescriberName: String(data.get("rxPrescriberName") ?? ""),
            registrationNo: String(data.get("rxRegistrationNo") ?? ""),
            imageUrl: data.get("rxImageUrl") || undefined,
            attested: data.get("rxAttested") === "on",
          }
        : undefined,
      // Age attestation (ADV-29): submitted only when the cart
      // contains an age-restricted item (ageGate.required). The
      // checkbox maps to the schema's literal true — unticked fails
      // client validation with an error, and the server gate
      // refuses anyway (400 AGE_ATTESTATION_REQUIRED).
      ageAttestation: ageGate.required
        ? {
            confirmed: data.get("ageAttested") === "on",
          }
        : undefined,
      // Reseller attribution (wave 6): the ?ref= code the storefront
      // shell captured into localStorage, while it is inside the
      // 30-day window. The server resolves it (ACTIVE resellers
      // only); an expired/absent ref simply omits the field. The ref
      // is NOT cleared after ordering — repeat orders inside the
      // window attribute to the same reseller.
      resellerCode: readStoredResellerRef() ?? undefined,
      // Abandoned-checkout session key (wave 22): the server stamps
      // this session's capture RECOVERED when the order commits.
      checkoutSessionKey,
      // Delivery slot + gift (wave 27): the slot id is re-resolved
      // server-side against the configured set; the gift message is
      // sent only when the gift box is ticked ("" = gift, no message).
      deliverySlotId: deliverySlotId || undefined,
      // Pickup point (ADV-19): sent only for pickup orders; the server
      // resolves it against Settings stores.pickup_points and records
      // a match in the order's create-time note.
      pickupPointId: deliveryType === "pickup" ? pickupPointId || undefined : undefined,
      giftMessage: gift ? giftMessage : undefined,
      // Restaurant selection (ADV-23): sent only when the module is
      // enabled AND a fulfilment choice is active; the server
      // re-validates it against restaurant.config (a dine-in without
      // a table, or a table no longer configured, comes back as a
      // bilingual 400 in the error list — the order is not created).
      restaurant:
        restaurantConfig?.enabled && fulfilmentType
          ? {
              fulfilmentType,
              tableLabel: fulfilmentType === "DINE_IN" ? tableLabel || undefined : undefined,
            }
          : undefined,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/public/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.data),
      });
      const json = (await res.json().catch(() => null)) as {
        data?: {
          order?: {
            id?: string;
            orderNo?: string;
            totalPoisha?: number;
            paymentMethod?: string;
            advanceRequired?: boolean;
            requiresOtp?: boolean;
            couponStatus?: string;
          };
        };
        meta?: {
          advance?: { requiredPoisha?: number; linkUrl?: string };
          otp?: { required?: boolean; sms?: string };
          paymentInitiation?: { status?: string; url?: string; provider?: string };
          pickupPoint?: { id: string; name: string; address: string; hours: string };
          giftCard?: PlacedOrder["giftCard"];
          membershipTier?: PlacedOrder["membershipTier"];
          pharmacyRx?: PlacedOrder["pharmacyRx"];
          warrantyTerms?: PlacedOrder["warrantyTerms"];
          restaurant?: PlacedOrder["restaurant"];
        };
        error?: { code?: string; message?: string; details?: unknown };
      } | null;
      const order = json?.data?.order;
      if (res.ok && order?.orderNo) {
        // Order persisted server-side (201, or 200 on an idempotent
        // replay of the same key) — the cart is spent: clear it via the
        // cart system's own mechanism so the cart page agrees.
        clearGuestCart();
        setCart(null);
        setPlacedOrder({
          id: order.id ?? "",
          orderNo: order.orderNo,
          phone: result.data.phone,
          totalPoisha: order.totalPoisha ?? pricing.grandTotalPoisha,
          paymentMethod: order.paymentMethod ?? result.data.paymentMethod,
          advanceRequired: Boolean(order.advanceRequired),
          advance:
            typeof json?.meta?.advance?.requiredPoisha === "number"
              ? {
                  requiredPoisha: json.meta.advance.requiredPoisha,
                  ...(json.meta.advance.linkUrl ? { linkUrl: json.meta.advance.linkUrl } : {}),
                }
              : null,
          requiresOtp: Boolean(order.requiresOtp),
          ...(json?.meta?.otp?.sms ? { otpSms: json.meta.otp.sms } : {}),
          ...(json?.meta?.paymentInitiation?.status
            ? {
                paymentInitiation: {
                  status: json.meta.paymentInitiation.status,
                  ...(json.meta.paymentInitiation.url
                    ? { url: json.meta.paymentInitiation.url }
                    : {}),
                },
              }
            : {}),
          ...(json?.meta?.pickupPoint
            ? { pickupPoint: json.meta.pickupPoint }
            : {}),
          ...(json?.meta?.giftCard ? { giftCard: json.meta.giftCard } : {}),
          ...(json?.meta?.membershipTier ? { membershipTier: json.meta.membershipTier } : {}),
          ...(json?.meta?.pharmacyRx ? { pharmacyRx: json.meta.pharmacyRx } : {}),
          ...(json?.meta?.warrantyTerms ? { warrantyTerms: json.meta.warrantyTerms } : {}),
          ...(json?.meta?.restaurant ? { restaurant: json.meta.restaurant } : {}),
          couponStatus: order.couponStatus,
        });
        return;
      }
      const apiError = json?.error;
      if (apiError?.code === "IDEMPOTENCY_CONFLICT") {
        // The key was claimed by an earlier failed attempt in this
        // session (the server keeps failed claims), so this key can
        // never succeed — a fresh page load mints a new key.
        setErrors([
          "এই চেকআউট প্রচেষ্টাটি আগেই একবার প্রসেস হয়েছে। নতুন করে অর্ডার করতে পেজটি রিলোড করুন।",
        ]);
      } else if (apiError?.code === "VALIDATION_ERROR" && Array.isArray(apiError.details)) {
        setErrors(apiError.details.map((d) => String(d)));
      } else if (apiError?.message) {
        setErrors([apiError.message]);
      } else {
        setErrors(["অর্ডার করা যায়নি। আবার চেষ্টা করুন।"]);
      }
    } catch {
      setErrors(["নেটওয়ার্ক সমস্যা — সংযোগ যাচাই করে আবার চেষ্টা করুন।"]);
    } finally {
      setSubmitting(false);
    }
  }

  // The sticky summary bar's button is a form-associated submit
  // (form="checkout-form") for THIS form — the same single submit
  // path as the in-form button: same onSubmit, same native + custom
  // validation, same idempotency key, same stock guard. There is no
  // second submit handler anywhere (OD3).

  if (!loaded) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-4 pb-32 pt-6 sm:px-6 lg:pb-12">
        <h1 className="font-display text-h1">চেকআউট — এক পেজেই অর্ডার</h1>
        <p className="mt-4 text-sm text-text-muted">কার্ট লোড হচ্ছে…</p>
      </main>
    );
  }

  if (placedOrder) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-4 pb-32 pt-6 sm:px-6 lg:pb-12">
        <section className="rounded-2xl border border-border bg-card p-6 text-center shadow-card" aria-label="অর্ডার সফল">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <Icon name="check" size={28} strokeWidth={2} />
          </span>
          <h1 className="font-display mt-4 text-h1">অর্ডার সফল হয়েছে!</h1>
          <p className="mt-2 text-sm leading-6 text-text-muted">
            ধন্যবাদ! আপনার অর্ডারটি গ্রহণ করা হয়েছে।
          </p>
          <dl className="mx-auto mt-5 max-w-sm space-y-2 rounded-xl bg-surface-2 px-4 py-3 text-left text-sm">
            <div className="flex justify-between">
              <dt className="text-text-muted">অর্ডার নম্বর</dt>
              <dd className="font-semibold tabular-nums">{placedOrder.orderNo}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-muted">সর্বমোট</dt>
              <dd className="font-semibold tabular-nums">{digits(formatBdt(placedOrder.totalPoisha))}</dd>
            </div>
            {placedOrder.restaurant ? (
              <div className="flex justify-between gap-3">
                <dt className="shrink-0 text-text-muted">রান্নাঘর</dt>
                <dd className="text-right font-semibold">
                  {placedOrder.restaurant.fulfilmentType === "DINE_IN"
                    ? `ডাইন-ইন${placedOrder.restaurant.tableLabel ? ` • টেবিল: ${placedOrder.restaurant.tableLabel}` : ""}`
                    : "টেকঅওয়ে"}{" "}
                  — অপেক্ষমাণ
                </dd>
              </div>
            ) : null}
            {placedOrder.pickupPoint ? (
              <>
                <div className="flex justify-between gap-3">
                  <dt className="shrink-0 text-text-muted">পিকআপ পয়েন্ট</dt>
                  <dd className="text-right font-semibold">{placedOrder.pickupPoint.name}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="shrink-0 text-text-muted">ঠিকানা</dt>
                  <dd className="text-right">{placedOrder.pickupPoint.address}</dd>
                </div>
                {placedOrder.pickupPoint.hours ? (
                  <div className="flex justify-between gap-3">
                    <dt className="shrink-0 text-text-muted">খোলার সময়</dt>
                    <dd className="text-right">{placedOrder.pickupPoint.hours}</dd>
                  </div>
                ) : null}
              </>
            ) : null}
          </dl>
          {placedOrder.pharmacyRx?.reviewStatus === "PENDING_REVIEW" ? (
            <p className="mx-auto mt-4 max-w-sm rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200" role="status">
              💊 আপনার প্রেসক্রিপশনের তথ্য গৃহীত হয়েছে — ফার্মাসিস্ট যাচাই করে অনুমোদন দিলে
              অর্ডারটি নিশ্চিত হবে। যাচাই শেষ হলে আমরা ফোনে জানিয়ে দেব।
            </p>
          ) : null}
          {placedOrder.warrantyTerms && placedOrder.warrantyTerms.length > 0 ? (
            <p className="mx-auto mt-4 max-w-sm rounded-xl bg-surface-2 px-4 py-3 text-sm leading-6 text-text-muted">
              🛡️ ওয়ারেন্টি:{" "}
              {placedOrder.warrantyTerms.map((t) => `${digits(String(t.months))} মাস`).join(", ")}{" "}
              — ওয়ারেন্টির মেয়াদ ডেলিভারির দিন থেকে শুরু হবে; পণ্য ডেলিভারির পর সিরিয়াল
              নম্বরসহ ওয়ারেন্টি কার্ড আপনার অ্যাকাউন্টে দেখা যাবে।
            </p>
          ) : null}
          {placedOrder.paymentMethod === "rocket" ? (
            // Rocket is a MANUAL method (ADV-4 remainder): no hosted
            // step exists — the panel shows the merchant number and
            // takes the customer's TrxID submission; staff verify it
            // in the review queue before the payment counts.
            <RocketPaymentPanel
              orderId={placedOrder.id}
              totalPoisha={placedOrder.totalPoisha}
              customerPhone={placedOrder.phone}
            />
          ) : placedOrder.paymentMethod === "cod" ? (
            <p className="mt-4 text-sm leading-6 text-text-muted">
              পণ্য হাতে পেয়ে ডেলিভারি ম্যানকে <strong>{digits(formatBdt(placedOrder.totalPoisha))}</strong> পরিশোধ করুন।
            </p>
          ) : placedOrder.paymentInitiation?.status === "initiated" && placedOrder.paymentInitiation.url ? (
            <div className="mt-4">
              <p className="text-sm leading-6 text-text-muted">
                অনলাইন পেমেন্টের ধাপটি তৈরি — নিচের বোতামে গিয়ে পেমেন্ট সম্পন্ন করুন।
              </p>
              <a
                href={placedOrder.paymentInitiation.url}
                className="brand-gradient mt-3 flex h-12 items-center justify-center rounded-xl px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
              >
                এখনই অনলাইনে পরিশোধ করুন
              </a>
            </div>
          ) : placedOrder.paymentInitiation?.status === "not_configured" ? (
            // The picked method has NO working initiation path (an
            // adapter-less method submitted from a stale page or a
            // direct API call, a disabled method, or a mode flipped
            // ahead of its adapter). Say so plainly in Bangla — never
            // a raw "not_configured" — and be honest the order stands.
            <p role="status" className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
              {PAYMENT_NOT_LIVE_MESSAGE_BN}
            </p>
          ) : placedOrder.paymentInitiation ? (
            <p role="status" className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
              অনলাইন পেমেন্ট এখন শুরু করা যাচ্ছে না — তবে আপনার অর্ডারটি গৃহীত হয়েছে। পেমেন্টের জন্য আমাদের টিম ফোনে যোগাযোগ করবে।
            </p>
          ) : (
            <p className="mt-4 text-sm leading-6 text-text-muted">
              অনলাইন পেমেন্ট সম্পন্ন না হলে আমাদের টিম ফোনে যোগাযোগ করে পেমেন্টের ধাপ জানিয়ে দেবে।
            </p>
          )}
          {placedOrder.advance?.linkUrl ? (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-4 text-left">
              <p className="text-sm font-bold text-text-main">
                অগ্রিম পেমেন্ট প্রয়োজন: {digits(formatBdt(placedOrder.advance.requiredPoisha))}
              </p>
              <p className="mt-1 text-sm leading-6 text-text-muted">
                এই অর্ডারটি নিশ্চিত করতে অগ্রিম{" "}
                <strong>{digits(formatBdt(placedOrder.advance.requiredPoisha))}</strong>{" "}
                পরিশোধ করুন। এই একই লিংকটি SMS-এর মাধ্যমে আপনার ফোনে পাঠানোর জন্যও ইস্যু করা
                হয়েছে — তবে লিংকটি এখানে শুধু এইবারই দেখা যাবে, তাই সংরক্ষণ করে রাখুন।
              </p>
              <a
                href={placedOrder.advance.linkUrl}
                className="brand-gradient mt-3 flex h-12 items-center justify-center rounded-xl px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
              >
                এখনই অগ্রিম পরিশোধ করুন
              </a>
              <div className="mt-2.5 flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate rounded-lg bg-card px-3 py-2 text-xs text-text-muted" title={placedOrder.advance.linkUrl}>
                  {placedOrder.advance.linkUrl}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(placedOrder.advance?.linkUrl ?? "")
                      .then(() => setLinkCopied(true))
                      .catch(() => setLinkCopied(false));
                  }}
                  className="inline-flex h-9 shrink-0 items-center rounded-lg border border-border bg-card px-3 text-sm font-medium text-text-main transition hover:bg-surface-2"
                >
                  {linkCopied ? "কপি হয়েছে ✓" : "লিংক কপি করুন"}
                </button>
              </div>
            </div>
          ) : placedOrder.advanceRequired ? (
            <p role="status" className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
              এই অর্ডারে অগ্রিম পেমেন্ট
              {placedOrder.advance
                ? ` (${digits(formatBdt(placedOrder.advance.requiredPoisha))})`
                : ""}{" "}
              প্রয়োজন — পেমেন্ট লিংকটি এখানে দেখানো যাচ্ছে না, আমাদের টিম ফোনে যোগাযোগ করে লিংকটি
              পাঠিয়ে দেবে।
            </p>
          ) : null}
          {placedOrder.requiresOtp ? (
            <OrderOtpPanel
              orderId={placedOrder.id}
              phone={placedOrder.phone}
              smsState={placedOrder.otpSms}
            />
          ) : null}
          {/* A/B conversion ping (ADV-18B): the server derives the
              visitor's variant from its cookie and verifies the
              order — this only reports that the order happened. */}
          <ExperimentConversionPing orderId={placedOrder.id} />
          {placedOrder.couponStatus === "applied" ? (
            <p className="mt-3 text-sm font-medium text-emerald-700">আপনার কুপনটি প্রয়োগ হয়েছে — ছাড়সহ মোট উপরে দেখানো হয়েছে।</p>
          ) : null}
          {placedOrder.giftCard?.status === "applied" ? (
            <p className="mt-3 text-sm font-medium text-emerald-700">
              গিফট কার্ড (…{placedOrder.giftCard.codeLast4}) দিয়ে{" "}
              {digits(formatBdt(placedOrder.giftCard.appliedPoisha))} পরিশোধ হয়েছে — কার্ডে অবশিষ্ট
              ব্যালেন্স {digits(formatBdt(placedOrder.giftCard.remainingPoisha))}, পরের অর্ডারে ব্যবহার
              করা যাবে।
            </p>
          ) : placedOrder.giftCard?.status === "rejected" ? (
            <p role="status" className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm font-medium text-amber-700">
              গিফট কার্ডটি প্রয়োগ করা যায়নি: {placedOrder.giftCard.reasonBn} অর্ডারটি সম্পূর্ণ মূল্যেই
              সম্পন্ন হয়েছে।
            </p>
          ) : null}
          {placedOrder.membershipTier &&
          (placedOrder.membershipTier.discountPoisha > 0 ||
            placedOrder.membershipTier.freeShippingApplied) ? (
            <p className="mt-3 text-sm font-medium text-emerald-700">
              আপনার মেম্বারশিপ টিয়ারের সুবিধা প্রয়োগ হয়েছে
              {placedOrder.membershipTier.discountPoisha > 0
                ? ` — পণ্যে ছাড় ${digits(formatBdt(placedOrder.membershipTier.discountPoisha))}`
                : ""}
              {placedOrder.membershipTier.freeShippingApplied ? " — ডেলিভারি চার্জ ফ্রি" : ""}।
            </p>
          ) : null}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link
              href="/track"
              className="brand-gradient flex h-12 items-center rounded-xl px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
            >
              অর্ডার ট্র্যাক করুন
            </Link>
            <Link
              href="/shop"
              className="flex h-12 items-center rounded-xl border border-border bg-card px-5 text-sm font-semibold text-text-main transition hover:bg-surface-2"
            >
              দোকানে যান
            </Link>
          </div>
        </section>
      </main>
    );
  }

  if (!cart || items.length === 0) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-4 pb-32 pt-6 sm:px-6 lg:pb-12">
        <h1 className="font-display text-h1">চেকআউট — এক পেজেই অর্ডার</h1>
        <section className="mt-6 rounded-2xl border border-border bg-card px-4 py-10 text-center shadow-card" aria-label="কার্ট খালি">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-600">
            <Icon name="cart" size={26} />
          </span>
          <p className="mt-4 text-base font-semibold text-text-main">আপনার কার্ট খালি</p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-text-muted">
            চেকআউট করতে আগে কার্টে পণ্য যোগ করুন — পছন্দের পণ্য বেছে কার্টে যোগ করলেই এখানে অর্ডার করা যাবে।
          </p>
          <Link
            href="/shop"
            className="brand-gradient mt-5 inline-flex h-12 items-center rounded-xl px-6 text-sm font-semibold text-white shadow-md transition hover:opacity-90"
          >
            দোকানে যান
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 pb-32 pt-6 sm:px-6 lg:max-w-[1080px] lg:pb-12">
      <h1 className="font-display text-h1">চেকআউট — এক পেজেই অর্ডার</h1>
      <p className="mt-2 text-sm leading-6 text-text-muted">
        ফোন নম্বর আবশ্যক, ইমেইল ঐচ্ছিক। ঠিকানা দিন ধাপে ধাপে: বিভাগ › জেলা › উপজেলা › ইউনিয়ন (ঐচ্ছিক)।
      </p>

      {/* Progress header (OD3): the four steps of the single-page
          form below, as a slim visual rhythm — not links or pages. */}
      <nav aria-label="চেকআউটের ধাপ" className="mt-5">
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
          {(
            [
              { n: "১", label: "তথ্য", icon: "user" },
              { n: "২", label: "ঠিকানা", icon: "home" },
              { n: "৩", label: "ডেলিভারি", icon: "truck" },
              { n: "৪", label: "পেমেন্ট", icon: "credit-card" },
            ] as const
          ).map((s, i) => (
            <li key={s.n} className="flex items-center gap-2">
              {i > 0 && <Icon name="chevron-right" size={14} className="text-text-subtle" />}
              <span className="flex items-center gap-1.5 text-sm font-medium text-text-main">
                <span aria-hidden="true" className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                  {s.n}
                </span>
                <Icon name={s.icon} size={15} className="text-brand-600" />
                {s.label}
              </span>
            </li>
          ))}
        </ol>
      </nav>

      {/* Summary rail (OD3): on mobile the summary keeps its place
          above the form; on desktop it becomes the sticky right rail.
          The figures are the page's existing preview computation. */}
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section className="rounded-2xl border border-border bg-card p-5 shadow-card lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1" aria-label="আপনার কার্ট">
        <h2 className="text-base font-semibold text-text-main">আপনার কার্ট</h2>
        <ul className="mt-3 divide-y divide-border">
          {items.map((item) => (
            <li key={item.variantId} className="flex items-baseline justify-between gap-3 py-2.5 text-sm">
              <span className="min-w-0">
                {item.name} <span className="text-text-muted">({item.sku})</span>
                <span className="text-text-muted"> × {item.quantity}</span>
              </span>
              <span className="shrink-0 font-medium tabular-nums">{digits(formatBdt(item.unitPricePoisha * item.quantity))}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1.5 border-t border-border pt-3 text-sm">
          <div className="flex justify-between">
            <dt className="text-text-muted">সাবটোটাল</dt>
            <dd className="tabular-nums">{digits(formatBdt(pricing.subtotalPoisha))}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-text-muted">
              ডেলিভারি চার্জ <span className="text-text-subtle">(আনুমানিক)</span>
            </dt>
            <dd className="tabular-nums">{digits(formatBdt(pricing.shippingPoisha))}</dd>
          </div>
          <div className="flex justify-between pt-1 text-base font-bold text-text-main">
            <dt>সর্বমোট</dt>
            <dd className="tabular-nums">{digits(formatBdt(pricing.grandTotalPoisha))}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-text-subtle">
          ডেলিভারি চার্জ আনুমানিক — চূড়ান্ত চার্জ সার্ভারে জেলা ও ওজন অনুযায়ী নির্ধারিত হবে।
          কুপনের ছাড় থাকলে তা অর্ডারের মোটে কমে যাবে।
        </p>
        {/* EMI note (ADV-18B) — display-only; never changes totals. */}
        <EmiCheckoutNote subtotalPoisha={pricing.subtotalPoisha} />
        {stockProblems.length > 0 && (
          <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
            স্টক সমস্যা: {stockProblems.map((p) => `${p.name} (চেয়েছেন ${p.requested}টি, স্টকে আছে ${p.available}টি)`).join(", ")}
          </p>
        )}
      </section>

      <form ref={formRef} id="checkout-form" onSubmit={onSubmit} onChange={scheduleCapture} className="grid gap-4 lg:col-start-1 lg:row-start-1">
        {/* Step ১ — তথ্য */}
        <section aria-label="ধাপ ১: আপনার তথ্য" className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <h2 className="flex items-center gap-2 text-base font-semibold text-text-main">
            <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">১</span>
            আপনার তথ্য
          </h2>
          <div className="mt-4 grid gap-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">আপনার নাম *</span>
          <input name="customerName" required autoComplete="name" className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">মোবাইল নম্বর *</span>
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="01XXXXXXXXX"
            required
            className={INPUT_CLASS}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">ইমেইল (ঐচ্ছিক)</span>
          <input name="email" type="email" inputMode="email" autoComplete="email" className={INPUT_CLASS} />
        </label>
          </div>
        </section>
        {/* Step ২ — ঠিকানা */}
        <section aria-label="ধাপ ২: ঠিকানা" className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <h2 className="flex items-center gap-2 text-base font-semibold text-text-main">
            <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">২</span>
            ঠিকানা
          </h2>
          <div className="mt-4 grid gap-4">
        {geoTree ? (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-text-main">
              সম্পূর্ণ ঠিকানা একসাথে লিখুন (ঐচ্ছিক)
            </span>
            <input
              value={pasteText}
              onChange={(e) => onPasteChange(e.target.value)}
              placeholder="যেমন: বাসা ১২, রোড ৫, মিরপুর ১০, ঢাকা"
              className={INPUT_CLASS}
            />
          </label>
        ) : null}
        {suggestion ? (
          <div
            role="status"
            className="flex flex-wrap items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm text-text-main"
          >
            <span>
              আপনি কি <strong>{suggestionLabel}</strong> বোঝাতে চেয়েছেন?
            </span>
            <button
              type="button"
              onClick={applySuggestion}
              className="inline-flex h-9 items-center rounded-lg bg-brand-600 px-3 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              হ্যাঁ, ব্যবহার করুন
            </button>
            <button
              type="button"
              onClick={() => setSuggestion(null)}
              className="inline-flex h-9 items-center rounded-lg border border-border bg-card px-3 text-sm font-medium text-text-main transition hover:bg-surface-2"
            >
              না
            </button>
          </div>
        ) : null}
        {geoTree ? (
          <>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-text-main">বিভাগ *</span>
              <select
                name="division"
                required
                value={division}
                onChange={(e) => onDivisionChange(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">বিভাগ বেছে নিন</option>
                {geoTree.map((d) => (
                  <option key={d.nameEn} value={d.nameEn}>
                    {d.nameBn}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-text-main">জেলা *</span>
              <select
                name="district"
                required
                value={district}
                disabled={!division}
                onChange={(e) => onDistrictChange(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">জেলা বেছে নিন</option>
                {districtsOf(geoTree, division).map((d) => (
                  <option key={d.nameEn} value={d.nameEn}>
                    {d.nameBn}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-text-main">উপজেলা *</span>
              <select
                name="upazila"
                required
                value={upazila}
                disabled={!district}
                onChange={(e) => setUpazila(e.target.value)}
                className={INPUT_CLASS}
              >
                <option value="">উপজেলা বেছে নিন</option>
                {upazilasOf(geoTree, division, district).map((u) => (
                  <option key={u.nameEn} value={u.nameEn}>
                    {u.nameBn}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : geoFailed ? (
          <>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-text-main">বিভাগ *</span>
              <input name="division" required className={INPUT_CLASS} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-text-main">জেলা *</span>
              <input name="district" required className={INPUT_CLASS} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-text-main">উপজেলা *</span>
              <input name="upazila" required className={INPUT_CLASS} />
            </label>
          </>
        ) : (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-text-main">বিভাগ / জেলা / উপজেলা *</span>
            <select disabled className={INPUT_CLASS}>
              <option>এলাকার তালিকা লোড হচ্ছে…</option>
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">ইউনিয়ন (ঐচ্ছিক)</span>
          <input name="union" className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">বিস্তারিত ঠিকানা *</span>
          <input name="addressLine" required autoComplete="street-address" className={INPUT_CLASS} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">নোট (ঐচ্ছিক)</span>
          <input name="note" className={INPUT_CLASS} />
        </label>
          </div>
        </section>
        {/* Step ৩ — ডেলিভারি */}
        <section aria-label="ধাপ ৩: ডেলিভারি" className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <h2 className="flex items-center gap-2 text-base font-semibold text-text-main">
            <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">৩</span>
            ডেলিভারি
          </h2>
          <div className="mt-4 grid gap-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">ডেলিভারি মাধ্যম</span>
          <select
            name="shippingMethod"
            value={submittedZone}
            onChange={(e) => setDeliveryType(e.target.value === "pickup" ? "pickup" : "delivery")}
            className={INPUT_CLASS}
          >
            <option value={districtZone}>
              হোম ডেলিভারি
              {district
                ? ` — ${districtZone === "inside_dhaka" ? "ঢাকার ভিতরে" : "ঢাকার বাইরে"} (জেলা অনুযায়ী স্বয়ংক্রিয়)`
                : ""}
            </option>
            <option value="pickup">পিকআপ (নিজে এসে নেবেন)</option>
          </select>
        </label>
        {/* Pickup point picker (ADV-19): only for pickup orders and
            only when the merchant has configured points. The choice is
            a display/note preference — pickup costs the same either
            way; the server records the point in the order note. */}
        {deliveryType === "pickup" && pickupPoints.length > 0 && (
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 text-sm font-medium text-text-main">কোন পয়েন্ট থেকে নেবেন?</legend>
            <div className="grid gap-2">
              {pickupPoints.map((p) => (
                <label key={p.id} className={SLOT_CARD_CLASS}>
                  <input
                    type="radio"
                    checked={pickupPointId === p.id}
                    onChange={() => setPickupPointId(p.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-text-main">{p.name}</span>
                    <span className="block text-xs text-text-muted">{p.address}</span>
                    {p.hours ? <span className="block text-xs text-text-muted">খোলা: {p.hours}</span> : null}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {deliveryType === "pickup" && pickupPoints.length === 0 && (
          <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm leading-6 text-text-muted">
            পিকআপের ঠিকানা ও সময় অর্ডারের পর আমাদের টিম ফোনে জানিয়ে দেবে।
          </p>
        )}
        {/* Restaurant fulfilment (ADV-23, wave 56): rendered ONLY when
            the restaurant module is enabled for this install (the
            public config fetch above). The choice rides the create
            payload as `restaurant` and is re-validated server-side
            against restaurant.config — this picker is a convenience,
            never the authority. A dine-in choice without a table is
            refused by the server with a bilingual message. */}
        {restaurantConfig?.enabled && (restaurantConfig.dineInEnabled || restaurantConfig.takeawayEnabled) && (
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 text-sm font-medium text-text-main">খাবার কীভাবে নেবেন?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {restaurantConfig.dineInEnabled && (
                <label className={SLOT_CARD_CLASS}>
                  <input
                    type="radio"
                    checked={fulfilmentType === "DINE_IN"}
                    onChange={() => setFulfilmentType("DINE_IN")}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-text-main">ডাইন-ইন</span>
                    <span className="block text-xs text-text-muted">রেস্টুরেন্টে বসে খাবেন — টেবিল বেছে নিন</span>
                  </span>
                </label>
              )}
              {restaurantConfig.takeawayEnabled && (
                <label className={SLOT_CARD_CLASS}>
                  <input
                    type="radio"
                    checked={fulfilmentType === "TAKEAWAY"}
                    onChange={() => setFulfilmentType("TAKEAWAY")}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-text-main">টেকঅওয়ে</span>
                    <span className="block text-xs text-text-muted">প্যাক করে নিয়ে যাবেন</span>
                  </span>
                </label>
              )}
            </div>
            {fulfilmentType === "DINE_IN" && restaurantConfig.tables.length > 0 && (
              <label className="mt-3 block">
                <span className="mb-1.5 block text-sm font-medium text-text-main">টেবিল</span>
                <select
                  value={tableLabel}
                  onChange={(e) => setTableLabel(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">— টেবিল বেছে নিন —</option>
                  {restaurantConfig.tables.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </fieldset>
        )}
        {/* Delivery slot + gift (doc 17 batch O9-2): shown only when
            the shop has slots configured/fetched. Neither choice
            changes the price — there is no slot fee and no gift fee. */}
        {slots.length > 0 && (
          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 text-sm font-medium text-text-main">ডেলিভারির সময় (ঐচ্ছিক)</legend>
            {/* Slot radio cards (OD3): the radios stay UNNAMED and
                state-bound exactly like the select they replace —
                deliverySlotId still reaches the payload from state,
                never from FormData. */}
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={SLOT_CARD_CLASS}>
                <input
                  type="radio"
                  checked={deliverySlotId === ""}
                  onChange={() => setDeliverySlotId("")}
                  className="h-4 w-4 shrink-0 accent-brand-600"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-text-main">যেকোনো সময়</span>
                  <span className="block text-xs text-text-muted">Any time</span>
                </span>
              </label>
              {slots.map((s) => (
                <label key={s.id} className={SLOT_CARD_CLASS}>
                  <input
                    type="radio"
                    checked={deliverySlotId === s.id}
                    onChange={() => setDeliverySlotId(s.id)}
                    className="h-4 w-4 shrink-0 accent-brand-600"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-text-main">{s.labelBn}</span>
                    <span className="block text-xs text-text-muted">{s.labelEn}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="rounded-xl border border-border bg-surface-2/60 px-4 py-3.5">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm font-medium text-text-main">
            <input
              type="checkbox"
              checked={gift}
              onChange={(e) => setGift(e.target.checked)}
              className="h-4 w-4 shrink-0 accent-brand-600"
            />
            এটি একটি উপহার 🎁
          </label>
          {gift && (
            <input
              value={giftMessage}
              onChange={(e) => setGiftMessage(e.target.value)}
              maxLength={500}
              placeholder="উপহারের বার্তা (ঐচ্ছিক) — যেমন: শুভ জন্মদিন!"
              aria-label="উপহারের বার্তা"
              className={`${INPUT_CLASS} mt-2`}
            />
          )}
        </div>
          </div>
        </section>
        {/* Step ৪ — পেমেন্ট */}
        <section aria-label="ধাপ ৪: পেমেন্ট" className="rounded-2xl border border-border bg-card p-5 shadow-card">
          <h2 className="flex items-center gap-2 text-base font-semibold text-text-main">
            <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">৪</span>
            পেমেন্ট
          </h2>
          <div className="mt-4 grid gap-4">
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 text-sm font-semibold text-text-main">পেমেন্ট মাধ্যম</legend>
          <div className="flex flex-wrap gap-2">
            <label className={PAYMENT_TILE_CLASS}>
              <input type="radio" name="paymentMethod" value="cod" defaultChecked className="h-4 w-4 shrink-0 accent-brand-600" />
              <CodMark />
            </label>
            <label className={PAYMENT_TILE_CLASS}>
              <input type="radio" name="paymentMethod" value="cod" defaultChecked className="h-4 w-4 shrink-0 accent-brand-600" />
              <CodMark />
            </label>
            {/* Gateway tiles come from GET /api/v1/public/payment-methods
                (enabled in Settings + a working initiation path for the
                configured mode, per src/checkout/payment-methods).
                Adapter-less methods are never returned, so they can
                never be picked here. */}
            {gatewayMethods.map((m) => (
              <label key={m.method} className={PAYMENT_TILE_CLASS}>
                <input type="radio" name="paymentMethod" value={m.method} className="h-4 w-4 shrink-0 accent-brand-600" />
                {m.method === "bkash" ? (
                  <BkashMark />
                ) : m.method === "nagad" ? (
                  <NagadMark />
                ) : m.method === "rocket" ? (
                  <span className="flex items-center gap-2">
                    <RocketMark />
                    <span className="text-xs font-medium text-text-muted">ম্যানুয়াল যাচাই</span>
                  </span>
                ) : m.method === "upay" ? (
                  <UpayMark />
                ) : m.method === "sslcommerz" ? (
                  <SslCommerzMark />
                ) : (
                  <span className="text-sm font-semibold text-text-main">{m.label}</span>
                )}
              </label>
            ))}
          </div>
          <p className="mt-2.5 text-sm leading-6 text-text-muted">
            {gatewayMethods.length > 0
              ? "নিরাপদ পেমেন্ট: পণ্য হাতে পেয়ে টাকা দিন (ক্যাশ অন ডেলিভারি), অথবা অনলাইনে পরিশোধ করুন।"
              : "পণ্য হাতে পেয়ে টাকা দিন (ক্যাশ অন ডেলিভারি)।"}
          </p>
        </fieldset>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-text-main">কুপন কোড (ঐচ্ছিক)</span>
          <input
            name="couponCode"
            autoComplete="off"
            className={INPUT_CLASS}
            defaultValue={cart.couponCode ?? ""}
          />
        </label>
        {giftCardsEnabled ? (
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-text-main">গিফট কার্ড কোড (ঐচ্ছিক)</span>
            <input
              name="giftCardCode"
              autoComplete="off"
              placeholder="GC-XXXX-XXXX-XXXX"
              className={INPUT_CLASS}
            />
            <span className="mt-1.5 block text-xs leading-5 text-text-muted">
              গিফট কার্ডের ব্যালেন্স থেকে অর্ডারের মূল্য পরিশোধ হবে (সর্বোচ্চ অর্ডারের মোট মূল্য পর্যন্ত);
              অবশিষ্ট ব্যালেন্স কার্ডেই থেকে যাবে।
            </span>
          </label>
        ) : null}
        {rxRequired ? (
          <fieldset className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-400/30 dark:bg-amber-500/10">
            <legend className="px-1 text-sm font-semibold text-text-main">
              💊 প্রেসক্রিপশনের তথ্য আবশ্যক
            </legend>
            <p className="text-sm leading-6 text-text-muted">
              আপনার কার্টে প্রেসক্রিপশন-আবশ্যক ওষুধ আছে। অর্ডার করতে প্রেসক্রিপশনের তথ্য দিন —
              ফার্মাসিস্ট যাচাই করার পর অর্ডার নিশ্চিত হবে। এই তথ্য রেকর্ড হিসেবে থাকবে; এটি
              যাচাইকৃত প্রেসক্রিপশন নয়।
            </p>
            <label className="mt-3 block">
              <span className="mb-1.5 block text-sm font-medium text-text-main">চিকিৎসকের নাম</span>
              <input name="rxPrescriberName" autoComplete="off" className={INPUT_CLASS} />
            </label>
            <label className="mt-3 block">
              <span className="mb-1.5 block text-sm font-medium text-text-main">চিকিৎসকের রেজিস্ট্রেশন নম্বর</span>
              <input name="rxRegistrationNo" autoComplete="off" className={INPUT_CLASS} />
            </label>
            <label className="mt-3 block">
              <span className="mb-1.5 block text-sm font-medium text-text-main">
                প্রেসক্রিপশনের ছবির লিংক (যদি আগে থেকে অনলাইনে থাকে — ঐচ্ছিক)
              </span>
              <input name="rxImageUrl" autoComplete="off" placeholder="https://…" className={INPUT_CLASS} />
            </label>
            <label className="mt-3 flex items-start gap-2.5 text-sm leading-6 text-text-main">
              <input type="checkbox" name="rxAttested" className="mt-1 h-4 w-4 shrink-0" />
              <span>আমি নিশ্চিত করছি যে আমার কাছে এই প্রেসক্রিপশনটি আছে এবং তথ্যগুলো সঠিক।</span>
            </label>
          </fieldset>
        ) : null}
        {ageGate.required ? (
          <fieldset className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-400/30 dark:bg-amber-500/10">
            <legend className="px-1 text-sm font-semibold text-text-main">
              🔞 বয়স নিশ্চিতকরণ আবশ্যক
            </legend>
            <p className="text-sm leading-6 text-text-muted">
              আপনার কার্টে বয়স-সীমাবদ্ধ পণ্য আছে — কেনার জন্য বয়স কমপক্ষে {ageGate.minAge ?? 18} বছর হতে
              হবে। এই নিশ্চিতকরণটি অর্ডারে রেকর্ড থাকবে। এটি একটি স্ব-ঘোষণা — আমরা কোনো পরিচয়পত্র বা
              জন্মতারিখ যাচাই করি না।
            </p>
            <label className="mt-3 flex items-start gap-2.5 text-sm leading-6 text-text-main">
              <input type="checkbox" name="ageAttested" className="mt-1 h-4 w-4 shrink-0" />
              <span>আপনি নিশ্চিত করছেন আপনার বয়স {ageGate.minAge ?? 18}+ / I confirm I am at least {ageGate.minAge ?? 18} years old.</span>
            </label>
          </fieldset>
        ) : null}
        <button
          id="checkout-submit"
          type="submit"
          disabled={stockProblems.length > 0 || submitting}
          className="brand-gradient h-12 w-full rounded-xl text-base font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? "অর্ডার করা হচ্ছে…" : "অর্ডার নিশ্চিত করুন"}
        </button>
          </div>
        </section>
      </form>
      </div>

      {errors.length > 0 && (
        <ul role="alert" className="mt-4 space-y-1 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
          {errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      )}

      {/* Sticky order-summary bar — small screens only, REAL cart totals.
          Sits directly above the shell's mobile bottom nav (bottom-16);
          the desktop flow keeps the in-page summary rail + in-form
          submit. The bar's button is a form-associated submit for
          #checkout-form (OD3) — the SAME single submit path as the
          in-form button, with the same disabled conditions. */}
      <div className="fixed inset-x-0 bottom-16 z-40 border-t border-border bg-card/95 px-4 py-3 shadow-[0_-4px_16px_rgba(49,46,129,0.08)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-[720px] items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-text-muted">মোট {totalQuantity}টি পণ্য</p>
            <p className="text-base font-bold leading-6 text-text-main">
              সর্বমোট <span className="tabular-nums">{digits(formatBdt(pricing.grandTotalPoisha))}</span>
            </p>
          </div>
          <button
            type="submit"
            form="checkout-form"
            disabled={stockProblems.length > 0 || submitting}
            className="brand-gradient flex h-12 shrink-0 items-center gap-1.5 rounded-xl px-5 text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "অর্ডার করা হচ্ছে…" : "অর্ডার করুন"}
            <Icon name="arrow-right" size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
    </main>
  );
}
