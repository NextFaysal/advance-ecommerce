// /bundle-builder (ADV-18B) — every ACTIVE bundle with its fixed
// contents, the real component-sum vs bundle-price comparison and
// add-to-cart of the bundle variant (the PDP cart line). Gated by
// module.marketing_mechanics; the bundle machinery itself also
// requires the product-types module — both states get honest copy.
import { marketingMechanicsEnabled } from "@/marketing/docs";
import { listBundleBuilds } from "@/marketing/bundle-builder";
import { BundleBuilderClient } from "@/marketing/components/BundleBuilderClient";

export const dynamic = "force-dynamic";

export default async function BundleBuilderPage() {
  if (!marketingMechanicsEnabled()) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-14">
        <h1 className="font-display text-3xl font-extrabold leading-snug text-text-main">বান্ডল বিল্ডার</h1>
        <p className="mt-3 text-sm leading-7 text-text-muted">এই সুবিধাটি এখন উপলব্ধ নয়।</p>
      </main>
    );
  }
  const { moduleEnabled, bundles } = await listBundleBuilds();
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:py-12">
      <h1 className="font-display text-3xl font-extrabold leading-snug text-text-main">বান্ডল বিল্ডার</h1>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-text-muted">
        তৈরি বান্ডলগুলো একসাথে কিনুন — প্রতিটি বান্ডলের কম্পোনেন্ট নির্ধারিত, আর আলাদা করে কিনলে কত পড়ত তার হিসাব
        রেকর্ড করা দাম থেকেই দেখানো হয়েছে।
      </p>
      <div className="mt-8">
        {!moduleEnabled ? (
          <p className="rounded-3xl border border-dashed border-border bg-card p-8 text-center text-sm leading-7 text-text-muted shadow-card">
            বান্ডল পণ্যের মডিউলটি এই ইনস্টলে বন্ধ আছে — তাই কোনো বান্ডল দেখানো যাচ্ছে না।
          </p>
        ) : bundles.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-border bg-card p-8 text-center text-sm leading-7 text-text-muted shadow-card">
            এখন কোনো সক্রিয় বান্ডল নেই। নতুন বান্ডল যোগ হলেই এখানে দেখা যাবে।
          </p>
        ) : (
          <BundleBuilderClient bundles={bundles} />
        )}
      </div>
    </main>
  );
}
