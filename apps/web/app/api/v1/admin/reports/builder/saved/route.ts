import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { validateReportDefinition } from "@/reports/builder";
import {
  deleteSavedReport,
  listSavedReports,
  prismaKeyValueStore,
  upsertSavedReport,
} from "@/reports/saved-reports";

// Saved report definitions (ADV-8) — persisted as one JSON document
// in the Setting table (src/reports/saved-reports.ts; the CMS /
// call-center scripts-store pattern — no new table).
// GET: list (reports.view). POST: create/update (reports.export —
// the closest write permission that exists for reports).
// DELETE ?id=: remove (reports.export).

export async function GET() {
  const guard = await requireAdmin("reports.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const reports = await listSavedReports(prismaKeyValueStore());
  return NextResponse.json({ data: { reports }, meta: { source: "database" } });
}

const saveBodySchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  definition: z.unknown(),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("reports.export");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const parsed = saveBodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "name and definition are required." } }, { status: 400 });
  }
  const validated = validateReportDefinition(parsed.data.definition);
  if (!validated.ok) {
    return NextResponse.json({ error: { code: "INVALID_DEFINITION", message: validated.message } }, { status: 400 });
  }
  const saved = await upsertSavedReport(
    prismaKeyValueStore(),
    { id: parsed.data.id, name: parsed.data.name, definition: validated.definition },
    guard.userId,
    new Date().toISOString(),
    crypto.randomUUID(),
  );
  return NextResponse.json({ data: { report: saved }, meta: { source: "database" } });
}

export async function DELETE(req: Request) {
  const guard = await requireAdmin("reports.export");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (id === "") {
    return NextResponse.json({ error: { code: "INVALID_INPUT", message: "id is required." } }, { status: 400 });
  }
  const removed = await deleteSavedReport(prismaKeyValueStore(), id, guard.userId);
  if (!removed) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Saved report not found." } }, { status: 404 });
  }
  return NextResponse.json({ data: { deleted: true } });
}
