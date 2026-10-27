"use client";

/**
 * Admin > Appearance > Themes > [id] — edit theme page with Live Preview,
 * Smart Generator, JSON Export, and Theme Duplication.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { THEME_TOKEN_GROUPS, THEME_TOKEN_META } from "@/lib/themes";
import type { AppTheme, ThemeTokens } from "@/lib/themes";
import { generateSmartPalette } from "@/lib/theme-palette-generator";
import { ThemeLivePreview } from "@/components/admin/theme-live-preview";
import type { ThemeOptionField, ThemeOptions } from "@/themes/registry";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, type Locale } from "@/i18n/locale";
import { APPEARANCE_STRINGS, TOKEN_GROUP_LABELS, TOKEN_META_LABELS, type AppearanceStrings } from "../../strings";

/* ------------------------------------------------------------------ */
/* Customizer-lite (wave S2) — the package options form.              */
/*                                                                    */
/* Fully schema-driven: fields render from the instance's package   */
/* optionsSchema returned by GET /api/v1/admin/themes/[id]/options, */
/* and saves go back through the same route's PUT (reason mandatory, */
/* audited server-side). No per-package form code exists — a package */
/* with a schema (first: Ghorer, S4) gets a working form for free.   */
/* ------------------------------------------------------------------ */

interface ThemeOptionsData {
  packageId: string;
  schema: ThemeOptionField[];
  values: ThemeOptions;
  stored: ThemeOptions;
}

function fieldLabel(field: ThemeOptionField, locale: Locale): string {
  return locale === "bn" ? (field.labelBn ?? field.label) : field.label;
}

