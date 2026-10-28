-- Funnels (doc 34 §3.7, CartFlows layer): orchestration only — an
-- ordered step graph whose steps reference ordinary LandingPage
-- rows. The graph itself (kinds, page refs, bump/upsell offers with
-- discount RULES — never prices) lives in the stepsJson envelope
-- { v: 1, steps: [...] }; name is a real column like the landing
-- store's columns because a funnel name is owner-facing only (no
-- bilingual title). Owned by src/funnels/store.ts.
--
-- NOTE (production): `prisma migrate deploy` is deliberately NOT
-- part of the Vercel build (docs/RUNBOOK-LOCAL.md — migrations run
-- manually, Step 4, with the DIRECT Neon connection string). This
-- migration must be applied by that manual step before the funnel
-- admin/runtime can work against the production database.

-- CreateTable
CREATE TABLE "Funnel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "stepsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Funnel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Funnel_slug_key" ON "Funnel"("slug");
