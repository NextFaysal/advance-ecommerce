"use client";

/**
 * Admin > Appearance > Themes — list page with Duplicate, Export, and Import.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import type { AppTheme } from "@/lib/themes";

export default function AdminThemesPage() {
  const [themes, setThemes] = useState<AppTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);

  function loadThemes() {
    setLoading(true);
    fetch("/api/v1/admin/themes")
      .then((r) => r.json())
      .then((json: { data?: AppTheme[]; error?: { message: string } }) => {
        if (json.error) setError(json.error.message);
        else setThemes(json.data ?? []);
      })
      .catch(() => setError("থিম তালিকা লোড করা যায়নি।"))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadThemes();
  }, []);

  // Duplicate Theme
  async function handleDuplicate(theme: AppTheme) {
    setCloningId(theme.id);
    try {
      const res = await fetch("/api/v1/admin/themes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${theme.name} (কপি)`,
          description: theme.description || undefined,
          preview: theme.preview,
          isActive: false,
          tokens: theme.tokens,
        }),
      });
      if (res.ok) {
        loadThemes();
      } else {
        alert("থিম ডুপ্লিকেট করা যায়নি।");
      }
    } catch {
      alert("নেটওয়ার্ক ত্রুটি।");
    } finally {
      setCloningId(null);
    }
  }

  // Export Theme JSON
  function handleExport(theme: AppTheme) {
    const exportData = {
      name: theme.name,
      description: theme.description,
      tokens: theme.tokens,
      preview: theme.preview,
      exportedAt: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${theme.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}-theme.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Import Theme JSON
  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (!parsed.name || !parsed.tokens) {
          alert("ভুল ফরম্যাট! থিম ফাইলে name এবং tokens থাকতে হবে।");
          return;
        }
        const res = await fetch("/api/v1/admin/themes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: parsed.name,
            description: parsed.description || undefined,
            preview: parsed.preview || ["#6366f1", "#8b5cf6", "#ec4899"],
            isActive: false,
            tokens: parsed.tokens,
          }),
        });
        if (res.ok) {
          loadThemes();
        } else {
          alert("থিম ইমপোর্ট ব্যর্থ হয়েছে।");
        }
      } catch {
        alert("JSON পার্স করতে ব্যর্থ হয়েছে।");
      }
    };
    reader.readAsText(file);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-main">থিম ম্যানেজমেন্ট</h1>
          <p className="mt-1 text-sm leading-6 text-text-muted">
            ওয়ার্ডপ্রেস স্টাইলে স্টোরের কাস্টম থিম তৈরি, এডিট ও ডুপ্লিকেট করুন।
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Import JSON button */}
          <label className="cursor-pointer inline-flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-semibold text-text-main shadow-sm hover:bg-muted">
            📥 থিম ইমপোর্ট
            <input type="file" accept=".json" onChange={handleImport} className="hidden" />
          </label>

          <Link
            href="/admin/appearance/themes/new"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
          >
            + নতুন থিম
          </Link>
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-destructive/20 bg-destructive/10 px-5 py-4 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading && (
        <div className="mt-10 text-center text-sm text-text-muted">থিম লোড হচ্ছে…</div>
      )}

      {!loading && themes.length === 0 && (
        <div className="mt-10 rounded-2xl border border-border bg-card p-10 text-center">
          <p className="text-sm text-text-muted">
            কোনো কাস্টম থিম তৈরি হয়নি।{" "}
            <Link href="/admin/appearance/themes/new" className="font-semibold text-primary hover:underline">
              প্রথম থিম তৈরি করুন
            </Link>
          </p>
        </div>
      )}

      {!loading && themes.length > 0 && (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {themes.map((theme) => (
            <div
              key={theme.id}
              className="group relative flex flex-col justify-between rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:shadow-md"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-base font-bold text-text-main">{theme.name}</h3>
                  {theme.isActive && (
                    <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-[11px] font-bold text-success">
                      সক্রিয়
                    </span>
                  )}
                </div>
                {theme.description && (
                  <p className="mt-1 line-clamp-2 text-xs text-text-muted">{theme.description}</p>
                )}

                {/* Color Swatch Preview Pill */}
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-border/60 bg-muted/50 p-2.5">
                  <div className="flex gap-1.5">
                    {(theme.preview.length > 0 ? theme.preview : ["#6366f1", "#8b5cf6", "#ec4899"]).map(
                      (c, i) => (
                        <span
                          key={i}
                          className="h-6 w-6 rounded-full border border-black/10 shadow-sm"
                          style={{ backgroundColor: c }}
                        />
                      ),
                    )}
                  </div>
                  <span className="text-[11px] font-medium text-text-muted">কালার প্যালেট</span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="mt-5 flex items-center justify-between border-t border-border/70 pt-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDuplicate(theme)}
                    disabled={cloningId === theme.id}
                    className="text-xs font-semibold text-text-muted hover:text-text-main disabled:opacity-50"
                  >
                    {cloningId === theme.id ? "কপি হচ্ছে…" : "📋 ডুপ্লিকেট"}
                  </button>
                  <span className="text-border">•</span>
                  <button
                    type="button"
                    onClick={() => handleExport(theme)}
                    className="text-xs font-semibold text-text-muted hover:text-text-main"
                  >
                    📤 এক্সপোর্ট
                  </button>
                </div>

                <Link
                  href={`/admin/appearance/themes/${theme.id}`}
                  className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary transition hover:bg-primary hover:text-primary-foreground"
                >
                  সম্পাদনা →
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