function ThemeCustomizerSection({ themeId, t, locale }: { themeId: string; t: AppearanceStrings; locale: Locale }) {
  const [data, setData] = useState<ThemeOptionsData | null>(null);
  const [values, setValues] = useState<ThemeOptions>({});
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveDetails, setSaveDetails] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/admin/themes/${themeId}/options`)
      .then((r) => r.json())
      .then(
        (json: { data?: ThemeOptionsData; error?: { message: string } }) => {
          if (json.error) {
            setLoadError(json.error.message);
          } else if (json.data) {
            setData(json.data);
            setValues(json.data.values);
          }
        },
      )
      .catch(() => setLoadError(t.optionsLoadFailed))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId]);

  function setValue(key: string, value: string | number | boolean) {
    setValues((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    if (!data) return;
    // Local guard: a number field left blank would fail server-side
    // validation anyway — catch it here with a clearer message.
    for (const field of data.schema) {
      if (field.type === "number" && values[field.key] === "") {
        setSaveError(interpolate(t.numberRequired, { label: fieldLabel(field, locale) }));
        setSaveDetails([]);
        return;
      }
    }
    if (reason.trim() === "") {
      setSaveError(t.reasonRequired);
      setSaveDetails([]);
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSaveDetails([]);
    setSaved(false);
    try {
      const res = await fetch(`/api/v1/admin/themes/${themeId}/options`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values, reason: reason.trim() }),
      });
      const json = (await res.json().catch(() => null)) as {
        data?: ThemeOptionsData;
        error?: { message: string; details?: unknown };
      } | null;
      if (!res.ok) {
        setSaveError(json?.error?.message ?? t.optionsSaveFailed);
        if (Array.isArray(json?.error?.details)) {
          setSaveDetails(json.error.details.map(String));
        }
        return;
      }
      if (json?.data) {
        setData(json.data);
        setValues(json.data.values);
      }
      setReason("");
      setSaved(true);
    } catch {
      setSaveError(t.networkRetry);
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs text-text-main shadow-sm focus:border-ring focus:outline-none";

  function renderField(field: ThemeOptionField) {
    const value = values[field.key];
    const label = fieldLabel(field, locale);
    return (
      <div
        key={field.key}
        className="grid items-center gap-2 border-b border-border/50 pb-3 text-xs last:border-0 sm:grid-cols-12"
      >
        <div className="sm:col-span-5">
          <span className="font-semibold text-text-main">{label}</span>
          <span className="block font-mono text-[10px] text-text-muted">{field.key}</span>
        </div>
        <div className="sm:col-span-7">
          {field.type === "boolean" && (
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={value === true}
                onChange={(e) => setValue(field.key, e.target.checked)}
                className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
              />
              <span className="font-medium text-text-main">
                {value === true ? t.onWord : t.offWord}
              </span>
            </label>
          )}
          {field.type === "select" && (
            <select
              value={typeof value === "string" ? value : field.default}
              onChange={(e) => setValue(field.key, e.target.value)}
              className={inputClass}
            >
              {field.choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          )}
          {field.type === "number" && (
            <input
              type="number"
              min={field.min}
              max={field.max}
              step="any"
              value={value === undefined ? "" : String(value)}
              onChange={(e) =>
                setValue(field.key, e.target.value === "" ? "" : Number(e.target.value))
              }
              className={inputClass}
            />
          )}
          {field.type === "color" && (
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={
                  typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
                    ? value
                    : "#000000"
                }
                onChange={(e) => setValue(field.key, e.target.value)}
                className="h-8 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-card p-0.5"
              />
              <input
                type="text"
                value={typeof value === "string" ? value : ""}
                onChange={(e) => setValue(field.key, e.target.value)}
                placeholder={field.default}
                className={`${inputClass} font-mono`}
              />
            </div>
          )}
          {field.type === "text" && (
            <input
              type="text"
              maxLength={field.maxLength}
              value={typeof value === "string" ? value : ""}
              onChange={(e) => setValue(field.key, e.target.value)}
              placeholder={field.default}
              className={inputClass}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="text-sm font-bold text-text-main">{t.customizerTitle}</h2>
      {data && (
        <p className="mt-1 text-[11px] leading-4 text-text-muted">
          {t.customizerDescA}
          <span className="font-mono font-semibold">{data.packageId}</span>
          {t.customizerDescB}
        </p>
      )}

      {loading && <p className="mt-4 text-xs text-text-muted">{t.optionsLoading}</p>}

      {loadError && (
        <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          {loadError}
        </div>
      )}

      {!loading && !loadError && data && data.schema.length === 0 && (
        <div className="mt-4 rounded-xl border border-border/60 bg-muted/50 px-4 py-3">
          <p className="text-xs font-semibold text-text-main">{t.noOptionsTitle}</p>
          <p className="mt-1 text-[11px] leading-4 text-text-muted">{t.noOptionsDesc}</p>
        </div>
      )}

      {!loading && !loadError && data && data.schema.length > 0 && (
        <div className="mt-4">
          <div className="space-y-3">{data.schema.map(renderField)}</div>

          {saveError && (
            <div className="mt-4 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-xs text-destructive">
              {saveError}
              {saveDetails.length > 0 && (
                <ul className="mt-1 list-inside list-disc">
                  {saveDetails.map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {saved && (
            <div className="mt-4 rounded-xl border border-success/20 bg-success/10 px-4 py-3 text-xs text-success">
              {t.optionsSaved}
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t.reasonPlaceholderRequired}
              className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs text-text-main shadow-sm focus:border-ring focus:outline-none"
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {saving ? t.saving : t.saveOptions}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  params: { id: string };
}

export default function EditThemePage({ params }: Props) {
  const { id } = params;
  const router = useRouter();
  const { locale } = useLocale();
  const t = APPEARANCE_STRINGS[locale];

  const [theme, setTheme] = useState<AppTheme | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(false);
  const [tokens, setTokens] = useState<ThemeTokens>({ light: {}, dark: {} });
  const [primarySeedHex, setPrimarySeedHex] = useState("#4f46e5");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/admin/themes`)
      .then((r) => r.json())
      .then((json: { data?: AppTheme[] }) => {
        const found = json.data?.find((th) => th.id === id) ?? null;
        if (found) {
          setTheme(found);
          setName(found.name);
          setDescription(found.description ?? "");
          setIsActive(found.isActive);
          setTokens(found.tokens);
        }
      })
      .catch(() => setError(t.loadThemeFailed))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function updateLightToken(key: string, value: string) {
    setTokens((prev) => ({ ...prev, light: { ...prev.light, [key]: value } }));
  }

  function updateDarkToken(key: string, value: string) {
    setTokens((prev) => ({ ...prev, dark: { ...prev.dark, [key]: value } }));
  }

  function handleGeneratePalette() {
    const { tokens: newTokens } = generateSmartPalette(primarySeedHex);
    setTokens(newTokens);
  }

  // Export Theme as JSON
  function handleExportJson() {
    if (!theme) return;
    const exportData = {
      name,
      description,
      tokens,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-theme.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Clone/Duplicate Theme
  async function handleDuplicate() {
    setCloning(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/themes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${name}${t.copySuffix}`,
          description: description || undefined,
          preview: theme?.preview ?? ["#6366f1", "#8b5cf6", "#ec4899"],
          isActive: false,
          tokens,
        }),
      });
      const json = (await res.json()) as { data?: { id: string }; error?: { message: string } };
      if (!res.ok) {
        setError(json.error?.message ?? t.cloneFailed);
        return;
      }
      router.push("/admin/appearance/themes");
      router.refresh();
    } catch {
      setError(t.networkRetry);
    } finally {
      setCloning(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(t.nameRequired);
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch(`/api/v1/admin/themes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          isActive,
          tokens,
        }),
      });
      const json = (await res.json()) as { error?: { message: string } };
      if (!res.ok) {
        setError(json.error?.message ?? t.saveFailed);
        return;
      }
      setSuccess(true);
      router.refresh();
    } catch {
      setError(t.networkError);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!confirm(t.deleteConfirm)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/admin/themes/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError(t.deleteFailed);
        return;
      }
      router.push("/admin/appearance/themes");
      router.refresh();
    } catch {
      setError(t.networkError);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-8">
        <p className="text-sm text-text-muted">{t.loadingThemes}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/admin/appearance/themes" className="text-sm font-medium text-primary hover:underline">
            {t.backToList}
          </Link>
          <h1 className="mt-1 font-display text-2xl font-bold text-text-main">
            {interpolate(t.editTitle, { name: name || t.themeFallback })}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Export JSON */}
          <button
            type="button"
            onClick={handleExportJson}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-text-main shadow-sm hover:bg-muted"
          >
            {t.exportJson}
          </button>

          {/* Clone / Duplicate */}
          <button
            type="button"
            onClick={handleDuplicate}
            disabled={cloning}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-text-main shadow-sm hover:bg-muted disabled:opacity-50"
          >
            {cloning ? t.cloning : t.duplicate}
          </button>

          {/* Delete */}
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-50"
          >
            {deleting ? t.deleting : t.deleteBtn}
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-xl border border-destructive/20 bg-destructive/10 px-5 py-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-6 rounded-xl border border-success/20 bg-success/10 px-5 py-4 text-sm text-success">
          {t.savedNote}
        </div>
      )}

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
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm text-text-main shadow-sm focus:border-ring focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-text-main">{t.description}</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm text-text-main shadow-sm focus:border-ring focus:outline-none"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
                  />
                  <label htmlFor="isActive" className="text-xs font-semibold text-text-main cursor-pointer">
                    {t.publishLabel}
                  </label>
                  <p className="w-full text-[11px] leading-4 text-text-muted">{t.publishNote}</p>
                </div>
              </div>
            </div>

            {/* Smart 1-Click Palette Generator */}
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-primary">{t.regenTitle}</h3>
                  <p className="text-xs text-text-muted">{t.regenDesc}</p>
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
                    {t.regenBtn}
                  </button>
                </div>
              </div>
            </div>

            {/* Token Groups */}
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
                {submitting ? t.saving : t.saveChanges}
              </button>
            </div>
          </form>

          {/* Customizer-lite (S2): package options for this instance.
              A sibling of the token form above — separate save path
              (PUT /options, reason + audit), never nested inside it. */}
          {theme && <ThemeCustomizerSection themeId={id} t={t} locale={locale} />}
        </div>

        {/* Right Live Preview Sticky Panel (5 cols) */}
        <div className="lg:col-span-5">
          <ThemeLivePreview tokens={tokens} themeName={name} />
        </div>
      </div>
    </main>
  );
}
