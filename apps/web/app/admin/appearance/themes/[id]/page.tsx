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

interface Props {
  params: { id: string };
}

export default function EditThemePage({ params }: Props) {
  const { id } = params;
  const router = useRouter();

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
        const found = json.data?.find((t) => t.id === id) ?? null;
        if (found) {
          setTheme(found);
          setName(found.name);
          setDescription(found.description ?? "");
          setIsActive(found.isActive);
          setTokens(found.tokens);
        }
      })
      .catch(() => setError("থিম লোড করা যায়নি।"))
      .finally(() => setLoading(false));
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
          name: `${name} (কপি)`,
          description: description || undefined,
          preview: theme?.preview ?? ["#6366f1", "#8b5cf6", "#ec4899"],
          isActive: false,
          tokens,
        }),
      });
      const json = (await res.json()) as { data?: { id: string }; error?: { message: string } };
      if (!res.ok) {
        setError(json.error?.message ?? "থিম ক্লোন করা যায়নি।");
        return;
      }
      router.push("/admin/appearance/themes");
      router.refresh();
    } catch {
      setError("নেটওয়ার্ক ত্রুটি। আবার চেষ্টা করুন।");
    } finally {
      setCloning(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("থিমের নাম দিন।");
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
        setError(json.error?.message ?? "সেভ করা যায়নি।");
        return;
      }
      setSuccess(true);
      router.refresh();
    } catch {
      setError("নেটওয়ার্ক ত্রুটি।");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!confirm("এই থিমটি চিরতরে মুছে দিতে চান?")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/admin/themes/${id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("থিম মুছে ফেলা যায়নি।");
        return;
      }
      router.push("/admin/appearance/themes");
      router.refresh();
    } catch {
      setError("নেটওয়ার্ক ত্রুটি।");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-8">
        <p className="text-sm text-text-muted">থিম লোড হচ্ছে…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/admin/appearance/themes" className="text-sm font-medium text-primary hover:underline">
            ← থিম তালিকায় ফিরুন
          </Link>
          <h1 className="mt-1 font-display text-2xl font-bold text-text-main">
            থিম সম্পাদনা — {name || "Theme"}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Export JSON */}
          <button
            type="button"
            onClick={handleExportJson}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-text-main shadow-sm hover:bg-muted"
          >
            📤 এক্সপোর্ট JSON
          </button>

          {/* Clone / Duplicate */}
          <button
            type="button"
            onClick={handleDuplicate}
            disabled={cloning}
            className="rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-semibold text-text-main shadow-sm hover:bg-muted disabled:opacity-50"
          >
            {cloning ? "ক্লোন হচ্ছে…" : "📋 ডুপ্লিকেট"}
          </button>

          {/* Delete */}
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-50"
          >
            {deleting ? "মুছে ফেলা হচ্ছে…" : "মুছে ফেলুন"}
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
          ✓ পরিবর্তন সফলভাবে সংরক্ষিত হয়েছে।
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-12">
        {/* Left Form (7 cols) */}
        <div className="space-y-6 lg:col-span-7">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* General Info */}
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              <h2 className="mb-4 text-sm font-bold text-text-main">সাধারণ তথ্য</h2>
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-text-main">
                    থিমের নাম <span className="text-destructive">*</span>
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
                  <label className="mb-1 block text-xs font-semibold text-text-main">বিবরণ</label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full rounded-xl border border-input bg-background px-3.5 py-2 text-sm text-text-main shadow-sm focus:border-ring focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
                  />
                  <label htmlFor="isActive" className="text-xs font-semibold text-text-main cursor-pointer">
                    সক্রিয় থিম হিসেবে নির্ধারণ করুন (স্টোরে দৃশ্যমান হবে)
                  </label>
                </div>
              </div>
            </div>

            {/* Smart 1-Click Palette Generator */}
            <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-primary">🪄 ১-ক্লিক স্মার্ট প্যালেট রি-জেনারেটর</h3>
                  <p className="text-xs text-text-muted">
                    নতুন মূল ব্র্যান্ড রঙ বেছে নিয়ে সব টোকেন রিফ্রেশ করতে পারেন।
                  </p>
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
                    নতুন কালার জেনারেট
                  </button>
                </div>
              </div>
            </div>

            {/* Token Groups */}
            <div className="space-y-4">
              <h2 className="text-sm font-bold text-text-main">CSS ভ্যারিয়েবল বিস্তারিত কাস্টমাইজেশন</h2>
              {THEME_TOKEN_GROUPS.map((group) => (
                <div key={group.label} className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                  <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-text-muted">
                    {group.label}
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
                            <span className="font-semibold text-text-main">{meta?.label ?? tokenKey}</span>
                            <span className="block font-mono text-[10px] text-text-muted">{tokenKey}</span>
                          </div>
                          <div className="sm:col-span-4">
                            <span className="mb-0.5 block text-[10px] text-text-muted font-medium">Light</span>
                            <input
                              type="text"
                              value={tokens.light[tokenKey] ?? ""}
                              onChange={(e) => updateLightToken(tokenKey, e.target.value)}
                              placeholder={meta?.lightDefault ?? ""}
                              className="w-full rounded-lg border border-input bg-background px-2.5 py-1.5 font-mono text-xs text-text-main shadow-sm focus:border-ring focus:outline-none"
                            />
                          </div>
                          <div className="sm:col-span-4">
                            <span className="mb-0.5 block text-[10px] text-text-muted font-medium">Dark</span>
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
                বাতিল
              </Link>
              <button
                type="submit"
                disabled={submitting}
                className="rounded-xl bg-primary px-6 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90 disabled:opacity-50"
              >
                {submitting ? "সংরক্ষণ হচ্ছে…" : "পরিবর্তন সংরক্ষণ করুন"}
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
