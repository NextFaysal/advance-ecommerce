/**
 * /account/subscriptions — the customer's subscriptions
 * (ADV-18 remainder): create from products they bought before, and
 * pause / resume / cancel / change interval or quantity.
 *
 * Only the signed-in customer's own rows are ever read or changed
 * (the API + service filter on customerId). Logged-out visitors are
 * sent to /account. Flag OFF renders an honest "not enabled" notice —
 * no fake UI for a locked module.
 */
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@advance-ecommerce/db";
import { getCurrentCustomer } from "@/customer-auth/auth";
import { subscriptionsEnabled } from "@/subscriptions/flags";
import AccountNav from "../account-nav";
import { SubscriptionsManager, type PurchasableOption } from "./manager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "আমার সাবস্ক্রিপশন — Advance Ecommerce",
  description: "আপনার সাবস্ক্রিপশনসমূহ — অটো-ডেলিভারি পরিচালনা করুন।",
  robots: { index: false, follow: false },
};

export default async function AccountSubscriptionsPage() {
  const customer = await getCurrentCustomer();
  if (customer === null) redirect("/account");

  if (!subscriptionsEnabled()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10 lg:max-w-5xl">
        <h1 className="font-display text-2xl font-bold text-text-main">আমার সাবস্ক্রিপশন</h1>
        <div className="lg:flex lg:items-start lg:gap-6">
          <AccountNav />
          <div className="min-w-0 flex-1">
            <p className="mt-6 rounded-2xl border border-border bg-card p-5 text-sm leading-6 text-text-muted shadow-card">
              সাবস্ক্রিপশন সুবিধাটি এই দোকানে এখনো চালু হয়নি।
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Create-form sources: variants from the customer's own past
  // orders (the natural re-order set), most recent first, deduped in
  // JS. Server-side read; the manager component receives plain
  // serializable options only.
  const pastItems = await prisma.orderItem.findMany({
    where: { order: { customerId: customer.id, deletedAt: null } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { variantId: true, productName: true, sku: true },
  });
  const seenVariants = new Set<string>();
  const purchasable: PurchasableOption[] = [];
  for (const item of pastItems) {
    if (seenVariants.has(item.variantId)) continue;
    seenVariants.add(item.variantId);
    purchasable.push({
      variantId: item.variantId,
      label: `${item.productName} (${item.sku})`,
    });
    if (purchasable.length >= 50) break;
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10 lg:max-w-5xl">
      <h1 className="font-display text-2xl font-bold text-text-main">আমার সাবস্ক্রিপশন</h1>
      <p className="mt-1.5 text-sm leading-6 text-text-muted">
        সাবস্ক্রিপশন চালু থাকলে নির্ধারিত সময়ে অর্ডার তৈরি হয়ে ক্যাশ অন ডেলিভারিতে পৌঁছে যায়।
        যেকোনো সময় থামাতে, বিরতি বদলাতে বা বাতিল করতে পারবেন — বাতিল করা সাবস্ক্রিপশনের জন্য
        আর কোনো অর্ডার তৈরি হবে না।
      </p>
      <div className="lg:flex lg:items-start lg:gap-6">
        <AccountNav />
        <div className="min-w-0 flex-1">
          <SubscriptionsManager purchasable={purchasable} />
        </div>
      </div>
    </main>
  );
}
