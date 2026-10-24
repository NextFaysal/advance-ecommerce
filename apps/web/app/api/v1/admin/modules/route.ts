import { NextResponse } from "next/server";
import { guardError, requireAdmin } from "@/reports/guard";
import { demoAdapterRegistry } from "@/extensibility/registry";
import { ALL_PACKS, validatePackConfig } from "@/business-modules/packs";
import { demoPackFlags } from "@/business-modules/types";
import { DEFAULT_CHART_OF_ACCOUNTS } from "@/erp/accounts";
import { z } from "zod";

// Business modules + extensibility catalog — Agent 17, Step 49 (Part C / A13-A16).
// RBAC: settings.integrations. Flags are the in-memory demo store (OFF by
// default) until the DB flag reader is wired; a disabled pack is listed as
// locked, never hidden and never runnable.
export async function GET() {
  const guard = await requireAdmin("settings.integrations");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const flags = demoPackFlags.list();
  return NextResponse.json({
    data: {
      packs: ALL_PACKS.map((pack) => ({
        id: pack.id,
        flagKey: pack.flagKey,
        nameEn: pack.nameEn,
        nameBn: pack.nameBn,
        description: pack.description,
        enabled: flags[pack.flagKey],
        defaultConfig: pack.defaultConfig,
      })),
      adapters: demoAdapterRegistry.list(),
      chartOfAccounts: DEFAULT_CHART_OF_ACCOUNTS,
    },
    meta: { persistence: "in-memory-demo", flagsSource: "demo-store-db-pending" },
  });
}

const validateConfigSchema = z.object({
  packId: z.enum(["fashion", "electronics", "grocery", "pharmacy", "digital_goods"]),
  config: z.unknown(),
});

// Validate a pack config against its schema. Validation is allowed while a
// pack is locked (staff prepare config before purchase); ACTIVATION is the
// flag-gated step and happens via feature_flags, not here.
export async function POST(req: Request) {
  const guard = await requireAdmin("settings.integrations");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });
  const body = await req.json().catch(() => ({}));
  const parsed = validateConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid module validation request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const result = validatePackConfig(parsed.data.packId, parsed.data.config);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: "INVALID_PACK_CONFIG", message: "Pack config failed validation.", details: result.errors } },
      { status: 400 },
    );
  }
  return NextResponse.json({
    data: { packId: parsed.data.packId, config: result.config },
    meta: { persistence: "none-pure-validation" },
  });
}
