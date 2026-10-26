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
import { listHomepageReviews } from "@/reviews/store";
import { Stars } from "@/reviews/components/Stars";

export const dynamic = "force-dynamic";

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

function BoltIcon({ size = 26 }: { size?: number }) {
  return (
    <svg {...iconProps} width={size} height={size}>
      <path d="M13 2.5 4.5 13.5H11L9.8 21.5 18.5 10H12l1-7.5z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...iconProps} width="16" height="16" strokeWidth="2.2">
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </svg>
  );
}

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
    <div className="flex flex-wrap items-end justify-between gap-3 mb-1">
      <div>
        <p className={`text-xs font-bold uppercase tracking-wider ${inverse ? "text-primary-foreground/80" : "text-primary"}`}>
          {eyebrow}
        </p>
        <h2 className={`mt-1 text-2xl font-black tracking-tight sm:text-3xl ${inverse ? "text-white" : "text-text-main"}`}>
          {title}
        </h2>
      </div>
      {href && linkLabel ? (
        <Link
          href={href}
          className={`inline-flex items-center gap-1.5 text-sm font-bold transition hover:gap-2.5 ${
            inverse ? "text-white hover:text-white/80" : "text-primary hover:text-primary/80"
          }`}
        >
          {linkLabel} &rarr;
        </Link>
      ) : null}
    </div>
  );
}

const CATEGORY_TINTS: ReadonlyArray<{ bg: string; fg: string; border: string }> = [
  { bg: "bg-indigo-50/80 dark:bg-indigo-950/30", fg: "text-indigo-700 dark:text-indigo-300", border: "border-indigo-100 dark:border-indigo-900/50" },
  { bg: "bg-violet-50/80 dark:bg-violet-950/30", fg: "text-violet-700 dark:text-violet-300", border: "border-violet-100 dark:border-violet-900/50" },
  { bg: "bg-pink-50/80 dark:bg-pink-950/30", fg: "text-pink-700 dark:text-pink-300", border: "border-pink-100 dark:border-pink-900/50" },
  { bg: "bg-amber-50/80 dark:bg-amber-950/30", fg: "text-amber-700 dark:text-amber-300", border: "border-amber-100 dark:border-amber-900/50" },
  { bg: "bg-emerald-50/80 dark:bg-emerald-950/30", fg: "text-emerald-700 dark:text-emerald-300", border: "border-emerald-100 dark:border-emerald-900/50" },
  { bg: "bg-sky-50/80 dark:bg-sky-950/30", fg: "text-sky-700 dark:text-sky-300", border: "border-sky-100 dark:border-sky-900/50" },
  { bg: "bg-rose-50/80 dark:bg-rose-950/30", fg: "text-rose-700 dark:text-rose-300", border: "border-rose-100 dark:border-rose-900/50" },
  { bg: "bg-teal-50/80 dark:bg-teal-950/30", fg: "text-teal-700 dark:text-teal-300", border: "border-teal-100 dark:border-teal-900/50" },
];

