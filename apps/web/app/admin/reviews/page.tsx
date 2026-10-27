import { PageHeader } from "@/components/ui/page-header";
import { ReviewsManager } from "./reviews-manager";
import { QuestionsManager } from "./questions-manager";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { REVIEWS_ADMIN_STRINGS } from "./strings";

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

export default async function AdminReviewsPage() {
  const s = pick(await getRequestLocale(), REVIEWS_ADMIN_STRINGS);
  return (
    <main>
      <PageHeader
        title={s.pageTitle}
        description={s.pageDescription}
        breadcrumb={s.pageBreadcrumb}
      />
      <ReviewsManager />

      <div className="mt-12">
        <PageHeader
          title={s.qaTitle}
          description={s.qaDescription}
          breadcrumb={s.pageBreadcrumb}
        />
        <QuestionsManager />
      </div>
    </main>
  );
}
