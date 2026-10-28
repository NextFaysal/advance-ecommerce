/**
 * Aurora HomeSections slot — doc 25 §1.4 / wave S3a.
 *
 * The home page's section composition, MOVED VERBATIM from
 * app/page.tsx (the hard-coded JSX sequence the page used to render
 * inline). Nothing here is redesigned: same markup, same order, same
 * classNames, same conditional logic, same imports the composition
 * always had. The page keeps ALL data fetching and passes the loaded
 * objects in as props (see HomeSectionsProps in src/themes/slots.ts);
 * the only page-side derivation moved along with the JSX is
 * `flashProducts` (a pure filter over the products prop, used solely
 * by the flash-sale section below).
 *
 * Sections with no data hide themselves entirely — the homepage
 * never shows a bare empty box. "Customer words" are REAL approved
 * product reviews, never written-in quotes.
 */
import Link from "next/link";
import { ThemedProductCard } from "../themed-product-card";
import type { Category } from "@/catalog/types";
import { Reveal } from "@/components/ui/reveal";
import { NewsletterForm } from "@/newsletter/components/NewsletterForm";
import { FlashSaleCountdownSection } from "@/marketing/flash-sale-section";
import { HeroSlides } from "@/cms/HeroSlides";
import { HeroExperiment } from "@/marketing/components/HeroExperiment";
import { SpinWheelSection } from "@/marketing/components/SpinWheelSection";
import { RecentOrdersSection } from "@/marketing/components/RecentOrdersSection";
import { VisitorIdBootstrap } from "@/marketing/components/VisitorIdBootstrap";
import { Stars } from "@/reviews/components/Stars";
import type { HomeSectionsProps } from "../slots";
import { interpolate, pick, type Locale } from "@/i18n/locale";
import { getStoreDefaultLocale } from "@/i18n/server";
import { COMMON_STRINGS } from "@/i18n/dictionaries";
import { AURORA_STRINGS, type AuroraStrings } from "./strings";
import { StoreImage } from "@/storefront-ux/components/StoreImage";

/* ---------- small inline icons (Lucide-style, 1.6 stroke) ---------- */
const iconProps = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function CashIcon({ size = 26 }: { size?: number }) {
  return (
    <svg {...iconProps} width={size} height={size}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9.5h.01M18 14.5h.01" />
    </svg>
  );
}

function TruckIcon({ size = 26 }: { size?: number }) {
  return (
    <svg {...iconProps} width={size} height={size}>
      <path d="M2.5 6h12v11h-12z" />
      <path d="M14.5 10h3.6l3 3.4V17h-6.6" />
      <circle cx="6.5" cy="17.5" r="1.8" />
      <circle cx="17.5" cy="17.5" r="1.8" />
    </svg>
  );
}

function ReturnIcon({ size = 26 }: { size?: number }) {
  return (
    <svg {...iconProps} width={size} height={size}>
      <path d="M8.5 5.5 5 9l3.5 3.5" />
      <path d="M5 9h9a5 5 0 0 1 0 10h-3" />
    </svg>
  );
}

function ShieldIcon({ size = 26 }: { size?: number }) {
  return (
    <svg {...iconProps} width={size} height={size}>
      <path d="M12 3l7 2.8v5.4c0 4.6-3 7.7-7 9.3-4-1.6-7-4.7-7-9.3V5.8L12 3z" />
      <path d="M9 11.6l2.2 2.2L15.4 9.6" />
    </svg>
  );
}

/* BoltIcon + CheckIcon moved into HeroExperiment.tsx with the
   hero text block (Wave 46) — they were used nowhere else here. */

