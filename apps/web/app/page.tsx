import type { Metadata } from "next";
import Link from "next/link";
import { ProductCard } from "@/catalog/ProductCard";
import { listActivePublicProducts, listCategories } from "@/catalog/server-read";
import type { Category } from "@/catalog/types";
import { Reveal } from "@/components/ui/reveal";
import { CountUp } from "@/components/ui/count-up";
import { NewsletterForm } from "@/newsletter/components/NewsletterForm";
import { FlashSaleCountdownSection } from "@/marketing/flash-sale-section";
import { HeroSlides } from "@/cms/HeroSlides";
import { getActiveHeroSlides } from "@/cms/site-content";
import { marketingMechanicsEnabled } from "@/marketing/docs";
import { getRunningHeroExperiment } from "@/marketing/experiments";
import { HeroExperiment } from "@/marketing/components/HeroExperiment";
import { SpinWheelSection } from "@/marketing/components/SpinWheelSection";
import { RecentOrdersSection } from "@/marketing/components/RecentOrdersSection";
import { VisitorIdBootstrap } from "@/marketing/components/VisitorIdBootstrap";
import { listHomepageReviews } from "@/reviews/store";
import { Stars } from "@/reviews/components/Stars";

// NOTE on route groups: Next.js forbids both app/page.tsx and app/(store)/page.tsx
// (both map to "/"). So the storefront home lives HERE, and only shop/product/search
// live under app/(store)/. This file is the Step 11 home skeleton.
// Data: real catalog DB via src/catalog/server-read (ACTIVE products +
// live categories). An empty DB renders honest empty states — no mock data.
// Design refresh (Direction A — Premium): editorial hero, trust row,
// tinted category tiles, flash-sale + featured rails, inverse "why us"
// band, testimonials, newsletter. Sections with no data hide themselves
// entirely — the homepage never shows a bare empty box.
// Wave 46: statically rendered with ISR (revalidate 60s) — the two
// per-visitor personalisations that forced force-dynamic moved
// client-side: the hero A/B variant (HeroExperiment component +
// /api/v1/public/experiments/hero) and the spin wheel's signed-in
// state (SpinWheelWidget resolves /account/me on mount).
export const revalidate = 60;

