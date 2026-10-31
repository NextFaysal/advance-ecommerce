"use client";

// Store Identity & Branding card — Settings index.
// Allows merchants to dynamically configure:
// 1. Store Name (`general.store_name`)
// 2. Logo URL (`branding.logo_url`) with live image preview
// 3. Favicon URL (`branding.favicon_url`)
// 4. Support Phone (`general.support_phone`)
// 5. Support Email (`general.support_email`)
// 6. Store Address (`general.store_address`)
//
// Saves through POST /api/v1/admin/settings { key, value, reason }
// with audit logging. An empty audit reason automatically defaults to
// "Store profile and branding update" to ensure seamless saves.

import { useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { SETTINGS_STRINGS } from "./strings";

interface StoreNameCardProps {
  /** Effective store name (initial value) */
  initial?: string;
  initialName?: string;
  initialLogoUrl?: string;
  initialFaviconUrl?: string;
  initialSupportPhone?: string;
  initialSupportEmail?: string;
  initialStoreAddress?: string;
  dbReady: boolean;
}

export function StoreNameCard({
  initial = "",
  initialName = "",
  initialLogoUrl = "",
  initialFaviconUrl = "",
  initialSupportPhone = "",
  initialSupportEmail = "",
  initialStoreAddress = "",
  dbReady,
}: StoreNameCardProps) {
  const { locale, t } = useLocale();
  const s = pick(locale, SETTINGS_STRINGS);

  const effectiveInitialName = initialName || initial;

  const [storeName, setStoreName] = useState(effectiveInitialName);
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [faviconUrl, setFaviconUrl] = useState(initialFaviconUrl);
  const [supportPhone, setSupportPhone] = useState(initialSupportPhone);
  const [supportEmail, setSupportEmail] = useState(initialSupportEmail);
  const [storeAddress, setStoreAddress] = useState(initialStoreAddress);

  const [savedName, setSavedName] = useState(effectiveInitialName);
  const [savedLogoUrl, setSavedLogoUrl] = useState(initialLogoUrl);
  const [savedFaviconUrl, setSavedFaviconUrl] = useState(initialFaviconUrl);
  const [savedSupportPhone, setSavedSupportPhone] = useState(initialSupportPhone);
  const [savedSupportEmail, setSavedSupportEmail] = useState(initialSupportEmail);
  const [savedStoreAddress, setSavedStoreAddress] = useState(initialStoreAddress);

  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("");
  const [statusOk, setStatusOk] = useState(false);
  const [saving, setSaving] = useState(false);

  const isBn = locale === "bn";

  async function handleSave() {
    setStatus("");
    const auditReason = reason.trim() || (isBn ? "স্টোর প্রোফাইল ও ব্র্যান্ডিং আপডেট" : "Store profile and branding update");

    const fieldsToSave: { key: string; value: string; oldVal: string; label: string }[] = [
      { key: "general.store_name", value: storeName.trim(), oldVal: savedName.trim(), label: isBn ? "স্টোরের নাম" : "Store Name" },
      { key: "branding.logo_url", value: logoUrl.trim(), oldVal: savedLogoUrl.trim(), label: isBn ? "লোগো URL" : "Logo URL" },
      { key: "branding.favicon_url", value: faviconUrl.trim(), oldVal: savedFaviconUrl.trim(), label: isBn ? "ফেভিকন URL" : "Favicon URL" },
      { key: "general.support_phone", value: supportPhone.trim(), oldVal: savedSupportPhone.trim(), label: isBn ? "সাপোর্ট ফোন" : "Support Phone" },
      { key: "general.support_email", value: supportEmail.trim(), oldVal: savedSupportEmail.trim(), label: isBn ? "সাপোর্ট ইমেইল" : "Support Email" },
      { key: "general.store_address", value: storeAddress.trim(), oldVal: savedStoreAddress.trim(), label: isBn ? "স্টোরের ঠিকানা" : "Store Address" },
    ];

    const changed = fieldsToSave.filter((f) => f.value !== f.oldVal);

    if (changed.length === 0) {
      setStatusOk(true);
      setStatus(isBn ? "কোনো পরিবর্তন করা হয়নি।" : "No changes were made.");
      return;
    }

    setSaving(true);
    try {
      const results = await Promise.all(
        changed.map(async (field) => {
          const res = await fetch("/api/v1/admin/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              key: field.key,
              value: field.value,
              reason: auditReason,
              isPublic: true,
            }),
          });
          return { field, ok: res.ok, status: res.status };
        })
      );

      const failed = results.filter((r) => !r.ok);
      if (failed.length > 0) {
        setStatusOk(false);
        setStatus(
          isBn
            ? `${failed.map((f) => f.field.label).join(", ")} সেভ করা যায়নি।`
            : `Failed to save ${failed.map((f) => f.field.label).join(", ")}.`
        );
      } else {
        // Update saved state
        setSavedName(storeName.trim());
        setSavedLogoUrl(logoUrl.trim());
        setSavedFaviconUrl(faviconUrl.trim());
        setSavedSupportPhone(supportPhone.trim());
        setSavedSupportEmail(supportEmail.trim());
        setSavedStoreAddress(storeAddress.trim());

        setStatusOk(true);
        setStatus(
          isBn
            ? "স্টোর ব্র্যান্ডিং ও প্রোফাইল সফলভাবে সংরক্ষিত হয়েছে!"
            : "Store branding and profile updated successfully!"
        );
      }
    } catch {
      setStatusOk(false);
      setStatus(isBn ? "সার্ভারের সঙ্গে যোগাযোগ করা যায়নি।" : "Network error, could not reach server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card">
      <div className="bg-brand-600 h-1.5 w-full" aria-hidden="true" />
      <div className="p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="bg-brand-soft flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-brand-ink shadow-md">
            <Icon name="store" size={20} />
          </span>
          <div>
            <h2 className="font-display text-base font-semibold text-text-main">
              {isBn ? "স্টোর ব্র্যান্ডিং ও প্রোফাইল" : "Store Branding & Profile"}
            </h2>
            <p className="text-xs text-text-muted">
              {isBn
                ? "ওয়েবসাইট হেডার, ফুটার, চালান এবং ইনভয়েসের নাম, লোগো ও যোগাযোগ তথ্য পরিবর্তন করুন।"
                : "Manage website header, footer, invoices, and customer contact information dynamically."}
            </p>
          </div>
        </div>

        {!dbReady && (
          <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700">
            {s.snDbWarning}
          </p>
        )}

        {/* Inputs Grid */}
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Store Name */}
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {isBn ? "স্টোরের নাম (Store Name)" : "Store Name"}
              </span>
              <input
                type="text"
                placeholder={isBn ? "যেমন: Advance Ecommerce" : "e.g. Advance Ecommerce"}
                maxLength={120}
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                disabled={saving}
                className="mt-1 block h-10 w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
          </div>

          {/* Logo URL */}
          <div>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {isBn ? "স্টোর লোগো URL (Logo Image URL)" : "Store Logo URL"}
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="url"
                  placeholder="https://example.com/logo.png"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  disabled={saving}
                  className="block h-10 flex-1 rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
                {logoUrl ? (
                  <div className="flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-neutral-50 p-1">
                    <img
                      src={logoUrl}
                      alt="Logo preview"
                      className="max-h-full max-w-full object-contain"
                      onError={(e) => {
                        (e.currentTarget as HTMLElement).style.display = "none";
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </label>
            <p className="mt-1 text-[11px] text-text-muted">
              {isBn ? "হেডার এবং ফুটারে টেক্সটের বদলে লোগো ছবি দেখাবে।" : "Replaces default text brand with logo in header & footer."}
            </p>
          </div>

          {/* Favicon URL */}
          <div>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {isBn ? "ফেভিকন URL (Favicon / Icon URL)" : "Favicon URL"}
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="url"
                  placeholder="https://example.com/favicon.ico"
                  value={faviconUrl}
                  onChange={(e) => setFaviconUrl(e.target.value)}
                  disabled={saving}
                  className="block h-10 flex-1 rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                />
                {faviconUrl ? (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-neutral-50 p-1">
                    <img
                      src={faviconUrl}
                      alt="Favicon preview"
                      className="h-6 w-6 object-contain"
                      onError={(e) => {
                        (e.currentTarget as HTMLElement).style.display = "none";
                      }}
                    />
                  </div>
                ) : null}
              </div>
            </label>
            <p className="mt-1 text-[11px] text-text-muted">
              {isBn ? "ব্রাউজার ট্যাবে প্রদর্শিত ছোট আইকন।" : "Icon displayed in browser tabs."}
            </p>
          </div>

          {/* Support Phone */}
          <div>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {isBn ? "সাপোর্ট ফোন নম্বর (Support Phone)" : "Support Phone"}
              </span>
              <input
                type="text"
                placeholder="+8801700000000"
                value={supportPhone}
                onChange={(e) => setSupportPhone(e.target.value)}
                disabled={saving}
                className="mt-1 block h-10 w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
          </div>

          {/* Support Email */}
          <div>
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {isBn ? "সাপোর্ট ইমেইল (Support Email)" : "Support Email"}
              </span>
              <input
                type="email"
                placeholder="support@example.com"
                value={supportEmail}
                onChange={(e) => setSupportEmail(e.target.value)}
                disabled={saving}
                className="mt-1 block h-10 w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
          </div>

          {/* Store Address */}
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {isBn ? "স্টোরের ঠিকানা (Store Address)" : "Store Address"}
              </span>
              <input
                type="text"
                placeholder={isBn ? "যেমন: ধানমন্ডি, ঢাকা-১২০৯" : "e.g. Dhanmondi, Dhaka-1209"}
                value={storeAddress}
                onChange={(e) => setStoreAddress(e.target.value)}
                disabled={saving}
                className="mt-1 block h-10 w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
          </div>

          {/* Audit Reason (Optional) */}
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                {isBn ? "অডিট নোট / পরিবর্তনের কারণ (ঐচ্ছিক)" : "Audit Reason (Optional)"}
              </span>
              <input
                type="text"
                placeholder={isBn ? "যেমন: স্টোর ব্র্যান্ডিং তথ্য পরিবর্তন" : "e.g. Store profile update"}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={saving}
                className="mt-1 block h-10 w-full rounded-lg border border-border bg-card px-3 text-sm shadow-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
              />
            </label>
          </div>
        </div>

        {/* Action Button */}
        <div className="mt-5 flex items-center justify-end gap-3 border-t border-border pt-4">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="brand-gradient inline-flex h-10 items-center justify-center rounded-lg px-6 text-sm font-semibold text-white shadow-md transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? (isBn ? "সংরক্ষণ হচ্ছে..." : "Saving...") : (isBn ? "পরিবর্তন সংরক্ষণ করুন" : "Save Changes")}
          </button>
        </div>

        {status && (
          <div
            role="status"
            className={`mt-4 flex items-start gap-3 rounded-lg border px-4 py-3 text-sm ${
              statusOk ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"
            }`}
          >
            <span
              aria-hidden="true"
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                statusOk ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
              }`}
            >
              <Icon name={statusOk ? "check" : "alert"} size={14} />
            </span>
            <p className="leading-relaxed font-medium">{status}</p>
          </div>
        )}
      </div>
    </section>
  );
}
