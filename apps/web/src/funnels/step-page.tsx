/**
 * Funnel step rendering — the L7 layer (doc 34 §3.7, wave L7).
 *
 * Two public routes share this module:
 *   /f/<slug>            → the entry route (this file's
 *                          renderFunnelStepPage renders steps[0])
 *   /f/<slug>/<stepId>   → L8's step route (offer panel + thank-you
 *                          summary live there); it calls
 *                          prepareFunnelStepRender() below so BOTH
 *                          routes share the same L7 guarantees:
 *
 *   1. PUBLISHED-ONLY PAGES. A step's page resolves through
 *      runtime.getPublishedStepPage (status PUBLISHED + schedule
 *      window, by id) — a draft/archived step page 404s identically
 *      to an unknown step; funnel membership never leaks a page.
 *   2. A/B (§3.8). A running funnel_step experiment may swap the
 *      page for the visitor's variant page (the seam records the
 *      exposure itself; the variant page passes the SAME published
 *      gate, falling back to the step's own page). The experiments
 *      store may key the target by funnel DB id or slug — both are
 *      tried. Failure-isolated: experiments never break a render.
 *   3. VIEW EVENTS (§3.8). Every step render writes the
 *      `funnel:<id>:<stepId>:view` TrackingEvent (runtime helper,
 *      failure-isolated).
 *   4. ORDER-STEP CLAIMS. For an order step, the QuickOrderForm
 *      gains the funnel claims: the context claim (attribution +
 *      continuation, always) and — when the step's bump still
 *      resolves in-stock against the live catalog — the §3.7 bump
 *      claim + card data. Claims need a signing secret; without
 *      one the form is the plain /lp form (orders still work,
 *      unattributed, no continuation).
 *
 * Everything renders through the SHARED landing pipeline (the /lp
 * data path: by-id catalog queries, extras pass,
 * buildLandingViewModel, LandingView) — funnels fork nothing.
 *
 * Server-only module (cookies, prisma reads, env secrets).
 */
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { landingCatalogQueriesPublic, referencedProductIds } from "@/landing/catalog";
import { buildLandingViewModel } from "@/landing/render";
import { resolveLandingExtras } from "@/landing/resolve-extras";
import { LandingView } from "@/landing/components/LandingView";
import type { QuickOrderFunnelContext } from "@/landing/components/QuickOrderForm";
import { LANDING_STRINGS } from "@/landing/strings";
import type { LandingPage } from "@/landing/types";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { VisitorIdBootstrap } from "@/marketing/components/VisitorIdBootstrap";
import { resolveFunnelStepForVisitor } from "@/marketing/experiments";
import { createBumpClaim, createFunnelContextClaim } from "./claims";
import { resolveStepOffer } from "./offer";
import {
  funnelStepUrl,
  getPublishedStepPage,
  nextStepAfter,
  recordFunnelStepView,
} from "./runtime";
import type { Funnel, FunnelStep } from "./types";

/** Step metadata — the /lp page's own logic applied to the step's
 *  page (seo block when the owner saved one, else the historical
 *  title fallback). Used by the entry route; L8's step route has
 *  its own equivalent. */
export async function funnelStepMetadata(funnel: Funnel, step: FunnelStep): Promise<Metadata> {
  void funnel;
  const page = await getPublishedStepPage(step.pageId);
  if (!page) return { title: "পেজ পাওয়া যায়নি" };
  if (!page.seo) return { title: page.titleBn, description: page.titleEn };
  const locale = await getRequestLocale();
  const seo = page.seo;
  const pickField = (bn: string, en: string): string =>
    locale === "en" ? en.trim() || bn.trim() : bn.trim() || en.trim();
  const title = pickField(seo.metaTitleBn, seo.metaTitleEn) || (locale === "en" ? page.titleEn : page.titleBn);
  const description = pickField(seo.metaDescriptionBn, seo.metaDescriptionEn);
  const ogImageUrl = seo.ogImageUrl?.trim() ? seo.ogImageUrl : null;
  return {
    title,
    ...(description ? { description } : {}),
    openGraph: {
      title,
      ...(description ? { description } : {}),
      type: "website",
      ...(ogImageUrl ? { images: [{ url: ogImageUrl }] } : {}),
    },
  };
}

/** The order step's funnel form context (claims + bump card data),
 *  or undefined when claims cannot be minted (no signing secret —
 *  the form then behaves exactly like the /lp form). */
