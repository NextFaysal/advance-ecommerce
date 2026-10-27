/**
 * Brand marks — payment & courier partner chips.
 *
 * These are simple COLOUR MARKS drawn as inline SVG + the partner's name.
 * They are NOT the partners' official logos and copy no logo artwork —
 * each chip is a rounded rectangle in the brand's recognisable colour
 * with a small generic glyph (send, shield, banknote, pin, box…) and the
 * name in bold text. Used for trust rows (footer, checkout) instead of
 * the old grey text pills.
 *
 * Pure presentational components — no hooks, no client directive needed.
 * Locale arrives as a plain prop (see MarkProps.locale), never a hook,
 * so server components can render these too.
 */
import type { Locale } from "@/i18n/locale";

export type MarkVariant = "color" | "mono";

export interface MarkProps {
  variant?: MarkVariant;
  className?: string;
  /** Doc 30: display locale for the one translatable mark (COD) and the
   *  group aria-labels. Brand names (bKash, Pathao…) are proper nouns and
   *  never translated. Defaults to bn (legacy rendering). */
  locale?: Locale;
}

interface GlyphProps {
  d: string[];
}

function Glyph({ d }: GlyphProps) {
  return (
    <svg
      aria-hidden
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {d.map((path, i) => (
        <path key={i} d={path} />
      ))}
    </svg>
  );
}

function Chip({
  name,
  color,
  glyph,
  variant = "color",
  className,
}: {
  name: string;
  color: string;
  glyph: string[];
  variant?: MarkVariant;
  className?: string;
}) {
  const mono = variant === "mono";
  return (
    <span
      className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-bold leading-none ${
        mono ? "border border-slate-200 bg-slate-50 text-slate-600" : "text-white"
      } ${className ?? ""}`}
      style={mono ? undefined : { backgroundColor: color }}
    >
      <Glyph d={glyph} />
      {name}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Payment partners                                                    */
/* ------------------------------------------------------------------ */

export function BkashMark(props: MarkProps) {
  return (
    <Chip
      name="bKash"
      color="#E2136E"
      glyph={["M22 2 11 13", "M22 2 15 22l-4-9-9-4 20-7z"]}
      {...props}
    />
  );
}

export function NagadMark(props: MarkProps) {
  return (
    <Chip
      name="Nagad"
      color="#F6921E"
      glyph={["M12 2l2.4 7.6L22 12l-7.6 2.4L12 22l-2.4-7.6L2 12l7.6-2.4L12 2z"]}
      {...props}
    />
  );
}

export function RocketMark(props: MarkProps) {
  return (
    <Chip
      name="Rocket"
      color="#8C3494"
      glyph={[
        "M12 2c3 2.2 5 6.2 5 10.2L12 17l-5-4.8C7 8.2 9 4.2 12 2z",
        "M12 6.5h.01",
        "M7 13c-1.5 1-2.5 3-3 6 3-.5 5-1.5 6-3",
        "M17 13c1.5 1 2.5 3 3 6-3-.5-5-1.5-6-3",
      ]}
      {...props}
    />
  );
}

export function UpayMark(props: MarkProps) {
  return (
    <Chip
      name="Upay"
      color="#00875A"
      glyph={["M12 3l6 7h-4v11h-4V10H6l6-7z"]}
      {...props}
    />
  );
}

export function SslCommerzMark(props: MarkProps) {
  return (
    <Chip
      name="SSLCommerz"
      color="#2E4A9E"
      glyph={["M12 3l7 2.8V11c0 4.8-3 7.8-7 9.5C8 18.8 5 15.8 5 11V5.8L12 3z", "M9 11.5l2 2 4-4"]}
      {...props}
    />
  );
}

export function CodMark(props: MarkProps) {
  return (
    <Chip
      name={props.locale === "en" ? "Cash on Delivery" : "ক্যাশ অন ডেলিভারি"}
      color="#16A34A"
      glyph={["M2 6h20v12H2z", "M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z", "M6 12h.01", "M18 12h.01"]}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Courier partners                                                    */
/* ------------------------------------------------------------------ */

export function PathaoMark(props: MarkProps) {
  return (
    <Chip
      name="Pathao"
      color="#E31837"
      glyph={["M12 21s-7-5.8-7-11a7 7 0 1 1 14 0c0 5.2-7 11-7 11z", "M12 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"]}
      {...props}
    />
  );
}

export function RedxMark(props: MarkProps) {
  return (
    <Chip
      name="RedX"
      color="#C8102E"
      glyph={["M21 8 12 3 3 8v8l9 5 9-5V8z", "M3 8l9 5 9-5", "M12 13v8"]}
      {...props}
    />
  );
}

export function SteadfastMark(props: MarkProps) {
  return (
    <Chip
      name="Steadfast"
      color="#0E7C7B"
      glyph={["M13 2 4 14h6l-1 8 9-12h-6l1-8z"]}
      {...props}
    />
  );
}

export function EcourierMark(props: MarkProps) {
  return (
    <Chip
      name="eCourier"
      color="#00A651"
      glyph={[
        "M1 5h13v11H1z",
        "M14 9h4l3.5 3.5V16H14z",
        "M5.5 19a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z",
        "M17.5 19a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z",
      ]}
      {...props}
    />
  );
}

export function PaperflyMark(props: MarkProps) {
  return (
    <Chip
      name="Paperfly"
      color="#F26522"
      glyph={["M22 2 11 13", "M22 2 15 22l-4-9-9-4 20-7z", "M2 22l4-4"]}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

export function PaymentMarks({ variant = "color", className, locale }: MarkProps) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}
      role="group"
      aria-label={locale === "en" ? "Accepted payment methods" : "গৃহীত পেমেন্ট মাধ্যম"}
    >
      <BkashMark variant={variant} />
      <NagadMark variant={variant} />
      <RocketMark variant={variant} />
      <SslCommerzMark variant={variant} />
      <CodMark variant={variant} locale={locale} />
    </div>
  );
}

export function CourierMarks({ variant = "color", className, locale }: MarkProps) {
  return (
    <div
      className={`flex flex-wrap items-center gap-2 ${className ?? ""}`}
      role="group"
      aria-label={locale === "en" ? "Delivery partners" : "ডেলিভারি পার্টনার"}
    >
      <PathaoMark variant={variant} />
      <RedxMark variant={variant} />
      <SteadfastMark variant={variant} />
      <EcourierMark variant={variant} />
      <PaperflyMark variant={variant} />
    </div>
  );
}
