"use client";

/**
 * Circuit notice strip + utility cards (doc 27 T-D) — client
 * island. The utility cards are gated by the package's
 * `showUtilityCards` merchant option (read from the ThemeView
 * context — the section is client precisely so the server
 * composition stays option-free). The notice strip always renders:
 * it is layout, not an option.
 *
 * Copy is our own, and every claim is one the platform supports
 * generically — cash on delivery, nationwide home delivery, easy
 * returns, and warranty INFORMATION on the product page. The
 * warranty card deliberately promises information, not coverage:
 * whether a specific product carries a warranty is stated on that
 * product's own page, never here.
 */
import { Icon } from "@/components/ui/icon";
import { useThemeView } from "../theme-view";

const UTILITY_ITEMS = [
  { icon: "banknote", title: "ক্যাশ অন ডেলিভারি", text: "পণ্য হাতে পেয়ে মূল্য পরিশোধ করুন" },
  { icon: "truck", title: "সারাদেশে হোম ডেলিভারি", text: "জেলা-উপজেলার ঠিকানায় পৌঁছে দিই" },
  { icon: "rotate-ccw", title: "সহজ রিটার্ন", text: "পণ্যে সমস্যা থাকলে সহজ শর্তে রিটার্ন" },
  { icon: "shield", title: "পণ্যে ওয়ারেন্টি তথ্য", text: "ওয়ারেন্টি থাকলে পণ্যের পেজেই বিস্তারিত" },
] as const;

export default function CircuitHomeUtility() {
  const themeView = useThemeView();
  const showUtilityCards = themeView.options.showUtilityCards !== false;

  return (
    <>
      {/* Notice strip — our own service line. */}
      <div className="mt-5 flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-card">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-white">
          <Icon name="info" size={18} />
        </span>
        <p className="min-w-0 break-words text-sm leading-6 text-text-main">
          সারাদেশে ক্যাশ অন ডেলিভারি চালু আছে — অর্ডার করুন, পণ্য হাতে পেয়ে
          নিশ্চিন্তে মূল্য পরিশোধ করুন।
        </p>
      </div>

      {/* Utility cards — white cards, orange circular icons. */}
      {showUtilityCards ? (
        <section className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="আমাদের সুবিধা">
          {UTILITY_ITEMS.map((item) => (
            <div
              key={item.title}
              className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 shadow-card"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary text-white">
                <Icon name={item.icon} size={23} />
              </span>
              <span className="min-w-0">
                <span className="block break-words text-sm font-bold leading-snug text-text-main">
                  {item.title}
                </span>
                <span className="mt-0.5 hidden break-words text-xs leading-5 text-text-muted sm:block">
                  {item.text}
                </span>
              </span>
            </div>
          ))}
        </section>
      ) : null}
    </>
  );
}
