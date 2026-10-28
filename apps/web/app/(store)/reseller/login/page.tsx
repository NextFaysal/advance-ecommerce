/**
 * /reseller/login — reseller portal sign-in (ADV-12).
 *
 * Gate: module.reseller_portal (seeded OFF). While OFF the page shows
 * the locked notice and the login API answers 403 FEATURE_LOCKED.
 * Already-signed-in resellers are redirected to /reseller.
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
import { isResellerPortalEnabled } from "@/reseller/flags";
import { RESELLER_SESSION_COOKIE, verifyResellerSessionToken } from "@/reseller/portal-auth";
import ResellerLoginForm from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "রিসেলার লগইন — Advance Ecommerce",
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
          <h2 className="max-w-md font-display text-4xl font-extrabold leading-snug">রিসেলার পোর্টাল</h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/85">
            আপনার মোবাইল নম্বর ও রিসেলার কোড দিয়ে লগইন করুন — কমিশন, অর্ডার ও পে-আউট সব এক জায়গায়।
          </p>
          <ul className="mt-8 space-y-2 text-sm text-white/90">
            <li>✓ কমিশন</li>
            <li>✓ অর্ডার</li>
            <li>✓ পে-আউট</li>
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

export default async function ResellerLoginPage() {
  if (!isResellerPortalEnabled()) {
    return (
      <PortalShell>
        <h1 className="font-display text-2xl font-bold text-text-main">রিসেলার পোর্টাল</h1>
        <p role="status" className="mt-3 text-sm leading-7 text-text-muted">
          🔒 এই মডিউলটি এই স্টোরে বন্ধ আছে। রিসেলার পোর্টাল চালু করতে স্টোর কর্তৃপক্ষকে বলুন।
        </p>
      </PortalShell>
    );
  }
  const store = await cookies();
  if (await verifyResellerSessionToken(store.get(RESELLER_SESSION_COOKIE)?.value)) {
    redirect("/reseller");
  }
  return (
    <PortalShell>
      <h1 className="font-display text-2xl font-bold text-text-main">রিসেলার লগইন</h1>
      <p className="mt-2 text-sm leading-7 text-text-muted">
        আপনার মোবাইল নম্বর ও রিসেলার কোড দিয়ে লগইন করুন — কমিশন, অর্ডার ও পে-আউট সব এক জায়গায়।
      </p>
      <ResellerLoginForm />
    </PortalShell>
  );
}
