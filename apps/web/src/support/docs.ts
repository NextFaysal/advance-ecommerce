/**
 * Support content docs — canned replies + knowledge base (ADV-16
 * remainder, doc 22). Server-only.
 *
 * Storage: two Setting JSON docs, the established Setting-doc pattern
 * (security.ip_rules / warehouse.pick_lists) — the generic settings
 * API rejects unknown keys and these docs are machine-shaped, so they
 * get their own zod-validated store over prisma.setting:
 *
 *   support.canned_replies = [{ id, title, body }]
 *   support.kb_articles    = [{ id, slug, titleBn, titleEn, bodyBn,
 *                               bodyEn, published }]
 *
 * Reads through getSetting (so the 30s memo + Redis layer apply);
 * writes go through saveSupportDoc (direct upsert +
 * invalidateSettingCache), called by the admin API routes, which own
 * the guard + audit. Parse NEVER throws: a missing/corrupt doc reads
 * as its valid subset (empty when nothing valid) — an empty KB is an
 * honest state, not an error page.
 *
 * The public /kb pages use the *Safe loaders at the bottom: they
 * swallow read failures into an empty result so the ISR pages render
 * their honest empty state instead of failing a build/render when
 * the database is briefly unreachable. The admin routes use the
 * strict readers so an outage surfaces as an outage there.
 */
import { prisma } from "@advance-ecommerce/db";
import { z } from "zod";
import { getSetting, invalidateSettingCache } from "@/lib/settings";

export const CANNED_REPLIES_DOC_KEY = "support.canned_replies";
export const KB_ARTICLES_DOC_KEY = "support.kb_articles";

export const CANNED_REPLIES_CAP = 100;
export const KB_ARTICLES_CAP = 200;

/* ------------------------------ shapes ------------------------------ */

export interface CannedReply {
  id: string;
  title: string;
  body: string;
}

export interface KbArticle {
  id: string;
  slug: string;
  titleBn: string;
  titleEn: string;
  bodyBn: string;
  bodyEn: string;
  published: boolean;
}

/** URL-safe slug: lowercase letters/digits joined by single hyphens. */
export const KB_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const cannedReplySchema = z.object({
  id: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
});

export const cannedRepliesDocSchema = z.object({
  replies: z.array(cannedReplySchema).max(CANNED_REPLIES_CAP),
});

export const kbArticleSchema = z.object({
  id: z.string().trim().min(1).max(64),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(KB_SLUG_PATTERN, "Slug must be lowercase letters, digits and hyphens."),
  titleBn: z.string().trim().min(1).max(200),
  titleEn: z.string().trim().max(200),
  bodyBn: z.string().trim().min(1).max(20000),
  bodyEn: z.string().trim().max(20000),
  published: z.boolean(),
});

export const kbArticlesDocSchema = z.object({
  articles: z.array(kbArticleSchema).max(KB_ARTICLES_CAP),
});

/* ------------------------------ parsing ----------------------------- */

function parseDoc(raw: string | null): unknown {
  if (raw === null || raw === "") return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function parseCannedReplies(raw: string | null): CannedReply[] {
  const parsed = cannedRepliesDocSchema.safeParse(parseDoc(raw));
  return parsed.success ? parsed.data.replies : [];
}

export function parseKbArticles(raw: string | null): KbArticle[] {
  const parsed = kbArticlesDocSchema.safeParse(parseDoc(raw));
  return parsed.success ? parsed.data.articles : [];
}

/** Duplicate id/slug check for writes — returns human-readable problems. */
export function findCannedReplyProblems(replies: CannedReply[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of replies) {
    if (seen.has(r.id)) problems.push(`Duplicate canned reply id: ${r.id}`);
    seen.add(r.id);
  }
  return problems;
}

export function findKbArticleProblems(articles: KbArticle[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const a of articles) {
    if (ids.has(a.id)) problems.push(`Duplicate article id: ${a.id}`);
    ids.add(a.id);
    if (slugs.has(a.slug)) problems.push(`Duplicate article slug: ${a.slug}`);
    slugs.add(a.slug);
  }
  return problems;
}

/* ------------------------------- reads ------------------------------ */

/** Strict readers (admin surfaces): a DB failure propagates. */
export async function readCannedReplies(): Promise<CannedReply[]> {
  return parseCannedReplies(await getSetting(CANNED_REPLIES_DOC_KEY));
}

export async function readKbArticles(): Promise<KbArticle[]> {
  return parseKbArticles(await getSetting(KB_ARTICLES_DOC_KEY));
}

/** Safe loaders for the public /kb ISR pages: failure → empty. */
export async function listPublishedKbArticlesSafe(): Promise<KbArticle[]> {
  try {
    return (await readKbArticles()).filter((a) => a.published);
  } catch {
    return [];
  }
}

export async function getPublishedKbArticleSafe(slug: string): Promise<KbArticle | null> {
  const articles = await listPublishedKbArticlesSafe();
  return articles.find((a) => a.slug === slug) ?? null;
}

/* ------------------------------- writes ----------------------------- */

const DOC_DESCRIPTIONS: Record<string, string> = {
  [CANNED_REPLIES_DOC_KEY]: "Support canned replies (JSON, ADV-16)",
  [KB_ARTICLES_DOC_KEY]: "Support knowledge-base articles (JSON, ADV-16)",
};

async function saveSupportDoc(
  key: string,
  value: unknown,
  actorId: string,
): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: {
      key,
      value: JSON.stringify(value),
      valueEncrypted: false,
      isPublic: false,
      category: "support",
      description: DOC_DESCRIPTIONS[key] ?? "Support content doc (JSON, ADV-16)",
      updatedById: actorId,
    },
    update: { value: JSON.stringify(value), valueEncrypted: false, updatedById: actorId },
  });
  invalidateSettingCache(key);
}

export async function saveCannedReplies(replies: CannedReply[], actorId: string): Promise<void> {
  await saveSupportDoc(CANNED_REPLIES_DOC_KEY, { replies }, actorId);
}

export async function saveKbArticles(articles: KbArticle[], actorId: string): Promise<void> {
  await saveSupportDoc(KB_ARTICLES_DOC_KEY, { articles }, actorId);
}
