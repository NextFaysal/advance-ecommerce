/**
 * Review helpful votes — Prisma-backed (ReviewHelpfulVote +
 * Review.helpfulCount, migration 20261026016000). Server-only.
 *
 * VOTER KEY CONTRACT: a vote is keyed by an opaque voterKey —
 * `cust:<Customer.id>` for a signed-in customer, or
 * `guest:<sha256(ip|user-agent)>` for a guest. Raw IPs / user agents
 * are NEVER stored; the hash is one-way and only ever used for the
 * (reviewId, voterKey) uniqueness check. One voter = at most one
 * vote per review, enforced by the DB unique constraint; a repeat
 * vote is a no-op that returns the current count (never an error,
 * never a double count).
 *
 * COUNT SYNC: Review.helpfulCount is incremented in the SAME
 * transaction that inserts the vote row, so the denormalized count
 * the PDP renders can never drift from the vote table.
 */
import { createHash } from "node:crypto";
import { prisma } from "@advance-ecommerce/db";

/** Voter key for a signed-in customer. */
export function customerVoterKey(customerId: string): string {
  return `cust:${customerId}`;
}

/** Voter key for a guest: sha256 of ip|user-agent, hex. One-way —
 *  the raw values are never persisted anywhere. */
export function guestVoterKey(ip: string, userAgent: string | undefined): string {
  const hash = createHash("sha256").update(`${ip}|${userAgent ?? ""}`).digest("hex");
  return `guest:${hash}`;
}

export interface HelpfulVoteResult {
  helpfulCount: number;
  /** True when this call recorded the vote; false on a duplicate. */
  counted: boolean;
}

/**
 * Cast a helpful vote on an APPROVED, non-deleted review. Returns
 * null when no such review exists (missing, still PENDING/REJECTED,
 * or deleted — none of those are publicly votable). Duplicates
 * return the current count with `counted: false`.
 */
export async function castHelpfulVote(
  reviewId: string,
  voterKey: string,
): Promise<HelpfulVoteResult | null> {
  const review = await prisma.review.findFirst({
    where: { id: reviewId, status: "APPROVED", deletedAt: null },
    select: { id: true, helpfulCount: true },
  });
  if (!review) return null;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.reviewHelpfulVote.findUnique({
      where: { reviewId_voterKey: { reviewId, voterKey } },
      select: { id: true },
    });
    if (existing) {
      const current = await tx.review.findUnique({
        where: { id: reviewId },
        select: { helpfulCount: true },
      });
      return { helpfulCount: current?.helpfulCount ?? review.helpfulCount, counted: false };
    }
    await tx.reviewHelpfulVote.create({ data: { reviewId, voterKey } });
    const updated = await tx.review.update({
      where: { id: reviewId },
      data: { helpfulCount: { increment: 1 } },
      select: { helpfulCount: true },
    });
    return { helpfulCount: updated.helpfulCount, counted: true };
  });
}

/** Which of `reviewIds` this voter has already voted on — drives the
 *  PDP button's pressed state. */
export async function listVotedReviewIds(
  voterKey: string,
  reviewIds: string[],
): Promise<string[]> {
  if (reviewIds.length === 0) return [];
  const rows = await prisma.reviewHelpfulVote.findMany({
    where: { voterKey, reviewId: { in: reviewIds } },
    select: { reviewId: true },
  });
  return rows.map((r) => r.reviewId);
}
