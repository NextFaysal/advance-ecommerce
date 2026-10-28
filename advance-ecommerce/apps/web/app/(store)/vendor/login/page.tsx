/**
 * /vendor/login — vendor portal sign-in (ADV-13).
 *
 * Gate: module.vendor_portal (seeded OFF). While OFF the page shows
 * the locked notice and the login APIs answer 403 FEATURE_LOCKED.
 * Sign-in is phone + SMS one-time code (the Vendor record has no
 * password/code credential). Already-signed-in vendors are
 * redirected to /vendor.
 *
 * Layout (doc 32, P6): the portal sits outside the theme shell, so it
 * wears the platform's own two-part login treatment — gradient brand
 * panel + form card on desktop, stacked card on phone — matching the
 * admin login's quality bar. Visual only; the gate and redirect
 * logic above are untouched.
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isVendorPortalEnabled, VENDOR_SESSION_COOKIE, verifyVendorSessionToken } from "@/vendors/portal-auth";
import VendorLoginForm from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ভেন্ডর লগইন — Advance Ecommerce",
  robots: { index: false, follow: false },
};

function PortalShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen">
      {/* Brand panel — desktop only */}
      <aside className="brand-gradient relative hidden w-[44%] flex-col justify-between overflow-hidden p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/20 text-xl font-extrabold backdrop-blur">
            A
          </span>
          <span className="text-lg font-bold">Advance Ecommerce</span>
        </div>
        <div>
          <h2 className="max-w-md font-display text-4xl font-extrabold leading-snug">ভেন্ডর পোর্টাল</h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/85">
            আপনার ভেন্ডর মোবাইল নম্বর দিন — SMS-এ একটি একবারের কোড পাঠানো হবে। কোডটি দিয়ে লগইন করে
            পণ্য, অর্ডার, কমিশন ও KYC সব এক জায়গায় দেখুন।
          </p>
          <ul className="mt-8 space-y-2 text-sm text-white/90">
            <li>✓ পণ্য</li>
            <li>✓ অর্ডার</li>
            <li>✓ কমিশন</li>
            <li>✓ KYC</li>
          </ul>
        </div>
        <p className="text-xs text-white/70">© 2026 Advance Ecommerce</p>
      </aside>

      {/* Form panel */}
      <section className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-lg sm:p-8">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-xl text-lg font-extrabold text-white">
              A
            </span>
            <span className="font-bold text-text-main">Advance Ecommerce</span>
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}

export default async function VendorLoginPage() {
  if (!isVendorPortalEnabled()) {
    return (
      <PortalShell>
        <h1 className="font-display text-2xl font-bold text-text-main">ভেন্ডর পোর্টাল</h1>
        <p role="status" className="mt-3 text-sm leading-7 text-text-muted">
          🔒 এই মডিউলটি এই স্টোরে বন্ধ আছে। ভেন্ডর পোর্টাল চালু করতে স্টোর কর্তৃপক্ষকে বলুন।
        </p>
      </PortalShell>
    );
  }
  const store = await cookies();
  if (await verifyVendorSessionToken(store.get(VENDOR_SESSION_COOKIE)?.value)) {
    redirect("/vendor");
  }
  return (
    <PortalShell>
      <h1 className="font-display text-2xl font-bold text-text-main">ভেন্ডর লগইন</h1>
      <p className="mt-2 text-sm leading-7 text-text-muted">
        আপনার ভেন্ডর মোবাইল নম্বর দিন — SMS-এ একটি একবারের কোড পাঠানো হবে। কোডটি দিয়ে লগইন করে
        পণ্য, অর্ডার, কমিশন ও KYC সব এক জায়গায় দেখুন।
      </p>
      <VendorLoginForm />
    </PortalShell>
  );
}
