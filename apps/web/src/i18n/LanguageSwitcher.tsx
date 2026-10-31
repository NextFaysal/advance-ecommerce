"use client";

/**
 * Unified language system (doc 30) — the visitor/staff language picker.
 *
 * A segmented বাংলা | English control. Choosing a language persists it
 * (cookie + localStorage via useLocale().setLocale) and refreshes the
 * route so SERVER components re-render too — they resolve the locale
 * from the `ae-locale` cookie (getRequestLocale), so after the refresh
 * the whole page, not just client islands, is in the chosen language.
 */
import { useRouter } from "next/navigation";
import { LOCALES, LOCALE_SELF_NAMES, type Locale } from "./locale";
import { useLocale } from "./LocaleProvider";

export function LanguageSwitcher({ className = "" }: { className?: string }) {
  const { locale, setLocale, t } = useLocale();
  const router = useRouter();

  function choose(next: Locale) {
    if (next === locale) return;
    setLocale(next);
    router.refresh();
  }

  return (
    <div
      role="group"
      aria-label={t.language}
      className={`inline-flex items-center rounded-full border border-border bg-card p-0.5 text-sm shadow-sm ${className}`}
    >
      {LOCALES.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => choose(option)}
          aria-pressed={option === locale}
          className={`min-h-[32px] rounded-full px-3 font-medium transition motion-fast ${
            option === locale
              ? "bg-brand-600 text-white shadow"
              : "text-text-muted hover:text-text-main"
          }`}
        >
          {LOCALE_SELF_NAMES[option]}
        </button>
      ))}
    </div>
  );
}