/* ---------- shared bits ---------- */
function SectionHeading({
  eyebrow,
  title,
  href,
  linkLabel,
  inverse = false,
}: {
  eyebrow: string;
  title: string;
  href?: string;
  linkLabel?: string;
  inverse?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <p className={`text-xs font-bold ${inverse ? "text-background/70" : "text-primary"}`}>
          {eyebrow}
        </p>
        <h2 className={`mt-1 text-2xl font-extrabold leading-tight ${inverse ? "text-background" : "text-text-main"}`}>
          {title}
        </h2>
      </div>
      {href && linkLabel ? (
        <Link
          href={href}
          className={`inline-flex min-h-[44px] items-center text-sm font-semibold hover:underline ${inverse ? "text-background" : "text-primary"}`}
        >
          {linkLabel} →
        </Link>
      ) : null}
    </div>
  );
}

const CATEGORY_TINTS: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: "bg-[#EEF2FF]", fg: "text-[#4338CA]" },
  { bg: "bg-violet-50", fg: "text-violet-700" },
  { bg: "bg-pink-50", fg: "text-pink-700" },
  { bg: "bg-amber-50", fg: "text-amber-700" },
  { bg: "bg-emerald-50", fg: "text-emerald-700" },
  { bg: "bg-sky-50", fg: "text-sky-700" },
  { bg: "bg-rose-50", fg: "text-rose-700" },
  { bg: "bg-teal-50", fg: "text-teal-700" },
];

function CategoryTile({
  category,
  index,
  locale,
  s,
}: {
  category: Category;
  index: number;
  locale: Locale;
  s: AuroraStrings;
}) {
  const tint = CATEGORY_TINTS[index % CATEGORY_TINTS.length];
  return (
    <Link
      href={`/shop?category=${category.slug}`}
      className={`group flex items-center gap-3.5 rounded-2xl p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${tint.bg}`}
    >
      {category.imageUrl ? (
        <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl">
          <StoreImage
            src={category.imageUrl}
            alt={category.name[locale]}
            preset="thumb"
            fillParent
          />
        </span>
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/80 text-lg font-extrabold text-text-main shadow-sm">
          {category.name[locale].charAt(0)}
        </span>
      )}
      <span className="min-w-0">
        <span className={`block truncate text-[15px] font-bold ${tint.fg}`}>{category.name[locale]}</span>
        <span className="mt-0.5 block text-xs text-text-muted">{interpolate(s.categoryProductCount, { count: category.productCount })}</span>
      </span>
    </Link>
  );
}

function buildTrustItems(s: AuroraStrings) {
  return [
    { icon: <CashIcon />, title: s.trustCodTitle, text: s.trustCodText },
    { icon: <TruckIcon />, title: s.trustDeliveryTitle, text: s.trustDeliveryText },
    { icon: <ReturnIcon />, title: s.trustReturnTitle, text: s.trustReturnText },
    { icon: <ShieldIcon />, title: s.trustOriginalTitle, text: s.trustOriginalText },
  ];
}

/* Hero right-column visual — layered brand cards over the aurora
   background (Design v3, A+); no fake products. Shared by the static
   hero and the CMS campaign slider (as its no-image fallback). */
function HeroVisual({ s }: { s: AuroraStrings }) {
  return (
    <div className="aurora relative hidden min-h-[320px] overflow-hidden rounded-3xl p-6 shadow-md lg:block" aria-hidden="true">
      <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/15" />
      <div className="absolute -bottom-14 -left-8 h-52 w-52 rounded-full bg-black/10" />
      <div className="relative flex h-full flex-col justify-between gap-4">
        <div className="w-56 rounded-2xl bg-white/95 p-4 shadow-lg">
          <p className="flex items-center gap-2 text-sm font-bold text-[#1F2037]">
            <span className="text-primary"><CashIcon size={20} /></span> {s.trustCodTitle}
          </p>
          <p className="mt-1 text-xs leading-5 text-[#5B5F7A]">{s.heroCodText}</p>
        </div>
        <div className="ml-auto w-60 rounded-2xl bg-white/95 p-4 shadow-lg">
          <p className="flex items-center gap-2 text-sm font-bold text-[#1F2037]">
            <span className="text-primary"><TruckIcon size={20} /></span> {s.heroFastDeliveryTitle}
          </p>
          <p className="mt-1 text-xs leading-5 text-[#5B5F7A]">{s.heroDeliveryText}</p>
        </div>
        <div className="w-52 rounded-2xl bg-white/95 p-4 shadow-lg">
          <p className="flex items-center gap-2 text-sm font-bold text-[#1F2037]">
            <span className="text-primary"><ShieldIcon size={20} /></span> {s.heroQualityTitle}
          </p>
          <p className="mt-1 text-xs leading-5 text-[#5B5F7A]">{s.heroQualityText}</p>
        </div>
      </div>
    </div>
  );
}

