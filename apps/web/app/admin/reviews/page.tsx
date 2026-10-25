import { PageHeader } from "@/components/ui/page-header";
import { ReviewsManager } from "./reviews-manager";

// Review moderation — the queue behind the storefront review system.
// Reviews are born PENDING at POST /api/v1/public/products/[slug]/reviews
// and reach the PDP / homepage only when approved here. The list is
// REAL — <ReviewsManager> reads GET /api/v1/admin/reviews (Review
// table via Prisma); approve/reject PATCHes the admin API, which
// re-syncs each product's ratingAverage / reviewCount. Guarded by the
// content.page permission (same as the CMS APIs), enforced in the API.
export const dynamic = "force-dynamic";

export default function AdminReviewsPage() {
  return (
    <main>
      <PageHeader
        title="রিভিউ মডারেশন"
        description="আসল রিভিউ ডাটাবেসের Review টেবিল থেকে আসে। অনুমোদিত রিভিউই শুধু পণ্যের পেজে ও হোমপেজে প্রকাশিত হয়; অনুমোদন/প্রত্যাখ্যানের সঙ্গে সঙ্গেই পণ্যের গড় রেটিং আপডেট হয়। ফোন নম্বর যাচাইয়ের জন্য — এখানে মাস্ক করা দেখানো হয়। (Review Moderation — content.page)"
        breadcrumb="Admin / Catalog"
      />
      <ReviewsManager />
    </main>
  );
}
