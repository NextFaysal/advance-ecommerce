/**
 * /reseller/login — reseller portal sign-in (ADV-12).
 *
 * Gate: module.reseller_portal (seeded OFF). While OFF the page shows
 * the locked notice and the login API answers 403 FEATURE_LOCKED.
 * Already-signed-in resellers are redirected to /reseller.
 */
import type { Metadata } from "next";
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

export default async function ResellerLoginPage() {
  if (!isResellerPortalEnabled()) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-card">
          <h1 className="font-display text-xl font-bold text-text-main">রিসেলার পোর্টাল</h1>
          <p role="status" className="mt-3 text-sm leading-7 text-text-muted">
            🔒 এই মডিউলটি এই স্টোরে বন্ধ আছে। রিসেলার পোর্টাল চালু করতে স্টোর কর্তৃপক্ষকে বলুন।
          </p>
        </div>
      </main>
    );
  }
  const store = await cookies();
  if (verifyResellerSessionToken(store.get(RESELLER_SESSION_COOKIE)?.value)) {
    redirect("/reseller");
  }
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-3xl border border-border bg-card p-6 shadow-card">
        <h1 className="font-display text-xl font-bold text-text-main">রিসেলার লগইন</h1>
        <p className="mt-2 text-sm leading-7 text-text-muted">
          আপনার মোবাইল নম্বর ও রিসেলার কোড দিয়ে লগইন করুন — কমিশন, অর্ডার ও পে-আউট সব এক জায়গায়।
        </p>
        <ResellerLoginForm />
      </div>
    </main>
  );
}