function CategoryTile({ category, index }: { category: Category; index: number }) {
  const tint = CATEGORY_TINTS[index % CATEGORY_TINTS.length];
  return (
    <Link
      href={`/shop?category=${category.slug}`}
      className={`group flex items-center gap-3.5 rounded-2xl p-4 border transition-all duration-300 hover:-translate-y-1 hover:shadow-lg min-w-[210px] sm:min-w-0 flex-shrink-0 snap-start ${tint.bg} ${tint.border}`}
    >
      {category.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={category.imageUrl}
          alt={category.name.bn}
          loading="lazy"
          className="h-13 w-13 shrink-0 rounded-2xl object-cover shadow-sm transition-transform duration-300 group-hover:scale-105"
        />
      ) : (
        <span className="flex h-13 w-13 shrink-0 items-center justify-center rounded-2xl bg-white/90 dark:bg-card text-lg font-black text-primary shadow-sm">
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
    title: "সারাদেশে দ্রুত ডেলিভারি",
    text: "ঢাকা থেকে জেলা-উপজেলা — ঘরে বসেই পণ্য পৌঁছে যাবে।",
  },
  {
    icon: <ReturnIcon />,
    title: "সহজ রিটার্ন সুবিধা",
    text: "পণ্যে সমস্যা থাকলে সহজ শর্তে রিটার্ন ও রিফান্ড।",
  },
  {
    icon: <ShieldIcon />,
    title: "১০০% অরিজিনাল পণ্য",
    text: "প্রতিটি পণ্য মান যাচাই করে তারপর আপনার কাছে পাঠাই।",
  },
] as const;

function HeroVisual() {
  return (
    <div className="relative hidden min-h-[360px] overflow-hidden rounded-3xl p-8 shadow-xl lg:flex flex-col justify-between bg-gradient-to-br from-primary/90 via-primary to-accent/90 text-white" aria-hidden="true">
      {/* Decorative ambient orbs */}
      <div className="absolute -right-12 -top-12 h-64 w-64 rounded-full bg-white/20 blur-2xl pointer-events-none" />
      <div className="absolute -bottom-16 -left-12 h-64 w-64 rounded-full bg-black/20 blur-2xl pointer-events-none" />

      <div className="relative flex h-full flex-col justify-between gap-5 z-10">
        <div className="w-64 rounded-2xl bg-white/95 backdrop-blur-md p-4 shadow-xl border border-white/40 transform hover:-translate-y-1 transition duration-300">
          <p className="flex items-center gap-2.5 text-sm font-extrabold text-[#1F2037]">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CashIcon size={18} />
            </span>
            ক্যাশ অন ডেলিভারি
          </p>
          <p className="mt-1 text-xs leading-5 text-[#5B5F7A]">পণ্য হাতে পেয়ে টাকা দিন — কোনো অগ্রিম টাকা লাগবে না।</p>
        </div>

        <div className="ml-auto w-64 rounded-2xl bg-white/95 backdrop-blur-md p-4 shadow-xl border border-white/40 transform hover:-translate-y-1 transition duration-300">
          <p className="flex items-center gap-2.5 text-sm font-extrabold text-[#1F2037]">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <TruckIcon size={18} />
            </span>
            ২৪-৭২ ঘণ্টায় ডেলিভারি
          </p>
          <p className="mt-1 text-xs leading-5 text-[#5B5F7A]">সারাদেশের ৬৪ জেলায় নির্ভরযোগ্য কুরিয়ার পার্টনার।</p>
        </div>

        <div className="w-64 rounded-2xl bg-white/95 backdrop-blur-md p-4 shadow-xl border border-white/40 transform hover:-translate-y-1 transition duration-300">
          <p className="flex items-center gap-2.5 text-sm font-extrabold text-[#1F2037]">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ShieldIcon size={18} />
            </span>
            ১০০% আসল পণ্যের নিশ্চয়তা
          </p>
          <p className="mt-1 text-xs leading-5 text-[#5B5F7A]">প্রতিটি অর্ডার প্যাকিংয়ের আগে ডাবল-চেক করা হয়।</p>
        </div>
      </div>
    </div>
  );
}

export default async function Home() {
  const [products, categories, heroSlides, customerReviews] = await Promise.all([
    listActivePublicProducts(8),
    listCategories(),
    getActiveHeroSlides(),
    listHomepageReviews(6).catch(() => []),
  ]);

  const totalProducts = categories.reduce((sum, c) => sum + c.productCount, 0);
  const flashProducts = products.filter((p) =>
    p.variants.some((v) => v.isActive && v.compareAtPoisha !== null && v.compareAtPoisha > v.pricePoisha),
  );

  const heroStats = totalProducts > 0 ? (
    <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4 border-t border-border/80 pt-6">
      <div>
        <dd className="text-3xl font-black tabular-nums text-text-main">
          <CountUp value={totalProducts} />+
        </dd>
        <dt className="mt-0.5 text-xs font-semibold text-text-muted">পণ্যের কালেকশন</dt>
      </div>
      <div>
        <dd className="text-3xl font-black tabular-nums text-text-main">
          <CountUp value={categories.length} />
        </dd>
        <dt className="mt-0.5 text-xs font-semibold text-text-muted">ক্যাটাগরি</dt>
      </div>
      <div>
        <dd className="text-3xl font-black tabular-nums text-text-main">
          <CountUp value={64} />
        </dd>
        <dt className="mt-0.5 text-xs font-semibold text-text-muted">জেলায় ডেলিভারি</dt>
      </div>
    </dl>
  ) : null;

  return (
    <main className="mx-auto min-w-0 max-w-[1440px] px-4 sm:px-6 space-y-12 pb-16">
      {/* ---------- Hero Section ---------- */}
      {heroSlides.length > 0 ? (
        <HeroSlides slides={heroSlides} visual={<HeroVisual />} stats={heroStats} />
      ) : (
        <section className="relative mt-4 overflow-hidden rounded-3xl bg-gradient-to-br from-primary/10 via-surface to-accent/10 border border-border/70 p-6 sm:p-10 lg:p-14 shadow-sm">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div className="min-w-0 z-10">
              <span className="inline-flex items-center gap-2 rounded-full bg-white dark:bg-card px-3.5 py-1.5 text-xs font-bold text-primary shadow-sm border border-border/50">
                <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                বাংলাদেশের নিজস্ব স্মার্ট শপিং প্ল্যাটফর্ম
              </span>
              <h1 className="mt-5 break-words text-4xl font-black leading-[1.15] text-text-main sm:text-5xl lg:text-6xl tracking-tight">
                সারাদেশে হোম ডেলিভারি,
                <span className="bg-gradient-to-r from-primary via-purple-600 to-pink-600 bg-clip-text text-transparent block sm:inline"> সেরা মূল্যে কেনাকাটা</span>
              </h1>
              <p className="mt-5 max-w-xl text-[15px] sm:text-base leading-7 text-text-muted">
                ফ্যাশন, ইলেকট্রনিক্স, রূপচর্চা ও নিত্যপ্রয়োজনীয় পণ্য — নিশ্চিন্ত ক্যাশ অন ডেলিভারিতে সরাসরি আপনার ঠিকানায় পৌঁছে দিচ্ছি আমরা।
              </p>
              <div className="mt-8 flex flex-wrap gap-3.5">
                <Link
                  href="/shop"
                  className="rounded-2xl bg-primary px-7 py-4 text-[15px] font-bold text-white shadow-lg shadow-primary/25 transition-all duration-200 hover:shadow-xl hover:opacity-95 active:scale-95"
                >
                  কেনাকাটা শুরু করুন &rarr;
                </Link>
                <Link
                  href="/shop?sort=newest"
                  className="rounded-2xl border border-border/90 bg-card px-7 py-4 text-[15px] font-bold text-text-main shadow-sm transition-all duration-200 hover:bg-surface-2 active:scale-95"
                >
                  নতুন কালেকশন
                </Link>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs font-semibold text-text-muted">
                <li className="flex items-center gap-1.5">
                  <span className="text-emerald-600"><CheckIcon /></span> ক্যাশ অন ডেলিভারি (COD)
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-emerald-600"><CheckIcon /></span> ৭ দিনে সহজ রিটার্ন
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="text-emerald-600"><CheckIcon /></span> ১০০% যাচাইকৃত আসল পণ্য
                </li>
              </ul>

              {heroStats}
            </div>

            <HeroVisual />
          </div>
        </section>
      )}

      {/* ---------- Flash Sale Banner Countdown ---------- */}
      <FlashSaleCountdownSection />

      {/* ---------- Trust Badges Grid ---------- */}
      <Reveal delay={60}>
        <section className="grid grid-cols-2 gap-3.5 lg:grid-cols-4" aria-label="আমাদের সুবিধা">
          {TRUST_ITEMS.map((item) => (
            <div
              key={item.title}
              className="group flex gap-3.5 rounded-2xl border border-border/80 bg-card p-4.5 shadow-sm transition-all duration-200 hover:border-primary/40 hover:shadow-md"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-transform duration-200 group-hover:scale-105">
                {item.icon}
              </span>
              <span className="min-w-0">
                <span className="block break-words text-sm font-bold leading-snug text-text-main">{item.title}</span>
                <span className="mt-1 hidden break-words text-xs leading-5 text-text-muted sm:block">{item.text}</span>
              </span>
            </div>
          ))}
        </section>
      </Reveal>

      {/* ---------- Categories Carousel / Grid ---------- */}
      {categories.length > 0 ? (
        <Reveal delay={100}>
          <section>
            <SectionHeading eyebrow="ক্যাটাগরি" title="পছন্দ অনুযায়ী কিনুন" href="/shop" linkLabel="সব পণ্য দেখুন" />
            <div className="mt-5 flex gap-3.5 overflow-x-auto pb-4 pt-1 snap-x no-scrollbar sm:grid sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 sm:overflow-visible">
              {categories.map((c, i) => (
                <CategoryTile key={c.slug} category={c} index={i} />
              ))}
            </div>
          </section>
        </Reveal>
      ) : null}

      {/* ---------- Flash Sale Grid ---------- */}
      {flashProducts.length > 0 ? (
        <Reveal delay={100}>
          <section>
            <SectionHeading eyebrow="সীমিত সময়ের অফার" title="🔥 ফ্ল্যাশ সেল ও ডিসকাউন্ট" href="/shop" linkLabel="সব অফার দেখুন" />
            <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
              {flashProducts.slice(0, 4).map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        </Reveal>
      ) : null}

      {/* ---------- Popular Products Grid ---------- */}
      {products.length > 0 ? (
        <Reveal delay={100}>
          <section>
            <SectionHeading eyebrow="জনপ্রিয় চয়েস" title="আমাদের সেরা কালেকশন" href="/shop" linkLabel="সব দেখুন" />
            <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </section>
        </Reveal>
      ) : null}

      {/* ---------- Why Choose Us Banner ---------- */}
      <Reveal delay={60}>
        <section className="rounded-3xl bg-gradient-to-br from-primary via-indigo-900 to-purple-950 px-6 py-12 shadow-xl sm:px-12 text-white">
          <SectionHeading eyebrow="আমাদের বিশেষত্ব" title="আস্থার সাথে কেনাকাটা করুন" inverse />
          <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST_ITEMS.map((item) => (
              <div key={item.title} className="rounded-2xl bg-white/10 backdrop-blur-md p-5 border border-white/10 hover:bg-white/15 transition duration-200">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20 text-white">
                  {item.icon}
                </span>
                <h3 className="mt-3.5 text-base font-bold">{item.title}</h3>
                <p className="mt-1.5 text-xs leading-6 text-white/80">{item.text}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/shop"
              className="rounded-xl bg-white px-6 py-3 text-sm font-bold text-primary shadow-md transition hover:bg-slate-100"
            >
              এখনই অর্ডার করুন
            </Link>
            <Link
              href="/track"
              className="rounded-xl border border-white/40 px-6 py-3 text-sm font-bold text-white transition hover:bg-white/10"
            >
              অর্ডার ট্র্যাক করুন
            </Link>
          </div>
        </section>
      </Reveal>

      {/* ---------- Real Customer Reviews ---------- */}
      {customerReviews.length > 0 ? (
        <Reveal delay={100}>
          <section>
            <SectionHeading eyebrow="গ্রাহকদের প্রতিক্রিয়া" title="যাচাইকৃত কাস্টমার রিভিউ" />
            <div className="mt-5 grid gap-4 md:grid-cols-3">
              {customerReviews.map((r) => (
                <figure key={r.id} className="rounded-2xl border border-border/80 bg-card p-6 shadow-sm hover:shadow-md transition">
                  <Stars rating={r.rating} />
                  <blockquote className="mt-3 break-words text-sm leading-7 text-text-main">
                    “{r.body}”
                  </blockquote>
                  <figcaption className="mt-4 pt-3 border-t border-border/60 text-xs">
                    <span className="font-bold text-text-main">{r.authorName}</span>
                    <span className="text-text-subtle">
                      {" "}— পণ্য:{" "}
                      <Link href={`/product/${r.productSlug}`} className="font-semibold text-primary hover:underline">
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

      {/* ---------- Newsletter Subscription Card ---------- */}
      <Reveal delay={60}>
        <section id="newsletter" className="rounded-3xl bg-gradient-to-r from-primary/10 via-surface to-accent/10 border border-border/80 p-8 sm:p-12 shadow-sm">
          <div className="grid items-center gap-8 lg:grid-cols-2">
            <div>
              <span className="text-xs font-bold text-primary uppercase tracking-wider">নিউজলেটার সাবস্ক্রিপশন</span>
              <h2 className="mt-1 text-2xl sm:text-3xl font-black text-text-main">বিশেষ অফার ও ডিসকাউন্টের খবর সবার আগে পান</h2>
              <p className="mt-2 text-sm leading-6 text-text-muted">
                নতুন কালেকশন, ফ্ল্যাশ সেল আর সারপ্রাইজ গিফটের তথ্য সরাসরি আপনার ইনবক্সে। কোনো স্প্যাম নেই।
              </p>
            </div>
            <NewsletterForm source="homepage" />
          </div>
        </section>
      </Reveal>
    </main>
  );
}
