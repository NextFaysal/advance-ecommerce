import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@advance-ecommerce/db";
import { funnelStore } from "@/funnels/store";
import { verifyFunnelToken, FUNNEL_TOKEN_TTL_MS } from "@/funnels/token";
import { resolveStepOffer } from "@/funnels/offer";
import { getPublishedStepPage } from "@/funnels/runtime";
import { prepareFunnelStepRender } from "@/funnels/step-page";
import { VisitorIdBootstrap } from "@/marketing/components/VisitorIdBootstrap";
import { buildLandingViewModel } from "@/landing/render";
import { resolveLandingExtras } from "@/landing/resolve-extras";
import { landingCatalogQueriesPublic, referencedProductIds } from "@/landing/catalog";
import { LandingView } from "@/landing/components/LandingView";
import { LANDING_STRINGS } from "@/landing/strings";
import { FunnelOfferPanel, type FunnelOfferPanelData } from "@/funnels/components/FunnelOfferPanel";
import { getRequestLocale } from "@/i18n/server";
import { formatBdt } from "@advance-ecommerce/validators";
import { interpolate, pick } from "@/i18n/locale";
import { qtyNumber } from "@/lib/quantity";

// Funnel step page — doc 34 §3.7 (wave L8: offer + thank-you steps;
// the entry route and the order step's bump/redirect are L7's).
//
// Routing is data: /f/<funnelSlug>/<stepId>?t=<token>. The funnel
// must be PUBLISHED and the step must exist in it — anything else
// 404s identically (no existence leak, the landing rule). Every
// step's content is an ordinary LandingPage rendered by the
// ordinary LandingView; this route adds only the step's action
// layer:
//
//  - upsell/downsell: the one-click offer panel, shown ONLY with a
//    valid funnel token bound to this funnel + a live order inside
//    its §5.4 window (COD, unpaid, non-terminal). No token /
//    expired / wrong funnel → the step renders as a PLAIN page
//    with a graceful note — never an error wall, never order data
//    (§3.7). All money checks are re-run server-side at accept
//    time by the amend endpoint; what's here is UX state only.
//  - thank_you: the token-verified order summary (order number,
//    lines, totals — read from the ORDER row, including any line
//    an accept amended into it, plus any held companion order an
//    accept created) above the owner's page content. Without a
//    valid token it is a generic thank-you: page content only.
//  - landing/order steps: the plain page (the order step's form is
//    the standard quick_order; L7's layer adds its bump + the
//    post-order redirect to the next step).
export const dynamic = "force-dynamic";

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "CANCELLED",
  "REFUNDED",
  "RETURNED",
  "RETURN_REQUESTED",
  "RETURNING",
  "FAILED",
  "EXCHANGED",
]);

interface StepParams {
  slug: string;
  stepId: string;
}

async function loadStep(params: StepParams) {
  const funnel = await funnelStore.getPublishedBySlug(params.slug);
  if (!funnel) return null;
  const step = funnel.steps.find((s) => s.id === params.stepId);
  if (!step) return null;
  // L7 gate: the step's page must be PUBLISHED (status + schedule
  // window, by id) — a draft/archived step page 404s identically
  // here; funnel membership never leaks a page (doc 34 §0).
  const page = await getPublishedStepPage(step.pageId);
  if (!page) return null;
  return { funnel, step, page };
}

export async function generateMetadata({ params }: { params: StepParams }): Promise<Metadata> {
  const loaded = await loadStep(params);
  if (!loaded) return { title: "পেজ পাওয়া যায়নি" };
  const locale = await getRequestLocale();
  return { title: locale === "en" ? loaded.page.titleEn || loaded.page.titleBn : loaded.page.titleBn };
}

