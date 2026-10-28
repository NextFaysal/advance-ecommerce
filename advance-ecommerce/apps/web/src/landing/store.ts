// Landing store — DB-backed (Prisma LandingPage table).
// Same store contract as the former in-memory demo store; validate /
// render contracts unchanged. Storage mapping: the table has a single
// `title` column and a `sectionsJson` Json column. To keep the
// bilingual title contract lossless, `title` stores titleBn (Bangla-
// first) and sectionsJson stores a versioned envelope. Writers write
// v2 only (doc 34 §3.1): { v: 2, titleBn, titleEn, seo?, schedule?,
// sections }. The reader accepts v2, the v1 envelope
// { v: 1, titleBn, titleEn, sections } and bare-array sectionsJson
// forever — migration is on read, never a destructive DB rewrite, so
// a page written by any earlier version renders identically.
// SAMPLE_LANDING_PAGE below is retained as a fixture export only — the
// store no longer seeds it. Its offer references the dead TEMPORARY
// MOCK product id "prod-1": against the real catalog it resolves to
// null / fails publish validation honestly, by design.
import { prisma } from "@advance-ecommerce/db";
import type { LandingPage, LandingSchedule, LandingSection, LandingSeo, LandingStatus } from "./types";
import { transitionLandingStatus } from "./validate";
import type { LandingCatalogProduct } from "./types";

export const SAMPLE_LANDING_PAGE: LandingPage = {
  id: "lp_sample_jamdani_eid",
  slug: "jamdani-eid-offer",
  titleBn: "জামদানি শাড়ি — ঈদ অফার",
  titleEn: "Jamdani Sharee — Eid Offer",
  status: "PUBLISHED",
  sections: [
    {
      id: "sec_sample_hero", type: "hero",
      titleBn: "আসল জামদানি শাড়ি, এখন বিশেষ ছাড়ে",
      titleEn: "Authentic Jamdani Sharee, now on special offer",
      subtitleBn: "হাতে বোনা, নরম সুতি — ঈদ ও বিয়ের জন্য সেরা পছন্দ। সারাদেশে হোম ডেলিভারি।",
      subtitleEn: "Hand-woven soft cotton — perfect for Eid and weddings. Home delivery nationwide.",
      imageUrl: "/placeholder/sharee.jpg",
      ctaLabelBn: "এখনই অর্ডার করুন", ctaLabelEn: "Order Now",
    },
    {
      id: "sec_sample_offer", type: "product_offer",
      productId: "prod-1", variantId: "v-1",
      discountNoteBn: "সীমিত সময়ের অফার — আগের দামের চেয়ে কমে পাচ্ছেন",
      discountNoteEn: "Limited-time offer — below the regular price",
      showCountdown: true, countdownEndsAt: "2026-11-15T23:59:59.000Z",
    },
    {
      id: "sec_sample_benefits", type: "benefits",
      headingBn: "কেন এই জামদানি?", headingEn: "Why this Jamdani?",
      items: [
        { icon: "🧵", textBn: "১০০% হাতে বোনা আসল জামদানি", textEn: "100% hand-woven authentic Jamdani" },
        { icon: "🚚", textBn: "সারাদেশে হোম ডেলিভারি", textEn: "Home delivery across Bangladesh" },
        { icon: "💵", textBn: "ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা দিন", textEn: "Cash on Delivery — pay in hand" },
        { icon: "↩️", textBn: "ত্রুটি থাকলে সহজ রিটার্ন", textEn: "Easy return if defective" },
      ],
    },
    {
      id: "sec_sample_how", type: "how_to_order",
      headingBn: "কীভাবে অর্ডার করবেন", headingEn: "How to Order",
      steps: [
        { textBn: "নিচের “এখনই অর্ডার করুন” বোতামে চাপ দিন", textEn: "Tap the Order Now button below" },
        { textBn: "নাম, মোবাইল নম্বর ও ঠিকানা দিয়ে অর্ডার সম্পন্ন করুন", textEn: "Complete the order with your name, mobile number and address" },
        { textBn: "আমাদের টিম ফোনে নিশ্চিত করবে, পণ্য হাতে পেয়ে টাকা দিন", textEn: "Our team confirms by phone; pay when the product is in your hand" },
      ],
    },
    {
      id: "sec_sample_faq", type: "faq",
      headingBn: "সাধারণ জিজ্ঞাসা", headingEn: "FAQ",
      items: [
        { questionBn: "ডেলিভারি পেতে কতদিন লাগবে?", questionEn: "How long does delivery take?", answerBn: "ঢাকায় ২৪–৪৮ ঘণ্টা, ঢাকার বাইরে ২–৪ দিন।", answerEn: "24–48 hours inside Dhaka, 2–4 days outside." },
        { questionBn: "অগ্রিম টাকা দিতে হবে কি?", questionEn: "Do I need to pay in advance?", answerBn: "না — ক্যাশ অন ডেলিভারি, পণ্য হাতে পেয়ে যাচাই করে তারপর টাকা দেবেন।", answerEn: "No — Cash on Delivery; pay when the product is in your hand." },
      ],
    },
    {
      id: "sec_sample_note", type: "order_form_note",
      textBn: "ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে যাচাই করে তারপর টাকা দিন। কোনো অগ্রিম পেমেন্ট লাগবে না।",
      textEn: "Cash on Delivery — check the product in hand, then pay. No advance payment needed.",
    },
    {
      id: "sec_sample_footer", type: "footer_note",
      textBn: "অফারটি স্টক থাকা সাপেক্ষে প্রযোজ্য। (SAMPLE ল্যান্ডিং পেজ — TEMPORARY DEMO)",
      textEn: "Offer valid while stock lasts. (SAMPLE landing page — TEMPORARY DEMO)",
    },
  ],
  createdAt: "2026-10-20T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
};

