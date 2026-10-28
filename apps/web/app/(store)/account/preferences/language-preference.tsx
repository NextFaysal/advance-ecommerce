"use client";

/**
 * Language preference control (doc 30) — the signed-in customer's own
 * language choice on /account/preferences.
 *
 * Reads the active locale from the root LocaleProvider and switches
 * it via setLocale, which persists the choice (cookie + localStorage)
 * so the whole store — server-rendered surfaces included — follows.
 * Option labels are each locale's own name (LOCALE_SELF_NAMES), the
 * one string that is intentionally identical in both languages.
 */
import { useLocale } from "@/i18n/LocaleProvider";
import { LOCALES, LOCALE_SELF_NAMES, pick } from "@/i18n/locale";
import { ACCOUNT_STRINGS } from "../strings";

export default function LanguagePreference() {
  const { locale, setLocale, t: common } = useLocale();
  const s = pick(locale, ACCOUNT_STRINGS);

  return (
    <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">
      <h2 className="text-base font-bold text-text-main">{s.languagePreference}</h2>
      <p className="mt-1 text-sm leading-6 text-text-muted">{s.languagePreferenceDesc}</p>
      <div
        className="mt-4 flex flex-wrap gap-2"
        role="radiogroup"
        aria-label={common.language}
      >
        {LOCALES.map((option) => {
          const selected = locale === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setLocale(option)}
              className={`min-h-11 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                selected
                  ? "border-brand-500 bg-brand-soft text-brand-ink ring-1 ring-brand-500"
                  : "border-border text-text-main hover:bg-surface-2"
              }`}
            >
              {LOCALE_SELF_NAMES[option]}
              {selected ? (
                <span className="ml-2 text-xs font-semibold">{s.activeLabel}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
