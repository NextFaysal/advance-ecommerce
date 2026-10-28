"use client";

/**
 * /account/preferences — customer preferences page.
 *
 * Lets logged-in customers pick a custom store theme and their own
 * language (doc 30). Theme switching sets the selected_theme cookie
 * via the ThemeProvider hook; the language control
 * (language-preference.tsx) switches the root LocaleProvider, which
 * persists the choice (cookie + localStorage) store-wide.
 */
import { ThemeProvider, useTheme } from "@/components/ui/theme-provider";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { ACCOUNT_STRINGS } from "../strings";
import AccountNav from "../account-nav";
import LanguagePreference from "./language-preference";

function ThemeSelectorContent() {
  const { themeId, setTheme, themes, isLoading } = useTheme();
  const { locale } = useLocale();
  const s = pick(locale, ACCOUNT_STRINGS);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:py-10 lg:max-w-5xl">
      <h1 className="font-display text-2xl font-bold text-text-main">{s.themePreference}</h1>
      <p className="mt-1.5 text-sm leading-6 text-text-muted">
        {s.themePreferenceDesc}
      </p>

      <div className="lg:flex lg:items-start lg:gap-6">
        <AccountNav />
        <div className="min-w-0 flex-1">
      <LanguagePreference />

      <div className="mt-6 rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">
        {/* Default theme option */}
        <div className="mb-4">
          <button
            type="button"
            onClick={() => setTheme(null)}
            className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
              !themeId
                ? "border-brand-500 bg-brand-soft ring-1 ring-brand-500"
                : "border-border hover:bg-surface-2"
            }`}
          >
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                {["#6366f1", "#8b5cf6", "#ec4899"].map((c, i) => (
                  <span
                    key={i}
                    className="h-6 w-6 rounded-full border border-border/50"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div>
                <p className="text-sm font-semibold text-text-main">{s.defaultTheme}</p>
                <p className="text-xs text-text-muted">{s.defaultThemeDesc}</p>
              </div>
            </div>
            {!themeId && (
              <span className="text-xs font-semibold text-brand-ink">{s.activeLabel}</span>
            )}
          </button>
        </div>

        {isLoading && (
          <p className="py-4 text-center text-sm text-text-muted">{s.themesLoading}</p>
        )}

        {!isLoading && themes.length === 0 && (
          <p className="py-4 text-center text-sm text-text-muted">
            {s.noCustomThemes}
          </p>
        )}

        {themes.map((theme) => (
          <div key={theme.id} className="mb-3">
            <button
              type="button"
              onClick={() => setTheme(theme.id)}
              className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
                themeId === theme.id
                  ? "border-brand-500 bg-brand-soft ring-1 ring-brand-500"
                  : "border-border hover:bg-surface-2"
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5">
                  {(theme.preview.length > 0
                    ? theme.preview
                    : ["#6366f1", "#8b5cf6", "#ec4899"]
                  ).map((c, i) => (
                    <span
                      key={i}
                      className="h-6 w-6 rounded-full border border-border/50"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-main">{theme.name}</p>
                  {theme.description && (
                    <p className="text-xs text-text-muted">{theme.description}</p>
                  )}
                </div>
              </div>
              {themeId === theme.id && (
                <span className="text-xs font-semibold text-brand-ink">{s.activeLabel}</span>
              )}
            </button>
          </div>
        ))}
      </div>
        </div>
      </div>
    </main>
  );
}

export default function PreferencesPage() {
  return (
    <ThemeProvider>
      <ThemeSelectorContent />
    </ThemeProvider>
  );
}