export default function AuroraHomeSections(props: HomeSectionsProps) {
  return <AuroraHomeSectionsInner {...props} />;
}

async function AuroraHomeSectionsInner({
  products,
  categories,
  heroSlides,
  customerReviews,
  mechanicsOn,
  experimentActive,
  heroStats,
}: HomeSectionsProps) {
  // ISR: store default only; LocaleProvider applies the visitor override after mount.
  const locale = await getStoreDefaultLocale();
  const t = pick(locale, COMMON_STRINGS);
  const s = pick(locale, AURORA_STRINGS);
  const trustItems = buildTrustItems(s);
  // Flash sale = products whose default purchasable variant carries a
  // compare-at price. Derived from the same fetch — no extra query.
  const flashProducts = products.filter((p) =>
    p.variants.some((v) => v.isActive && v.compareAtPoisha !== null && v.compareAtPoisha > v.pricePoisha),
  );

  return (
    <main className="mx-auto min-w-0 max-w-[1440px] px-4 sm:px-6">
      {/* ---------- Hero ---------- */}
      {heroSlides.length > 0 ? (
        /* CMS campaign slides (Admin → Content) replace the static
           hero copy while at least one slide is active. The A/B
           override never applied while slides exist — unchanged. */
        <HeroSlides slides={heroSlides} visual={<HeroVisual s={s} />} stats={heroStats} />
      ) : (
      <section className="brand-soft-gradient mt-5 overflow-hidden rounded-3xl shadow-sm">
        <div className="grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-2 lg:p-12">
          <div className="min-w-0">
            {/* Static default copy; HeroExperiment swaps in the
                visitor's A/B variant client-side when a hero
                experiment is running. heroStats stays a
                server-rendered child. */}
            <HeroExperiment
              headline={s.heroHeadline}
              sub={s.heroSub}
              ctaLabel={s.heroCta}
              ctaHref="/shop"
              experimentActive={experimentActive}
            >
              {heroStats}
            </HeroExperiment>
          </div>

          <HeroVisual s={s} />
        </div>
      </section>
      )}

      {/* ---------- Flash sale countdown (CMS flash-sale module) ----------
          Self-fetching server wrapper: renders the live sale's
          countdown section, or nothing when no sale is live. */}
      <FlashSaleCountdownSection />

      {/* ---------- Spin wheel (ADV-18B) ----------
          Self-gating server wrapper: renders only when the
          marketing-mechanics flag is on and the wheel is enabled. */}
      <SpinWheelSection />
      {mechanicsOn ? <VisitorIdBootstrap /> : null}

      {/* ---------- Recent orders (doc 23 wave 60, honest social proof) ----------
          Self-gating server wrapper: renders only when the
          module.social_proof flag is on. The ticker fetches the
          edge-cached recent-orders API client-side (this page
          stays static) and renders nothing until >= 3 REAL
          recent orders come back — no filler, ever. */}
      <RecentOrdersSection />

      {/* ---------- Trust row ---------- */}
      <Reveal delay={60}>
      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={s.benefitsAria}>
        {trustItems.map((item) => (
          <div key={item.title} className="flex gap-3.5 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
              {item.icon}
            </span>
            <span className="min-w-0">
              <span className="block break-words text-sm font-bold leading-snug text-text-main">{item.title}</span>
              <span className="mt-1 hidden break-words text-[13px] leading-5 text-text-muted sm:block">{item.text}</span>
            </span>
          </div>
        ))}
      </section>
      </Reveal>

      {/* ---------- Categories ---------- */}
      {categories.length > 0 ? (
        <Reveal delay={120}>
        <section className="mt-12">
          <SectionHeading eyebrow={t.categories} title={s.shopByPreference} href="/shop" linkLabel={s.viewAllProducts} />
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {categories.map((c, i) => (
              <CategoryTile key={c.slug} category={c} index={i} locale={locale} s={s} />
            ))}
          </div>
        </section>
        </Reveal>
      ) : null}

      {/* ---------- Flash sale (only when discounted stock exists) ---------- */}
      {flashProducts.length > 0 ? (
        <Reveal delay={60}>
        <section className="mt-12">
          <SectionHeading eyebrow={s.limitedTimeOffer} title={s.flashSale} href="/shop" linkLabel={s.viewAllOffers} />
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {flashProducts.slice(0, 4).map((p) => (
              <ThemedProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
        </Reveal>
      ) : null}

      {/* ---------- Featured products ---------- */}
      {products.length > 0 ? (
        <Reveal delay={120}>
        <section className="mt-12">
          <SectionHeading eyebrow={s.featuredEyebrow} title={s.popularProducts} href="/shop" linkLabel={t.viewAll} />
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {products.map((p) => (
              <ThemedProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
        </Reveal>
      ) : null}

      {/* ---------- Why us (inverse band) ---------- */}
      <Reveal delay={60}>
      <section className="mt-14 rounded-3xl bg-foreground px-6 py-10 shadow-md sm:px-10">
        <SectionHeading eyebrow={s.whyUsEyebrow} title={s.shopWithTrust} inverse />
        <div className="mt-7 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {trustItems.map((item) => (
            <div key={item.title}>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-background/10 text-background">
                {item.icon}
              </span>
              <h3 className="mt-3 text-[15px] font-bold text-background">{item.title}</h3>
              <p className="mt-1 text-sm leading-6 text-background/80">{item.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/shop"
            className="rounded-xl bg-background px-5 py-3 text-sm font-bold text-foreground shadow-sm transition hover:bg-secondary"
          >
            {s.shopNowCta}
          </Link>
          <Link
            href="/track"
            className="rounded-xl border border-background/30 px-5 py-3 text-sm font-bold text-background transition hover:bg-background/10"
          >
            {t.trackOrder}
          </Link>
        </div>
      </section>
      </Reveal>

      {/* ---------- Customer words: REAL approved reviews ----------
          Sourced from the Review table (latest APPROVED, rating >= 4,
          across products). With zero approved reviews the section
          renders NOTHING — no placeholder quotes, ever. */}
      {customerReviews.length > 0 ? (
        <Reveal delay={120}>
        <section className="mt-14">
          <SectionHeading eyebrow={s.customerWordsEyebrow} title={s.customersSayTitle} />
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {customerReviews.map((r) => (
              <figure key={r.id} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <Stars rating={r.rating} />
                <blockquote className="mt-3 break-words text-sm leading-7 text-text-main">
                  “{r.body}”
                </blockquote>
                <figcaption className="mt-4 text-sm">
                  <span className="font-bold text-text-main">{r.authorName}</span>
                  <span className="text-text-subtle">
                    {" "}— {s.reviewProductLabel}{" "}
                    <Link href={`/product/${r.productSlug}`} className="font-medium text-primary hover:underline">
                      {r.productTitleBn}
                    </Link>
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
        </Reveal>
      ) : null}

      {/* ---------- Newsletter ---------- */}
      <Reveal delay={60}>
      <section id="newsletter" className="brand-soft-gradient mb-10 mt-14 rounded-3xl px-6 py-10 shadow-sm sm:px-10">
        <div className="grid items-center gap-6 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-extrabold leading-tight text-text-main">{s.newsletterTitle}</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-text-muted">
              {s.newsletterText}
            </p>
          </div>
          {/* Real subscribe form → POST /api/v1/public/newsletter
              (src/newsletter). Renders its own success/error states. */}
          <NewsletterForm source="homepage" />
        </div>
      </section>
      </Reveal>
    </main>
  );
}
