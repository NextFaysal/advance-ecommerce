/**
 * /vendor/login — vendor portal sign-in (ADV-13).
 *
 * Gate: module.vendor_portal (seeded OFF). While OFF the page shows
 * the locked notice and the login APIs answer 403 FEATURE_LOCKED.
 * Sign-in is phone + SMS one-time code (the Vendor record has no
 * password/code credential). Already-signed-in vendors are
 * redirected to /vendor.
 */
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isVendorPortalEnabled, VENDOR_SESSION_COOKIE, verifyVendorSessionToken } from "@/vendors/portal-auth";
import VendorLoginForm from "./login-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ভেন্ডর লগইন — Advance Ecommerce",
  robots: { index: false, follow: false },
};

export default async function VendorLoginPage() {
  if (!isVendorPortalEnabled()) {
    return (
      <main className="mx-auto max-w-md px-4 py-16">
        <div className="rounded-3xl border border-border bg-card p-6 shadow-card">
          <h1 className="font-display text-xl font-bold text-text-main">ভেন্ডর পোর্টাল</h1>
          <p role="status" className="mt-3 text-sm leading-7 text-text-muted">
            🔒 এই মডিউলটি এই স্টোরে বন্ধ আছে। ভেন্ডর পোর্টাল চালু করতে স্টোর কর্তৃপক্ষকে বলুন।
          </p>
        </div>
      </main>
    );
  }
  const store = await cookies();
  if (await verifyVendorSessionToken(store.get(VENDOR_SESSION_COOKIE)?.value)) {
    redirect("/vendor");
  }
  return (
    <main className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-3xl border border-border bg-card p-6 shadow-card">
        <h1 className="font-display text-xl font-bold text-text-main">ভেন্ডর লগইন</h1>
        <p className="mt-2 text-sm leading-7 text-text-muted">
          আপনার ভেন্ডর মোবাইল নম্বর দিন — SMS-এ একটি একবারের কোড পাঠানো হবে। কোডটি দিয়ে লগইন করে
          পণ্য, অর্ডার, কমিশন ও KYC সব এক জায়গায় দেখুন।
        </p>
        <VendorLoginForm />
      </div>
    </main>
  );
}
