import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { writeAudit } from "@/lib/audit";
import {
  CANNED_REPLIES_CAP,
  CANNED_REPLIES_DOC_KEY,
  cannedReplySchema,
  findCannedReplyProblems,
  readCannedReplies,
  saveCannedReplies,
} from "@/support/docs";

// GET / PUT /api/v1/admin/support/canned-replies — the canned-reply
// library behind the ticket reply box's "insert" picker (ADV-16
// remainder). Stored as the `support.canned_replies` Setting doc
// (src/support/docs.ts).
//
// RBAC mirrors the sibling ticket routes: reads ride customers.view,
// writes customers.edit. PUT replaces the WHOLE list and requires a
// `reason` — the change is audited as settings.update on the doc key
// (ids + titles only in the audit snapshots; bodies can be long).
// One invalid entry rejects the whole write — nothing partial is
// ever stored.

const putSchema = z.object({
  replies: z.array(cannedReplySchema).max(CANNED_REPLIES_CAP),
  reason: z.string().trim().min(1, "Reason is required."),
});

export async function GET() {
  const guard = await requireAdmin("customers.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  try {
    const replies = await readCannedReplies();
    return NextResponse.json({
      data: { replies },
      meta: { persistence: "database" },
    });
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Canned replies need a working database connection." } },
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
      { error: { code: "INVALID_INPUT", message: "Invalid canned replies payload.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const problems = findCannedReplyProblems(parsed.data.replies);
  if (problems.length > 0) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Canned replies are not valid — nothing was saved.", details: problems } },
      { status: 400 },
    );
  }

  let previousCount = 0;
  try {
    previousCount = (await readCannedReplies()).length;
  } catch {
    previousCount = -1; // unreadable before-state must not block the write
  }

  try {
    await saveCannedReplies(parsed.data.replies, guard.userId);
  } catch {
    return NextResponse.json(
      { error: { code: "SETTINGS_SAVE_FAILED", message: "Canned replies could not be saved — database unavailable." } },
      { status: 503 },
    );
  }
  await writeAudit({
    actorId: guard.userId,
    action: "settings.update",
    entityType: "Setting",
    entityId: CANNED_REPLIES_DOC_KEY,
    beforeJson: { count: previousCount },
    afterJson: {
      count: parsed.data.replies.length,
      replies: parsed.data.replies.map((r) => ({ id: r.id, title: r.title })),
    },
    reason: parsed.data.reason,
  });
  return NextResponse.json({
    data: { replies: parsed.data.replies },
    meta: { persistence: "database", saved: true },
  });
}
