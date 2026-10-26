import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";
import {
  KB_ARTICLES_CAP,
  KB_ARTICLES_DOC_KEY,
  findKbArticleProblems,
  kbArticleSchema,
  readKbArticles,
  saveKbArticles,
} from "@/support/docs";

// GET / PUT /api/v1/admin/support/kb-articles — the knowledge-base
// article library behind the public /kb pages (ADV-16 remainder).
// Stored as the `support.kb_articles` Setting doc (src/support/docs.ts);
// the public pages only ever show articles with published = true.
//
// RBAC mirrors the sibling ticket routes: reads ride customers.view,
// writes customers.edit. PUT replaces the WHOLE list and requires a
// `reason` — audited as settings.update on the doc key (slugs/titles
// only in the snapshots; bodies can be long). Duplicate ids or slugs
// and malformed slugs reject the whole write — nothing partial is
// ever stored.

const putSchema = z.object({
  articles: z.array(kbArticleSchema).max(KB_ARTICLES_CAP),
  reason: z.string().trim().min(1, "Reason is required."),
});

export async function GET() {
  const guard = await requireAdmin("customers.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  try {
    const articles = await readKbArticles();
    return NextResponse.json({
      data: { articles },
      meta: { persistence: "database" },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Knowledge base needs a working database connection." } },
      { status: 503 },
    );
  }
}

export async function PUT(req: Request) {
  const guard = await requireAdmin("customers.edit");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const parsed = putSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid knowledge-base payload.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const problems = findKbArticleProblems(parsed.data.articles);
  if (problems.length > 0) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Knowledge-base articles are not valid — nothing was saved.", details: problems } },
      { status: 400 },
    );
  }

  let previousCount = 0;
  try {
    previousCount = (await readKbArticles()).length;
  } catch {
    previousCount = -1; // unreadable before-state must not block the write
  }

  try {
    await saveKbArticles(parsed.data.articles, guard.userId);
  } catch {
    return NextResponse.json(
      { error: { code: "SETTINGS_SAVE_FAILED", message: "Knowledge-base articles could not be saved — database unavailable." } },
      { status: 503 },
    );
  }
  await writeAudit({
    actorId: guard.userId,
    action: "settings.update",
    entityType: "Setting",
    entityId: KB_ARTICLES_DOC_KEY,
    beforeJson: { count: previousCount },
    afterJson: {
      count: parsed.data.articles.length,
      articles: parsed.data.articles.map((a) => ({
        id: a.id,
        slug: a.slug,
        published: a.published,
      })),
    },
    reason: parsed.data.reason,
  });
  return NextResponse.json({
    data: { articles: parsed.data.articles },
    meta: { persistence: "database", saved: true },
  });
}