export default async function FunnelStepPage({
  params,
  searchParams,
}: {
  params: StepParams;
  searchParams: { t?: string | string[] };
}) {
  const loaded = await loadStep(params);
  if (!loaded) notFound();
  const { funnel, step } = loaded;
  const locale = await getRequestLocale();
  const s = pick(locale, LANDING_STRINGS);

  // L7 layer (src/funnels/step-page.ts): A/B variant page swap +
  // the §3.8 view event + — for an order step — the funnel claims
  // (context + bump) the QuickOrderForm below carries. Runs BEFORE
  // the catalog fetch so a swapped variant page resolves its own
  // products/extras.
  const prepared = await prepareFunnelStepRender(funnel, step, loaded.page);
  const page = prepared.page;

  const products = await landingCatalogQueriesPublic.byIds(referencedProductIds(page));
  const extras = await resolveLandingExtras(page, landingCatalogQueriesPublic);
  const view = buildLandingViewModel(page, products, extras);

  /* ---- funnel token + bound order (capability, ids only) ---- */
  const rawToken = typeof searchParams.t === "string" ? searchParams.t : null;
  const verified = rawToken ? verifyFunnelToken(rawToken) : null;
  const tokenOk = verified !== null && verified.ok && verified.funnelId === funnel.id ? verified : null;
  const order = tokenOk
    ? await prisma.order.findFirst({
        where: { id: tokenOk.orderId, deletedAt: null },
        select: {
          id: true,
          orderNo: true,
          status: true,
          paymentMethod: true,
          paymentStatus: true,
          subtotalPoisha: true,
          discountPoisha: true,
          shippingPoisha: true,
          codFeePoisha: true,
          totalPoisha: true,
          createdAt: true,
          items: {
            orderBy: { createdAt: "asc" },
            select: { id: true, productName: true, sku: true, unitPricePoisha: true, quantity: true },
          },
        },
      })
    : null;
  const windowEndsAtMs = order && tokenOk ? Math.min(tokenOk.expiresAt, order.createdAt.getTime() + FUNNEL_TOKEN_TTL_MS) : 0;
  const windowOpen = order !== null && windowEndsAtMs > Date.now();

  const stepHref = (stepId: string) =>
    rawToken ? `/f/${funnel.slug}/${stepId}?t=${encodeURIComponent(rawToken)}` : `/f/${funnel.slug}/${stepId}`;

  /* ---- offer steps ---- */
  let offerPanel: ReactNode = null;
  let notice: ReactNode = null;
  if (step.kind === "upsell" || step.kind === "downsell") {
    const trackHref = order ? `/track?orderNo=${encodeURIComponent(order.orderNo)}` : "/track";
    if (rawToken && (!tokenOk || !order)) {
      // A token was carried but proves nothing — graceful, order-safe.
      notice = (
        <section className="mx-auto max-w-3xl px-4 pt-6">
          <div className="rounded-3xl border border-border bg-card p-5 text-center shadow-card">
            <p className="text-sm font-medium text-text-main">{s.funnelLinkInactive}</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <Link href={trackHref} className="brand-gradient inline-flex min-h-[44px] items-center rounded-xl px-4 font-semibold text-white">
                {s.trackOrderCta}
              </Link>
              <Link href="/" className="inline-flex min-h-[44px] items-center rounded-xl border border-border bg-surface-2 px-4 font-semibold text-text-main">
                {s.funnelHomeCta}
              </Link>
            </div>
          </div>
        </section>
      );
    } else if (tokenOk && order) {
      const marker = await prisma.orderNote.findFirst({
        where: { orderId: order.id, text: { contains: `[funnel-accept:${step.id}]` } },
        select: { text: true },
      });
      if (marker) {
        notice = (
          <section className="mx-auto max-w-3xl px-4 pt-6">
            <div className="rounded-3xl border border-border bg-success-soft p-5 text-center shadow-card">
              <p className="font-semibold text-success-solid">✓ {s.funnelAlreadyAdded}</p>
              <Link
                href={stepHref(step.acceptStepId)}
                className="brand-gradient mt-3 inline-flex min-h-[44px] items-center rounded-xl px-5 font-bold text-white"
              >
                {s.funnelContinue}
              </Link>
            </div>
          </section>
        );
      } else if (!windowOpen) {
        notice = (
          <section className="mx-auto max-w-3xl px-4 pt-6">
            <div className="rounded-3xl border border-border bg-warning-soft p-5 text-center shadow-card">
              <p className="text-sm font-medium text-warning-solid">{s.funnelOfferExpired}</p>
            </div>
          </section>
        );
      } else if (!TERMINAL_STATUSES.has(order.status) && order.paymentMethod === "COD" && order.paymentStatus !== "PAID") {
        // §5.4: the step is offered only on COD unpaid orders inside
        // the window. (Shipped orders still see it — an accept there
        // takes the held-companion-order path server-side.)
        const catalog = await landingCatalogQueriesPublic.byIds([step.offer.productId]);
        const resolved = resolveStepOffer(step.offer, catalog);
        if (resolved) {
          const data: FunnelOfferPanelData = {
            title: resolved.title,
            productSlug: resolved.productSlug,
            imageUrl: resolved.imageUrl,
            attributesLine: Object.values(resolved.attributes).filter(Boolean).join(" · "),
            livePricePoisha: resolved.livePricePoisha,
            discountPoisha: resolved.discountPoisha,
            finalPricePoisha: resolved.finalPricePoisha,
            stock: resolved.stock,
          };
          offerPanel = (
            <FunnelOfferPanel
              locale={locale}
              orderNo={order.orderNo}
              stepId={step.id}
              token={rawToken as string}
              endsAtMs={windowEndsAtMs}
              acceptHref={stepHref(step.acceptStepId)}
              declineHref={stepHref(step.declineStepId)}
              offer={data}
            />
          );
        }
      }
    }
  }

  /* ---- thank-you step: token-verified order summary ---- */
  let summary: ReactNode = null;
  if (step.kind === "thank_you" && tokenOk && order) {
    // Accepted offers recorded on the order's timeline: amended
    // lines are already IN the items above; a fallback accept
    // created a held companion order — surface it from the marker
    // so the summary tells the whole truth.
    const markers = await prisma.orderNote.findMany({
      where: { orderId: order.id, text: { contains: "[funnel-accept:" } },
      select: { text: true },
    });
    const companionNos = markers
      .map((m) => /fallbackOrderNo=([A-Za-z0-9-]+)/.exec(m.text)?.[1])
      .filter((n): n is string => typeof n === "string");
    const companions = companionNos.length
      ? await prisma.order.findMany({
          where: { orderNo: { in: companionNos }, deletedAt: null },
          select: { orderNo: true, totalPoisha: true },
        })
      : [];
    summary = (
      <section className="mx-auto max-w-3xl px-4 pt-6">
        <div className="rounded-3xl border border-border bg-card p-5 shadow-card">
          <h2 className="font-display text-lg font-bold text-text-main">{s.funnelOrderSummaryHeading}</h2>
          <p className="mt-1 text-sm text-text-muted">
            {s.successOrderNo}: <span className="font-bold text-text-main">{order.orderNo}</span>
          </p>
          <ul className="mt-4 divide-y divide-border border-y border-border">
            {order.items.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-3 py-2.5">
                <span className="min-w-0 text-sm text-text-main">
                  {item.productName} <span className="text-text-subtle">× {qtyNumber(item.quantity)}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-text-main">
                  {formatBdt(item.unitPricePoisha * qtyNumber(item.quantity))}
                </span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-text-muted">{s.subtotalLabel}</dt>
              <dd className="tabular-nums text-text-main">{formatBdt(order.subtotalPoisha)}</dd>
            </div>
            {order.discountPoisha > 0 ? (
              <div className="flex justify-between">
                <dt className="text-text-muted">{s.funnelYouSave.replace(" {amount}", "")}</dt>
                <dd className="tabular-nums text-success-solid">−{formatBdt(order.discountPoisha)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between">
              <dt className="text-text-muted">{s.deliveryChargeLabel}</dt>
              <dd className="tabular-nums text-text-main">{formatBdt(order.shippingPoisha + order.codFeePoisha)}</dd>
            </div>
            <div className="flex justify-between border-t border-border pt-2 text-base font-bold">
              <dt className="text-text-main">
                {s.successTotalLabel} <span className="text-xs font-medium text-text-muted">{s.successTotalSuffix}</span>
              </dt>
              <dd className="tabular-nums text-text-main">{formatBdt(order.totalPoisha)}</dd>
            </div>
          </dl>
          {companions.map((c) => (
            <p key={c.orderNo} className="mt-3 rounded-xl bg-surface-2 p-3 text-sm text-text-main">
              {interpolate(s.funnelSeparateOrderNote, { orderNo: c.orderNo })} ({formatBdt(c.totalPoisha)})
            </p>
          ))}
          <Link
            href={`/track?orderNo=${encodeURIComponent(order.orderNo)}`}
            className="brand-gradient mt-4 inline-flex min-h-[44px] items-center rounded-xl px-5 font-bold text-white"
          >
            {s.trackOrderCta}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <main className="min-w-0 pb-10">
      <VisitorIdBootstrap />
      {offerPanel}
      {notice}
      {summary}
      <LandingView view={view} locale={locale} funnelForm={prepared.funnelForm} />
    </main>
  );
}
