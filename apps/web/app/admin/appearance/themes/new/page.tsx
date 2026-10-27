"use client";

/**
 * Admin > Appearance > Themes > New — create theme page with Live Preview,
 * Smart Palette Generator, Presets, and JSON Import.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { defaultThemeTokens, THEME_TOKEN_GROUPS, THEME_TOKEN_META } from "@/lib/themes";
import type { ThemeTokens } from "@/lib/themes";
import { THEME_PRESETS } from "@/lib/theme-presets";
import { generateSmartPalette } from "@/lib/theme-palette-generator";
import { ThemeLivePreview } from "@/components/admin/theme-live-preview";
import { useLocale } from "@/i18n/LocaleProvider";
import { APPEARANCE_STRINGS, TOKEN_GROUP_LABELS, TOKEN_META_LABELS } from "../../strings";

export default function NewThemePage() {
  const router = useRouter();
  const { locale } = useLocale();
  const t = APPEARANCE_STRINGS[locale];
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tokens, setTokens] = useState<ThemeTokens>(defaultThemeTokens());
  const [primarySeedHex, setPrimarySeedHex] = useState("#4f46e5");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateLightToken(key: string, value: string) {
    setTokens((prev) => ({ ...prev, light: { ...prev.light, [key]: value } }));
  }

  function updateDarkToken(key: string, value: string) {
    setTokens((prev) => ({ ...prev, dark: { ...prev.dark, [key]: value } }));
  }

  // 1-Click Smart Generator
  function handleGeneratePalette() {
    const { tokens: newTokens } = generateSmartPalette(primarySeedHex);
    setTokens(newTokens);
  }

  // Preset Applicator
  function handleApplyPreset(presetId: string) {
    const preset = THEME_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setName(preset.name);
    setDescription(preset.description);
    setPrimarySeedHex(preset.primaryHex);
    setTokens(preset.tokens);
  }

  // JSON Import
  function handleJsonImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed.name) setName(parsed.name);
        if (parsed.description) setDescription(parsed.description);
        if (parsed.tokens?.light && parsed.tokens?.dark) {
          setTokens(parsed.tokens);
        }
      } catch {
        setError(t.badJson);
      }
    };
    reader.readAsText(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(t.nameRequired);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/themes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          preview: [
            tokens.light["--brand-gradient"] ? "#4f46e5" : "#6366f1",
            "#8b5cf6",
            "#ec4899",
          ],
          isActive: false,
          tokens,
        }),
      });
      const json = (await res.json()) as { data?: { id: string }; error?: { message: string } };
      if (!res.ok) {
        setError(json.error?.message ?? t.createFailed);
        return;
      }
      router.push("/admin/appearance/themes");
      router.refresh();
    } catch {
      setError(t.networkRetry);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/admin/appearance/themes" className="text-sm font-medium text-primary hover:underline">
            {t.backToList}
          </Link>
          <h1 className="mt-1 font-display text-2xl font-bold text-text-main">{t.newTitle}</h1>
          <p className="text-sm text-text-muted">{t.newSubtitle}</p>
        </div>

        {/* JSON Import button */}
        <label className="cursor-pointer inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3.5 py-2 text-xs font-semibold text-text-main shadow-sm hover:bg-muted">
          {t.importJson}
          <input type="file" accept=".json" onChange={handleJsonImport} className="hidden" />
        </label>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-destructive/20 bg-destructive/10 px-5 py-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Quick Starter Presets Bar */}
      <div className="mb-8 rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-text-muted">
          {t.presetsTitle}
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {THEME_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleApplyPreset(preset.id)}
              className="flex flex-col items-start rounded-xl border border-border/80 p-3 text-left transition hover:border-primary hover:bg-muted/60"
            >
              <div className="mb-2 flex gap-1">
                {preset.preview.map((c, i) => (
                  <span
                    key={i}
                    className="h-4 w-4 rounded-full border border-black/10"
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <span className="text-xs font-bold text-text-main">{preset.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main 2-Column Workspace */}
      <div className="grid gap-8 lg:grid-cols-12">
        {/* Left Form (7 cols) */}
        <div className="space-y-6 lg:col-span-7">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* General Info */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-bold text-text-main">{t.generalInfo}</h2>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-text-main">
                    {t.themeName} <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder={t.themeNamePlaceholder}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm text-text-main shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-text-main">{t.description}</label>
                  <input
                    type="text"
                    placeholder={t.descriptionPlaceholder}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm text-text-main shadow-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>
            </div>

            {/* Smart 1-Click Palette Generator */}
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-primary">{t.generatorTitle}</h3>
                  <p className="text-xs text-text-muted">{t.generatorDesc}</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={primarySeedHex}
                    onChange={(e) => setPrimarySeedHex(e.target.value)}
                    className="h-9 w-12 cursor-pointer rounded-lg border border-border bg-card p-0.5"
                  />
                  <button
                    type="button"
                    onClick={handleGeneratePalette}
                    className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm hover:opacity-90"
                  >
                    {t.generateSet}
                  </button>
                </div>
              </div>
            </div>

            {/* Full Token Groups Customizer */}
            <div className="space-y-4">
              <h2 className="text-sm font-bold text-text-main">{t.tokensTitle}</h2>
              {THEME_TOKEN_GROUPS.map((group) => (
                <div key={group.label} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                  <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-text-muted">
                    {TOKEN_GROUP_LABELS[locale][group.label] ?? group.label}
                  </h3>
                  <div className="space-y-3">
                    {group.tokens.map((tokenKey) => {
                      const meta = THEME_TOKEN_META[tokenKey];
                      return (
                        <div
                          key={tokenKey}
                          className="grid items-center gap-2 sm:grid-cols-12 text-xs border-b border-border/50 pb-2.5 last:border-0"
                        >
                          <div className="sm:col-span-4">
                            <span className="font-semibold text-text-main">{meta ? (TOKEN_META_LABELS[locale][meta.label] ?? meta.label) : tokenKey}</span>
                            <span className="block font-mono text-[10px] text-text-muted">{tokenKey}</span>
                          </div>
                          <div className="sm:col-span-4">
                            <span className="mb-0.5 block text-[10px] text-text-muted font-medium">{t.lightLabel}</span>
                            <input
                              type="text"
                              value={tokens.light[tokenKey] ?? ""}
                              onChange={(e) => updateLightToken(tokenKey, e.target.value)}
                              placeholder={meta?.lightDefault ?? ""}
                              className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-text-main shadow-sm focus:border-ring focus:outline-none"
                            />
                          </div>
                          <div className="sm:col-span-4">
                            <span className="mb-0.5 block text-[10px] text-text-muted font-medium">{t.darkLabel}</span>
                            <input
                              type="text"
                              value={tokens.dark[tokenKey] ?? ""}
                              onChange={(e) => updateDarkToken(tokenKey, e.target.value)}
                              placeholder={meta?.darkDefault ?? ""}
                              className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-text-main shadow-sm focus:border-ring focus:outline-none"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3 pt-4">
              <Link
                href="/admin/appearance/themes"
                className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-semibold text-text-main shadow-sm hover:bg-muted"
              >
                {t.cancel}
              </Link>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-xl bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? t.saving : t.createTheme}
              </button>
            </div>
          </form>
        </div>

        {/* Right Live Preview Sticky Panel (5 cols) */}
        <div className="lg:col-span-5">
          <ThemeLivePreview tokens={tokens} themeName={name} />
        </div>
      </div>
    </main>
  );
}
