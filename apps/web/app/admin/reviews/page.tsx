import { PageHeader } from "@/components/ui/page-header";
import { ReviewsManager } from "./reviews-manager";
import { QuestionsManager } from "./questions-manager";

// Review moderation — the queue behind the storefront review system.
// Reviews are born PENDING at POST /api/v1/public/products/[slug]/reviews
// and reach the PDP / homepage only when approved here. The list is
// REAL — <ReviewsManager> reads GET /api/v1/admin/reviews (Review
// table via Prisma); approve/reject PATCHes the admin API, which
// re-syncs each product's ratingAverage / reviewCount. Guarded by the
// content.page permission (same as the CMS APIs), enforced in the API.
//
// Below it, the product Q&A moderation queue (ADV-16b): customer
// questions are born PENDING at POST .../products/[slug]/questions
// and reach the PDP only when answered here (ANSWERED is the only
// public status). <QuestionsManager> reads GET
// /api/v1/admin/product-questions; guarded by content.page too.
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

      <div className="mt-12">
        <PageHeader
          title="পণ্য প্রশ্নোত্তর মডারেশন"
          description="গ্রাহকদের পণ্য-সম্পর্কিত প্রশ্ন ProductQuestion টেবিল থেকে আসে। উত্তর দিলেই প্রশ্নোত্তরটি পণ্যের পেজে প্রকাশিত হয়; অনুপযুক্ত প্রশ্ন লুকিয়ে রাখা যায়। (Product Q&A — content.page)"
          breadcrumb="Admin / Catalog"
        />
        <QuestionsManager />
      </div>
    </main>
  );
}