const LANDING_STATUSES: readonly string[] = ["DRAFT", "PUBLISHED", "ARCHIVED"];

interface LandingRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  sectionsJson: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredEnvelope {
  v: 1 | 2;
  titleBn: string;
  titleEn: string;
  seo?: LandingSeo;
  schedule?: LandingSchedule;
  sections: LandingSection[];
}

/** Shape-guard a stored seo object (rows are only ever written by
 *  pageToData, but a hand-edited/foreign row must degrade to "absent"
 *  rather than leak a malformed object into the page model). */
function readSeo(raw: unknown): LandingSeo | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const o = raw as Partial<LandingSeo>;
  if (
    typeof o.metaTitleBn !== "string" || typeof o.metaTitleEn !== "string" ||
    typeof o.metaDescriptionBn !== "string" || typeof o.metaDescriptionEn !== "string" ||
    !(typeof o.ogImageUrl === "string" || o.ogImageUrl === null)
  ) return undefined;
  return {
    metaTitleBn: o.metaTitleBn, metaTitleEn: o.metaTitleEn,
    metaDescriptionBn: o.metaDescriptionBn, metaDescriptionEn: o.metaDescriptionEn,
    ogImageUrl: o.ogImageUrl,
  };
}

function readSchedule(raw: unknown): LandingSchedule | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const o = raw as Partial<LandingSchedule>;
  const okBound = (v: unknown) => typeof v === "string" || v === null || v === undefined;
  if (!okBound(o.publishAt) || !okBound(o.expiresAt)) return undefined;
  return { publishAt: o.publishAt ?? null, expiresAt: o.expiresAt ?? null };
}

