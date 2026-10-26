/**
 * Product Q&A store — Prisma-backed (ProductQuestion, migration
 * 20261026016000). Server-only.
 *
 * VISIBILITY CONTRACT: the public PDP list is ANSWERED + not
 * soft-deleted ONLY. PENDING questions are a staff-only moderation
 * queue; HIDDEN questions are visible to staff but never publicly.
 * Asking requires a signed-in customer (enforced at the API route);
 * the author name is snapshotted from the customer record at ask
 * time, like Review.authorName.
 */
import { prisma } from "@advance-ecommerce/db";
import { QUESTION_STATUSES, type QuestionStatus } from "./schema";

/* ------------------------------- views ------------------------------ */

/** Public view — answered questions only, name + Q/A text. */
export interface PublicQuestion {
  id: string;
  authorName: string;
  question: string;
  answer: string;
  answeredAt: string | null;
  createdAt: string;
}

/** Admin moderation view — every status, with the product context. */
export interface AdminQuestion {
  id: string;
  productId: string;
  productTitleBn: string;
  productSlug: string;
  authorName: string;
  question: string;
  answer: string | null;
  status: QuestionStatus;
  createdAt: string;
  answeredAt: string | null;
}

/* ---------------------------- internals ----------------------------- */

function asStatus(value: string): QuestionStatus {
  return (QUESTION_STATUSES as readonly string[]).includes(value)
    ? (value as QuestionStatus)
    : "PENDING";
}

type QuestionRow = Awaited<ReturnType<typeof prisma.productQuestion.findMany>>[number];

/* ------------------------------ writes ------------------------------ */

/** Ask a question. Born PENDING — invisible publicly until answered. */
export async function askQuestion(
  productId: string,
  customer: { id: string; name: string },
  question: string,
): Promise<{ id: string; status: QuestionStatus }> {
  const row = await prisma.productQuestion.create({
    data: {
      productId,
      customerId: customer.id,
      authorName: customer.name,
      question,
      status: "PENDING",
    },
    select: { id: true, status: true },
  });
  return { id: row.id, status: asStatus(row.status) };
}

/**
 * Staff answer: sets answer / answeredById / answeredAt and moves
 * the question to ANSWERED — the moment it becomes publicly visible.
 * Re-answering an ANSWERED or HIDDEN question updates the answer.
 * Returns the admin view, or null when not found / soft-deleted.
 */
export async function answerQuestion(
  id: string,
  staffUserId: string,
  answer: string,
): Promise<AdminQuestion | null> {
  const existing = await prisma.productQuestion.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) return null;
  await prisma.productQuestion.update({
    where: { id },
    data: { answer, answeredById: staffUserId, answeredAt: new Date(), status: "ANSWERED" },
  });
  const rows = await listQuestionsForAdmin(undefined, id);
  return rows[0] ?? null;
}

/** Hide a question from the public (staff only). Null when missing. */
export async function hideQuestion(id: string): Promise<AdminQuestion | null> {
  const existing = await prisma.productQuestion.findFirst({
    where: { id, deletedAt: null },
    select: { id: true },
  });
  if (!existing) return null;
  await prisma.productQuestion.update({ where: { id }, data: { status: "HIDDEN" } });
  const rows = await listQuestionsForAdmin(undefined, id);
  return rows[0] ?? null;
}

/**
 * Undo a hide: back to ANSWERED when an answer exists, otherwise
 * back to PENDING. Null when missing / soft-deleted.
 */
export async function restoreQuestion(id: string): Promise<AdminQuestion | null> {
  const existing = await prisma.productQuestion.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, answer: true },
  });
  if (!existing) return null;
  await prisma.productQuestion.update({
    where: { id },
    data: { status: existing.answer ? "ANSWERED" : "PENDING" },
  });
  const rows = await listQuestionsForAdmin(undefined, id);
  return rows[0] ?? null;
}

/* ------------------------------ reads ------------------------------- */

/** ANSWERED, not-deleted questions for the PDP, latest answers first. */
export async function listAnsweredQuestions(productId: string, take = 20): Promise<PublicQuestion[]> {
  const rows = await prisma.productQuestion.findMany({
    where: { productId, status: "ANSWERED", deletedAt: null, answer: { not: null } },
    orderBy: [{ answeredAt: "desc" }, { createdAt: "desc" }],
    take,
  });
  return rows.map((row: QuestionRow) => ({
    id: row.id,
    authorName: row.authorName,
    question: row.question,
    answer: row.answer as string,
    answeredAt: row.answeredAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

/** Moderation queue. With `onlyId`, returns just that question. */
export async function listQuestionsForAdmin(
  status?: QuestionStatus,
  onlyId?: string,
): Promise<AdminQuestion[]> {
  const rows = await prisma.productQuestion.findMany({
    where: {
      deletedAt: null,
      ...(onlyId ? { id: onlyId } : status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: onlyId ? 1 : 100,
    include: { product: { select: { titleBn: true, slug: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    productTitleBn: row.product.titleBn,
    productSlug: row.product.slug,
    authorName: row.authorName,
    question: row.question,
    answer: row.answer,
    status: asStatus(row.status),
    createdAt: row.createdAt.toISOString(),
    answeredAt: row.answeredAt?.toISOString() ?? null,
  }));
}

/** Per-status counts for the moderation tabs. */
export async function countQuestionsByStatus(): Promise<Record<QuestionStatus, number>> {
  const grouped = await prisma.productQuestion.groupBy({
    by: ["status"],
    where: { deletedAt: null },
    _count: { _all: true },
  });
  const counts: Record<QuestionStatus, number> = { PENDING: 0, ANSWERED: 0, HIDDEN: 0 };
  for (const g of grouped) {
    if ((QUESTION_STATUSES as readonly string[]).includes(g.status)) {
      counts[g.status as QuestionStatus] = g._count._all;
    }
  }
  return counts;
}