export const metadata: Metadata = {
  title: "Advance Ecommerce — বাংলাদেশের অনলাইন শপ",
  description: "ফ্যাশন, ইলেকট্রনিক্স ও আরও অনেক কিছু — সারাদেশে হোম ডেলিভারি, ক্যাশ অন ডেলিভারি।",
  openGraph: {
    title: "Advance Ecommerce",
    description: "বাংলাদেশের অনলাইন শপ — হোম ডেলিভারি, COD।",
    type: "website",
  },
};

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
      <div>
        <p className={`text-xs font-bold ${inverse ? "text-brand-300" : "text-brand-600"}`}>
          {eyebrow}
        </p>
        <h2 className={`mt-1 text-2xl font-extrabold leading-tight ${inverse ? "text-white" : "text-text-main"}`}>
          {title}
        </h2>
      </div>
      {href && linkLabel ? (
        <Link
          href={href}
          className={`text-sm font-semibold hover:underline ${inverse ? "text-brand-200" : "text-brand-700"}`}
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

function CategoryTile({ category, index }: { category: Category; index: number }) {
  const tint = CATEGORY_TINTS[index % CATEGORY_TINTS.length];
  return (
    <Link
      href={`/shop?category=${category.slug}`}
      className={`group flex items-center gap-3.5 rounded-2xl p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${tint.bg}`}
    >
      {category.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={category.imageUrl}
          alt={category.name.bn}
          loading="lazy"
          className="h-12 w-12 shrink-0 rounded-xl object-cover"
        />
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/80 text-lg font-extrabold text-text-main shadow-sm">
          {category.name.bn.charAt(0)}
        </span>
      )}
      <span className="min-w-0">
        <span className={`block truncate text-[15px] font-bold ${tint.fg}`}>{category.name.bn}</span>
        <span className="mt-0.5 block text-xs text-text-muted">{category.productCount}টি পণ্য</span>
      </span>
    </Link>
  );
}

const TRUST_ITEMS = [
  {
    icon: <CashIcon />,
    title: "ক্যাশ অন ডেলিভারি",
    text: "পণ্য হাতে পেয়ে নিশ্চিন্তে মূল্য পরিশোধ করুন।",
  },
  {
    icon: <TruckIcon />,
    title: "সারাদেশে হোম ডেলিভারি",
    text: "ঢাকা থেকে জেলা-উপজেলা — ঘরে বসেই পণ্য পৌঁছে যাবে।",
  },
  {
    icon: <ReturnIcon />,
    title: "সহজ রিটার্ন",
    text: "পণ্যে সমস্যা থাকলে সহজ শর্তে রিটার্ন ও রিফান্ড।",
  },
  {
    icon: <ShieldIcon />,
    title: "১০০% অরিজিনাল পণ্য",
    text: "প্রতিটি পণ্য যাচাই করে তারপর আপনার কাছে পাঠাই।",
  },
] as const;

/* Hero right-column visual — layered brand cards over the aurora
   background (Design v3, A+); no fake products. Shared by the static
   hero and the CMS campaign slider (as its no-image fallback). */
function HeroVisual() {
  return (
    <div className="aurora relative hidden min-h-[320px] overflow-hidden rounded-3xl p-6 shadow-md lg:block" aria-hidden="true">
      <div className="absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/15" />
      <div className="absolute -bottom-14 -left-8 h-52 w-52 rounded-full bg-black/10" />
      <div className="relative flex h-full flex-col justify-between gap-4">
        <div className="w-56 rounded-2xl bg-white/95 p-4 shadow-lg">
          <p className="flex items-center gap-2 text-sm font-bold text-[#1F2037]">
            <span className="text-brand-600"><CashIcon size={20} /></span> ক্যাশ অন ডেলিভারি
          </p>
          <p className="mt-1 text-xs leading-5 text-[#5B5F7A]">পণ্য হাতে পেয়ে টাকা দিন — কোনো অগ্রিম ঝামেলা নেই।</p>
        </div>
        <div className="ml-auto w-60 rounded-2xl bg-white/95 p-4 shadow-lg">
          <p className="flex items-center gap-2 text-sm font-bold text-[#1F2037]">
            <span className="text-brand-600"><TruckIcon size={20} /></span> দ্রুত ডেলিভারি
          </p>
          <p className="mt-1 text-xs leading-5 text-[#5B5F7A]">সারাদেশের সব জেলায় নির্ভরযোগ্য কুরিয়ার পার্টনার।</p>
        </div>
        <div className="w-52 rounded-2xl bg-white/95 p-4 shadow-lg">
          <p className="flex items-center gap-2 text-sm font-bold text-[#1F2037]">
            <span className="text-brand-600"><ShieldIcon size={20} /></span> যাচাইকৃত মান
          </p>
          <p className="mt-1 text-xs leading-5 text-[#5B5F7A]">প্রতিটি অর্ডার পাঠানোর আগে মান যাচাই করা হয়।</p>
        </div>
      </div>
    </div>
  );
}

export default async function Home() {
  const [products, categories, heroSlides, customerReviews] = await Promise.all([
    listActivePublicProducts(8),
    listCategories(),
    // CMS hero campaign slides (Admin → Content). Fail-safe: the
    // store degrades to [] on any DB problem, and [] renders the
    // static hero below — byte-identical to the pre-CMS homepage.
    getActiveHeroSlides(),
    // "Customer words" = REAL approved product reviews (rating >= 4),
    // never written-in quotes. Fail-safe to [] — and [] renders no
    // section at all, exactly like the other data-driven sections.
    listHomepageReviews(6).catch(() => []),
  ]);
  // A/B hero experiment (ADV-18B): the per-visitor resolution now
  // happens client-side (HeroExperiment fetches
  // /api/v1/public/experiments/hero, which runs resolveHeroForVisitor
  // with the same exposure recording) so this page can render
  // statically. Server-side we only compute whether a variant COULD
  // apply: mechanics flag on AND a hero experiment running — the
  // running check needs no visitor id. Fail-safe to false.
  const mechanicsOn = marketingMechanicsEnabled();
  const experimentActive = mechanicsOn
    ? await getRunningHeroExperiment()
        .then((experiment) => experiment !== null)
        .catch(() => false)
    : false;
  // Real catalogue totals for the hero stat row (Design v3) — summed
  // from the same category fetch; the row hides when the store is empty.
  const totalProducts = categories.reduce((sum, c) => sum + c.productCount, 0);
  // Flash sale = products whose default purchasable variant carries a
  // compare-at price. Derived from the same fetch — no extra query.
  const flashProducts = products.filter((p) =>
    p.variants.some((v) => v.isActive && v.compareAtPoisha !== null && v.compareAtPoisha > v.pricePoisha),
  );

  // Real catalogue stats — animated counters (v3); hidden entirely
  // while the catalogue is empty. Used by both hero variants.
  const heroStats = totalProducts > 0 ? (
    <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4 border-t border-brand-100 pt-5">
      <div>
        <dd className="text-2xl font-extrabold tabular-nums text-text-main">
          <CountUp value={totalProducts} />+
        </dd>
        <dt className="mt-0.5 text-xs font-medium text-text-muted">পণ্যের কালেকশন</dt>
      </div>
      <div>
        <dd className="text-2xl font-extrabold tabular-nums text-text-main">
          <CountUp value={categories.length} />
        </dd>
        <dt className="mt-0.5 text-xs font-medium text-text-muted">ক্যাটাগরি</dt>
      </div>
      <div>
        <dd className="text-2xl font-extrabold tabular-nums text-text-main">
          <CountUp value={64} />
        </dd>
        <dt className="mt-0.5 text-xs font-medium text-text-muted">জেলায় হোম ডেলিভারি</dt>
      </div>
    </dl>
  ) : null;

  return (
    <main className="mx-auto min-w-0 max-w-[1440px] px-4 sm:px-6">
      {/* ---------- Hero ---------- */}
      {heroSlides.length > 0 ? (
        /* CMS campaign slides (Admin → Content) replace the static
           hero copy while at least one slide is active. The A/B
           override never applied while slides exist — unchanged. */
        <HeroSlides slides={heroSlides} visual={<HeroVisual />} stats={heroStats} />
      ) : (
      <section className="brand-soft-gradient mt-5 overflow-hidden rounded-3xl shadow-sm">
        <div className="grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-2 lg:p-12">
          <div className="min-w-0">
            {/* Static default copy; HeroExperiment swaps in the
                visitor's A/B variant client-side when a hero
                experiment is running. heroStats stays a
                server-rendered child. */}
            <HeroExperiment
              headline="সারাদেশে হোম ডেলিভারি, পছন্দের সব পণ্য"
              sub="ফ্যাশন, ইলেকট্রনিক্স, ঘরোয়া পণ্য ও আরও অনেক কিছু — যাচাই করা অরিজিনাল পণ্য, সেরা দামে, ঘরে বসে অর্ডার করুন বাংলায়।"
              ctaLabel="কেনাকাটা শুরু করুন"
              ctaHref="/shop"
              experimentActive={experimentActive}
            >
              {heroStats}
            </HeroExperiment>
          </div>

          <HeroVisual />
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
      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="আমাদের সুবিধা">
        {TRUST_ITEMS.map((item) => (
          <div key={item.title} className="flex gap-3.5 rounded-2xl border border-border bg-card p-4 shadow-sm">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
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
          <SectionHeading eyebrow="ক্যাটাগরি" title="পছন্দ অনুযায়ী কিনুন" href="/shop" linkLabel="সব পণ্য দেখুন" />
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {categories.map((c, i) => (
              <CategoryTile key={c.slug} category={c} index={i} />
            ))}
          </div>
        </section>
        </Reveal>
      ) : null}

      {/* ---------- Flash sale (only when discounted stock exists) ---------- */}
      {flashProducts.length > 0 ? (
        <Reveal delay={60}>
        <section className="mt-12">
          <SectionHeading eyebrow="সীমিত সময়ের অফার" title="ফ্ল্যাশ সেল" href="/shop" linkLabel="সব অফার দেখুন" />
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {flashProducts.slice(0, 4).map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
        </Reveal>
      ) : null}

      {/* ---------- Featured products ---------- */}
      {products.length > 0 ? (
        <Reveal delay={120}>
        <section className="mt-12">
          <SectionHeading eyebrow="বাছাই করা" title="জনপ্রিয় পণ্য" href="/shop" linkLabel="সব দেখুন" />
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {products.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
        </Reveal>
      ) : null}

      {/* ---------- Why us (inverse band) ---------- */}
      <Reveal delay={60}>
      <section className="mt-14 rounded-3xl bg-brand-900 px-6 py-10 shadow-md sm:px-10">
        <SectionHeading eyebrow="কেন আমরাই" title="আস্থার সাথে কেনাকাটা" inverse />
        <div className="mt-7 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST_ITEMS.map((item) => (
            <div key={item.title}>
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-brand-200">
                {item.icon}
              </span>
              <h3 className="mt-3 text-[15px] font-bold text-white">{item.title}</h3>
              <p className="mt-1 text-sm leading-6 text-brand-100/80">{item.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/shop"
            className="rounded-xl bg-white px-5 py-3 text-sm font-bold text-brand-800 shadow-sm transition hover:bg-brand-50"
          >
            এখনই কেনাকাটা করুন
          </Link>
          <Link
            href="/track"
            className="rounded-xl border border-white/30 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/10"
          >
            অর্ডার ট্র্যাক করুন
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
          <SectionHeading eyebrow="কাস্টমারদের কথা" title="যারা কিনেছেন, তারা বলছেন" />
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
                    {" "}— পণ্য:{" "}
                    <Link href={`/product/${r.productSlug}`} className="font-medium text-brand-700 hover:underline">
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
            <h2 className="text-2xl font-extrabold leading-tight text-text-main">অফারের খবর সবার আগে পান</h2>
            <p className="mt-2 max-w-md text-sm leading-6 text-text-muted">
              নতুন পণ্য, ফ্ল্যাশ সেল আর বিশেষ ছাড়ের খবর সরাসরি আপনার ইমেইলে। স্প্যাম পাঠাই না — শুধু দরকারি অফার।
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
