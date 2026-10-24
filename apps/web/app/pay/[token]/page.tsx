/**
 * /pay/[token] — public payment link page. Agent 19 (E1 follow-up).
 *
 * Server component: resolves the link server-side by token-hash lookup
 * (resolvePayLink). The token/hash never render into the page. States:
 * active (amount + sandbox pay form), paid, expired, cancelled, not found.
 * Bangla-first, mobile-first. noindex — a payment link is not a search page.
 *
 * Data is the DB-backed payment_links store (DB swap 2026-10-24); the
 * store behind resolvePayLink changed, this page only gained awaits.
 */
import type { Metadata } from "next";
import { ensureDemoPaymentLink, resolvePayLink } from "@/storefront-ux/pay-link-view";
import PayForm from "./PayForm";

export const metadata: Metadata = {
  title: "পেমেন্ট — Advance Ecommerce",
  robots: { index: false, follow: false },
};

export default async function PayPage({ params }: { params: { token: string } }) {
  await ensureDemoPaymentLink();
  const resolved = await resolvePayLink(params.token);

  return (
    <main className="mx-auto min-h-screen w-full max-w-md px-4 py-8">
      <h1 className="text-xl font-bold">পেমেন্ট</h1>
      <p className="mt-1 text-xs text-slate-500">Sandbox payment only — no real money moves.</p>

      {!resolved.ok && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-5">
          <p className="font-semibold text-red-700">পেমেন্ট লিংক পাওয়া যায়নি</p>
          <p className="mt-1 text-sm text-red-600">লিংকটি ভুল বা মুছে ফেলা হয়েছে। দোকানে যোগাযোগ করুন।</p>
        </div>
      )}

      {resolved.ok && (
        <section className="mt-6 rounded-xl border bg-white px-4 py-5 shadow-sm">
          <p className="text-sm text-slate-500">{resolved.view.purposeLabelBn}</p>
          <p className="mt-1 text-3xl font-bold text-[#4F46E5]">{resolved.view.amountFormatted}</p>
          <p className="mt-2 text-sm">
            অর্ডার: <span className="font-medium">{resolved.view.orderId}</span>
          </p>
          <p className="mt-1 text-sm">
            অবস্থা: <span className="font-medium">{resolved.view.statusLabelBn}</span>
          </p>

          {resolved.view.status === "active" && (
            <>
              <p className="mt-1 text-sm text-slate-500">
                মেয়াদ শেষ: {new Date(resolved.view.expiresAt).toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" })}
              </p>
              <PayForm token={params.token} />
            </>
          )}

          {resolved.view.status === "paid" && (
            <p className="mt-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
              এই লিংকের পেমেন্ট সম্পন্ন হয়েছে। ধন্যবাদ!
              {resolved.view.paidAt
                ? ` (${new Date(resolved.view.paidAt).toLocaleString("bn-BD", { timeZone: "Asia/Dhaka" })})`
                : ""}
            </p>
          )}
          {resolved.view.status === "expired" && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              এই লিংকের মেয়াদ শেষ হয়ে গেছে। নতুন লিংকের জন্য দোকানে যোগাযোগ করুন।
            </p>
          )}
          {resolved.view.status === "cancelled" && (
            <p className="mt-4 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">
              এই লিংক বাতিল করা হয়েছে। সাহায্যের জন্য দোকানে যোগাযোগ করুন।
            </p>
          )}
        </section>
      )}
    </main>
  );
}
