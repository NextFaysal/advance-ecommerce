"use client";

/**
 * Admin > Appearance > Themes — list page with Duplicate, Export, and Import.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import type { AppTheme } from "@/lib/themes";
import { listThemePackages } from "@/themes/registry";
import { BAZAAR_TOKENS } from "@/themes/bazaar/tokens";

/**
 * Packages that ship a ready-made starter instance (hand-authored
 * token set in code). The gallery card for such a package offers
 * "থিম হিসেবে যোগ করুন", which creates a catalog instance through
 * the standard POST /api/v1/admin/themes — no separate API. The
 * merchant then applies it with the usual "স্টোরে প্রয়োগ করুন".
 */
const PACKAGE_STARTER_TOKENS: Record<string, typeof BAZAAR_TOKENS> = {
  bazaar: BAZAAR_TOKENS,
};

export default function AdminThemesPage() {
  const [themes, setThemes] = useState<AppTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);
  const [previewNoteId, setPreviewNoteId] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyReason, setApplyReason] = useState("");
  const [applying, setApplying] = useState(false);
  const [addingPackageId, setAddingPackageId] = useState<string | null>(null);

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

  // Preview grant — mints the signed ae_theme_preview cookie for this
  // theme (30 min, bound to this staff member). S0 honesty: the grant
  // exists and is verified server-side, but storefront rendering only
  // starts consuming it with the S3 slot system — so the button is
  // labelled accordingly and we never claim the store will look
  // different yet.
  async function handlePreview(theme: AppTheme) {
    setPreviewingId(theme.id);
    setPreviewNoteId(null);
    try {
      const res = await fetch("/api/v1/admin/themes/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themeId: theme.id }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        setPreviewNoteId(theme.id);
      } else {
        alert(json?.error?.message ?? "প্রিভিউ grant তৈরি করা যায়নি।");
      }
    } catch {
      alert("নেটওয়ার্ক ত্রুটি।");
    } finally {
      setPreviewingId(null);
    }
  }

  // Apply to store — make this theme THE store default (exclusive):
  // the theme every visitor sees unless they picked their own.
  async function handleApplyToStore(theme: AppTheme) {
    if (applyReason.trim() === "") {
      alert("কারণ লিখুন — এই পরিবর্তনটি অডিট লগে সংরক্ষিত হবে।");
      return;
    }
    setApplying(true);
    try {
      const res = await fetch(`/api/v1/admin/themes/${theme.id}/store-default`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: applyReason.trim() }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok) {
        setApplyingId(null);
        setApplyReason("");
        loadThemes();
      } else {
        alert(json?.error?.message ?? "স্টোর থিম সেট করা যায়নি।");
      }
    } catch {
      alert("নেটওয়ার্ক ত্রুটি।");
    } finally {
      setApplying(false);
    }
  }

  // Add package as a theme instance — creates a catalog entry from
  // the package's shipped starter tokens via the standard create
  // endpoint. The new instance starts unpublished and NOT the store
  // theme; the merchant applies it with "স্টোরে প্রয়োগ করুন".
  async function handleAddPackageInstance(pkg: ReturnType<typeof listThemePackages>[number]) {
    const tokens = PACKAGE_STARTER_TOKENS[pkg.id];
    if (!tokens) return;
    setAddingPackageId(pkg.id);
    try {
      const res = await fetch("/api/v1/admin/themes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: pkg.name,
          description: pkg.description,
          preview: pkg.preview,
          isActive: false,
          packageId: pkg.id,
          tokens,
        }),
      });
      if (res.ok) {
        loadThemes();
      } else {
        const json = await res.json().catch(() => null);
        alert(json?.error?.message ?? "থিম যোগ করা যায়নি।");
      }
    } catch {
      alert("নেটওয়ার্ক ত্রুটি।");
    } finally {
      setAddingPackageId(null);
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
          <p className="mt-1 text-xs leading-5 text-text-muted">
            <strong className="text-text-main">স্টোর থিম</strong> = যেই থিম সব নতুন ভিজিটর প্রথমে দেখে
            (একটিই হতে পারে)। <strong className="text-text-main">সক্রিয়</strong> = কাস্টমার নিজের
            পছন্দের তালিকা (অ্যাকাউন্ট → পছন্দ) থেকে বেছে নিতে পারে — দুটি আলাদা বিষয়।
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

      {/* Theme packages (doc 25) — the built-in code packages every
          catalog theme below is an instance of. The registry is pure
          data, so this client page reads it directly. A package owns
          the layout; an instance owns colours + option values. */}
      <section className="mt-8">
        <h2 className="font-display text-lg font-bold text-text-main">থিম প্যাকেজ</h2>
        <p className="mt-1 text-sm leading-6 text-text-muted">
          প্যাকেজ হলো কোডে তৈরি সম্পূর্ণ থিম — হেডার, ফুটার, হোমপেজের গঠন, কার্ডসহ পুরো
          ফ্রন্টএন্ড বদলে দেয়। নিচের প্রতিটি কাস্টম থিম কোনো একটি প্যাকেজের ইনস্ট্যান্স
          (প্যাকেজ + নিজস্ব রঙ ও অপশন)।
        </p>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          {listThemePackages().map((pkg) => (
            <div
              key={pkg.id}
              className="rounded-2xl border border-border bg-card p-5 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-base font-bold text-text-main">
                  {pkg.name}
                  {pkg.nameBn && (
                    <span className="ml-2 text-sm font-semibold text-text-muted">
                      {pkg.nameBn}
                    </span>
                  )}
                </h3>
                <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
                  v{pkg.version}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] font-medium text-text-muted">
                তৈরি: {pkg.author} • প্যাকেজ আইডি:{" "}
                <span className="font-mono">{pkg.id}</span>
              </p>
              <p className="mt-2 text-xs leading-5 text-text-muted">{pkg.description}</p>

              <div className="mt-4 flex items-center gap-2 rounded-xl border border-border/60 bg-muted/50 p-2.5">
                <div className="flex gap-1.5">
                  {(pkg.preview.length > 0 ? pkg.preview : ["#6366f1", "#8b5cf6", "#ec4899"]).map(
                    (c, i) => (
                      <span
                        key={i}
                        className="h-6 w-6 rounded-full border border-black/10 shadow-sm"
                        style={{ backgroundColor: c }}
                      />
                    ),
                  )}
                </div>
                <span className="text-[11px] font-medium text-text-muted">প্যাকেজ প্রিভিউ</span>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {pkg.lockPalette ? (
                  <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-[11px] font-bold text-warning">
                    🔒 প্যালেট লক — ভিজিটর রঙ বদলাতে পারবে না
                  </span>
                ) : (
                  <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-[11px] font-bold text-success">
                    🎨 প্যালেট খোলা — ভিজিটর নিজের রঙ বেছে নিতে পারে
                  </span>
                )}
                {pkg.supportsDark ? (
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
                    🌙 ডার্ক মোড সমর্থিত
                  </span>
                ) : (
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-bold text-text-muted">
                    ☀️ শুধু লাইট মোড
                  </span>
                )}
                <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-bold text-text-muted">
                  লেআউট স্লট: {Object.keys(pkg.slots).length} • কাস্টমাইজার অপশন:{" "}
                  {pkg.optionsSchema.length}
                </span>
              </div>

              {/* Starter instance — packages that ship hand-authored
                  tokens (PACKAGE_STARTER_TOKENS) can be added as a
                  catalog theme in one click, until one instance of
                  the package exists. */}
              {PACKAGE_STARTER_TOKENS[pkg.id] &&
                (themes.some((t) => t.packageId === pkg.id) ? (
                  <p className="mt-4 text-xs font-semibold text-success">
                    ✓ এই প্যাকেজের থিম নিচের তালিকায় আছে — সেখান থেকে স্টোরে প্রয়োগ করুন
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleAddPackageInstance(pkg)}
                    disabled={addingPackageId === pkg.id || loading}
                    className="mt-4 rounded-lg bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                  >
                    {addingPackageId === pkg.id ? "যোগ হচ্ছে…" : "➕ থিম হিসেবে যোগ করুন"}
                  </button>
                ))}
            </div>
          ))}
        </div>
      </section>

      {!loading && themes.length > 0 && (
        <h2 className="mt-10 font-display text-lg font-bold text-text-main">
          আপনার কাস্টম থিম
        </h2>
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
        <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {themes.map((theme) => (
            <div
              key={theme.id}
              className="group relative flex flex-col justify-between rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:shadow-md"
            >
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-display text-base font-bold text-text-main">{theme.name}</h3>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    {theme.isStoreDefault && (
                      <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-[11px] font-bold text-warning">
                        🏪 স্টোর থিম
                      </span>
                    )}
                  {theme.isActive && (
                    <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-[11px] font-bold text-success">
                      সক্রিয়
                    </span>
                  )}
                  </span>
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
              <div className="mt-5 border-t border-border/70 pt-3">
                <div className="flex items-center justify-between">
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

                {/* Preview grant (S0) — mints the signed preview cookie.
                    HONEST LABEL: slot rendering follows the store
                    pointer only (S3a); the grant is NOT consumed by
                    rendering yet, so this button creates the grant
                    and says plainly that visual preview lands in a
                    later wave — it does not change the storefront. */}
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => handlePreview(theme)}
                    disabled={previewingId === theme.id}
                    className="text-xs font-semibold text-text-muted hover:text-text-main disabled:opacity-50"
                  >
                    {previewingId === theme.id
                      ? "প্রিভিউ তৈরি হচ্ছে…"
                      : "👁 প্রিভিউ grant তৈরি করুন"}
                  </button>
                  {previewNoteId === theme.id && (
                    <p className="mt-1.5 text-[11px] leading-5 text-text-muted">
                      ✓ প্রিভিউ grant তৈরি হয়েছে (৩০ মিনিটের জন্য) — তবে ভিজ্যুয়াল
                      প্রিভিউ এখনো সক্রিয় নয়: স্টোরফ্রন্টের লেআউট এখন স্টোর থিম
                      অনুযায়ীই রেন্ডার হয়, এই grant অনুযায়ী নয়। ভিজ্যুয়াল
                      প্রিভিউ আসছে পরের ধাপে।
                    </p>
                  )}
                </div>

                {/* Apply to store — sets THE store default (exclusive,
                    audited). Reason is collected inline because the API
                    requires one for the audit record. */}
                <div className="mt-3">
                  {theme.isStoreDefault ? (
                    <p className="text-xs font-semibold text-warning">
                      ✓ বর্তমান স্টোর থিম — নতুন ভিজিটররা এটাই দেখছেন
                    </p>
                  ) : applyingId === theme.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="text"
                        value={applyReason}
                        onChange={(e) => setApplyReason(e.target.value)}
                        placeholder="পরিবর্তনের কারণ (অডিটের জন্য)"
                        className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs text-text-main shadow-sm focus:border-ring focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleApplyToStore(theme)}
                        disabled={applying}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
                      >
                        {applying ? "প্রয়োগ হচ্ছে…" : "নিশ্চিত করুন"}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setApplyingId(null);
                          setApplyReason("");
                        }}
                        disabled={applying}
                        className="text-xs font-semibold text-text-muted hover:text-text-main disabled:opacity-50"
                      >
                        বাতিল
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setApplyingId(theme.id);
                        setApplyReason("");
                      }}
                      className="text-xs font-semibold text-text-muted hover:text-text-main"
                    >
                      🏪 স্টোরে প্রয়োগ করুন
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