async function buildOrderStepFunnelForm(
  funnel: Funnel,
  step: Extract<FunnelStep, { kind: "order" }>,
): Promise<QuickOrderFunnelContext | undefined> {
  const contextClaim = createFunnelContextClaim({ funnelId: funnel.id, stepId: step.id });
  if (!contextClaim) return undefined;
  const form: QuickOrderFunnelContext = { claim: contextClaim };
  if (step.bump) {
    const products = await landingCatalogQueriesPublic.byIds([step.bump.productId]);
    const resolved = resolveStepOffer(step.bump, products);
    // The card is offered only while the resolved variant is in
    // stock — an out-of-stock bump is not rendered (the server
    // would drop the line anyway; not showing it is honester).
    if (resolved && resolved.stock > 0) {
      const claim = createBumpClaim({
        funnelId: funnel.id,
        stepId: step.id,
        variantId: resolved.variantId,
        discount: step.bump.discount,
      });
      if (claim) {
        form.bump = {
          headingBn: step.bump.headingBn,
          headingEn: step.bump.headingEn,
          productTitleBn: resolved.title.bn,
          productTitleEn: resolved.title.en,
          variantLabel: Object.values(resolved.attributes).join(" / "),
          imageUrl: resolved.imageUrl,
          livePricePoisha: resolved.livePricePoisha,
          discountedPoisha: resolved.finalPricePoisha,
          claim,
        };
      }
    }
  }
  return form;
}

/**
 * The shared L7 preparation for one step render: A/B page swap +
 * §3.8 view event + (for order steps) the funnel form claims.
 * `basePage` must already have passed the published gate. Returns
 * the page to render (the step's own page, or the experiment
 * variant's) and the QuickOrderForm funnel context when the step
 * is an order step.
 */
export async function prepareFunnelStepRender(
  funnel: Funnel,
  step: FunnelStep,
  basePage: LandingPage,
): Promise<{ page: LandingPage; funnelForm?: QuickOrderFunnelContext }> {
  const visitorId = cookies().get("ae_vid")?.value ?? null;
  let page = basePage;
  try {
    const resolution =
      (await resolveFunnelStepForVisitor(funnel.id, step.id, visitorId)) ??
      (await resolveFunnelStepForVisitor(funnel.slug, step.id, visitorId));
    if (resolution?.pageId && resolution.pageId !== step.pageId) {
      const variantPage = await getPublishedStepPage(resolution.pageId);
      if (variantPage) page = variantPage;
    }
  } catch (e) {
    console.error("[funnels] step experiment resolution failed — serving the step page", e);
  }

  // §3.8 view event (one per render; failure-isolated inside).
  await recordFunnelStepView(funnel.id, step.id);

  const funnelForm = step.kind === "order" ? await buildOrderStepFunnelForm(funnel, step) : undefined;
  return { page, funnelForm };
}

/**
 * The entry route's renderer: steps[0] through the shared landing
 * pipeline, plus — for a landing step — the continue button to the
 * sequential next step (the graph's forward edge; the page's own
 * CTAs remain the owner's design choice).
 */
export async function renderFunnelStepPage(funnel: Funnel, step: FunnelStep) {
  const locale = await getRequestLocale();
  const basePage = await getPublishedStepPage(step.pageId);
  if (!basePage) notFound();
  const { page, funnelForm } = await prepareFunnelStepRender(funnel, step, basePage);
  const products = await landingCatalogQueriesPublic.byIds(referencedProductIds(page));
  const extras = await resolveLandingExtras(page, landingCatalogQueriesPublic);
  const view = buildLandingViewModel(page, products, extras);
  const next = step.kind === "landing" ? nextStepAfter(funnel, step.id) : null;
  const s = pick(locale, LANDING_STRINGS);
  return (
    <main className="min-w-0 pb-10">
      <VisitorIdBootstrap />
      <LandingView view={view} locale={locale} funnelForm={funnelForm} />
      {next ? (
        <div className="mx-auto mt-6 max-w-3xl px-5">
          <a
            href={funnelStepUrl(funnel.slug, next.id)}
            className="brand-gradient flex min-h-12 items-center justify-center rounded-xl px-4 py-3 text-lg font-bold text-white shadow-lift transition hover:opacity-95"
          >
            {s.funnelContinue}
          </a>
        </div>
      ) : null}
    </main>
  );
}