function rowToPage(row: LandingRow): LandingPage {
  let titleBn = row.title;
  let titleEn = row.title;
  let sections: LandingSection[] = [];
  let seo: LandingSeo | undefined;
  let schedule: LandingSchedule | undefined;
  const raw = row.sectionsJson;
  if (Array.isArray(raw)) {
    sections = raw as LandingSection[];
  } else if (raw !== null && typeof raw === "object") {
    const env = raw as Partial<StoredEnvelope>;
    sections = (env.sections ?? []) as LandingSection[];
    if (typeof env.titleBn === "string") titleBn = env.titleBn;
    if (typeof env.titleEn === "string") titleEn = env.titleEn;
    seo = readSeo(env.seo);
    schedule = readSchedule(env.schedule);
  }
  return {
    id: row.id,
    slug: row.slug,
    titleBn,
    titleEn,
    status: (LANDING_STATUSES.includes(row.status) ? row.status : "DRAFT") as LandingStatus,
    sections,
    ...(seo ? { seo } : {}),
    ...(schedule ? { schedule } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function pageToData(input: Omit<LandingPage, "id" | "createdAt" | "updatedAt">) {
  const envelope: StoredEnvelope = {
    v: 2,
    titleBn: input.titleBn,
    titleEn: input.titleEn,
    ...(input.seo ? { seo: input.seo } : {}),
    ...(input.schedule ? { schedule: input.schedule } : {}),
    sections: input.sections,
  };
  return {
    slug: input.slug,
    title: input.titleBn,
    status: input.status,
    sectionsJson: envelope as unknown as object,
  };
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

export class LandingStore {
  async list(): Promise<LandingPage[]> {
    const rows = await prisma.landingPage.findMany({ orderBy: { updatedAt: "desc" } });
    return rows.map(rowToPage);
  }

  async get(id: string): Promise<LandingPage | undefined> {
    const row = await prisma.landingPage.findUnique({ where: { id } });
    return row ? rowToPage(row) : undefined;
  }

  async getBySlug(slug: string): Promise<LandingPage | undefined> {
    const row = await prisma.landingPage.findUnique({ where: { slug } });
    return row ? rowToPage(row) : undefined;
  }

  /**
   * Only PUBLISHED pages are publicly visible — drafts/archived return
   * undefined here. A v2 schedule window is evaluated lazily at this
   * read (doc 34 §3.1): before publishAt or after expiresAt the page
   * is treated exactly like an unpublished one, so nothing about the
   * window leaks and no worker has to flip it at the boundary.
   */
  async getPublishedBySlug(slug: string): Promise<LandingPage | undefined> {
    const page = await this.getBySlug(slug);
    if (!page || page.status !== "PUBLISHED") return undefined;
    if (page.schedule) {
      const now = Date.now();
      if (page.schedule.publishAt && Date.parse(page.schedule.publishAt) > now) return undefined;
      if (page.schedule.expiresAt && Date.parse(page.schedule.expiresAt) <= now) return undefined;
    }
    return page;
  }

  async otherSlugs(excludeId?: string): Promise<string[]> {
    const rows = await prisma.landingPage.findMany({
      where: excludeId ? { id: { not: excludeId } } : {},
      select: { slug: true },
    });
    return rows.map((r) => r.slug);
  }

  async create(input: Omit<LandingPage, "id" | "createdAt" | "updatedAt">): Promise<LandingPage> {
    if (await this.getBySlug(input.slug)) throw new Error("slug_already_exists");
    try {
      const row = await prisma.landingPage.create({ data: pageToData(input) });
      return rowToPage(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new Error("slug_already_exists");
      throw e;
    }
  }

  async update(id: string, input: Omit<LandingPage, "id" | "createdAt" | "updatedAt">): Promise<LandingPage> {
    const existing = await this.get(id);
    if (!existing) throw new Error("landing_page_not_found");
    const clash = await this.getBySlug(input.slug);
    if (clash && clash.id !== id) throw new Error("slug_already_exists");
    // Envelope-v2 preservation: a full-body save from a client that
    // does not know seo/schedule yet (the builder until L6) must not
    // silently drop values an API client stored earlier.
    const merged: Omit<LandingPage, "id" | "createdAt" | "updatedAt"> = {
      ...input,
      seo: input.seo ?? existing.seo,
      schedule: input.schedule ?? existing.schedule,
    };
    try {
      const row = await prisma.landingPage.update({ where: { id }, data: pageToData(merged) });
      return rowToPage(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw new Error("slug_already_exists");
      throw e;
    }
  }

  async setStatus(
    id: string,
    to: LandingPage["status"],
    catalog: readonly LandingCatalogProduct[],
    collections?: Readonly<Record<string, readonly LandingCatalogProduct[] | null | undefined>>,
  ) {
    const existing = await this.get(id);
    if (!existing) throw new Error("landing_page_not_found");
    const result = transitionLandingStatus(existing, to, catalog, await this.otherSlugs(id), collections);
    if (!result.ok) return result;
    const row = await prisma.landingPage.update({
      where: { id },
      data: { status: result.page.status },
    });
    return { ok: true as const, page: rowToPage(row) };
  }

  /**
   * Duplicate a page as a fresh DRAFT (doc 34 L6) — the products
   * duplicate precedent (POST .../[id]/duplicate) at page level:
   * sections are deep-copied (the copy edits independently), the SEO
   * block carries over (it is page identity), the slug is uniquified
   * as "<slug>-copy", then "-copy-2", "-copy-3", …, and the status
   * is NEVER copied — a copy of a published page starts as a draft.
   * The schedule window deliberately does NOT carry over: it was the
   * source campaign's run window, and a stale/expired window on a
   * new draft would silently 404 the copy the moment it publishes.
   */
  async duplicate(id: string): Promise<LandingPage> {
    const source = await this.get(id);
    if (!source) throw new Error("landing_page_not_found");
    const taken = new Set(await this.otherSlugs());
    let slug: string | null = null;
    for (let n = 1; n <= 100; n += 1) {
      const candidate = n === 1 ? `${source.slug}-copy` : `${source.slug}-copy-${n}`;
      if (!taken.has(candidate)) {
        slug = candidate;
        break;
      }
    }
    if (slug === null) throw new Error("copy_limit");
    return this.create({
      slug,
      titleBn: source.titleBn,
      titleEn: source.titleEn,
      status: "DRAFT",
      sections: JSON.parse(JSON.stringify(source.sections)) as LandingSection[],
      ...(source.seo ? { seo: { ...source.seo } } : {}),
    });
  }

  async delete(id: string): Promise<boolean> {
    try {
      await prisma.landingPage.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}

/** Shared DB-backed singleton for the landing API routes + public page. */
export const landingStore = new LandingStore();
