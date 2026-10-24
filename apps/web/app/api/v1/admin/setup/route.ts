import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { setSetting } from "@/lib/settings";
import {
  buildSetupSettingsPayload,
  initialSetupState,
  isSetupComplete,
  validateSetupStep,
  type SetupState,
} from "@/platform/setup";

// First-run setup wizard submission — Agent 37. RBAC: settings.edit.
// DB-BACKED: the payload (settings-contract shape) is written through
// setSetting() in src/lib/settings.ts — each entry lands in the
// Setting table (secrets AES-256-GCM encrypted; the wizard collects no
// secrets, only enablement + store basics) with the settings.update
// audit entry setSetting writes, and the response carries
// `persisted: true`. If any write fails, the route answers 503 and
// does NOT claim persistence.

const providerFlags = (providers: readonly string[]) =>
  z.record(z.string(), z.boolean()).refine(
    (rec) => providers.every((p) => typeof rec[p] === "boolean"),
    { message: "Every provider needs an explicit enabled flag." },
  );

const setupSchema = z.object({
  storeName: z.string().trim().min(1),
  storePhone: z.string().trim().min(1),
  storeAddress: z.string().trim().min(1),
  paymentMethods: providerFlags([
    "cod", "bkash", "nagad", "rocket", "upay", "sslcommerz", "aamarpay", "shurjopay", "stripe", "paypal",
  ]),
  courierProviders: providerFlags(["steadfast", "pathao", "redx", "paperfly", "ecourier"]),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("settings.edit");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const body = await req.json().catch(() => null);
  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid setup payload.", details: parsed.error.issues } },
      { status: 400 },
    );
  }

  const state: SetupState = {
    ...initialSetupState(),
    storeName: parsed.data.storeName,
    storePhone: parsed.data.storePhone,
    storeAddress: parsed.data.storeAddress,
    paymentMethods: parsed.data.paymentMethods as SetupState["paymentMethods"],
    courierProviders: parsed.data.courierProviders as SetupState["courierProviders"],
  };

  // Re-run the wizard's own pure validators server-side — never trust the client.
  const stepErrors = (["store", "payments", "couriers"] as const).flatMap((step) =>
    validateSetupStep(state, step).map((message) => ({ step, message })),
  );
  if (stepErrors.length > 0 || !isSetupComplete(state)) {
    return NextResponse.json(
      { error: { code: "SETUP_INCOMPLETE", message: "Setup validation failed.", details: stepErrors } },
      { status: 422 },
    );
  }

  const settings = buildSetupSettingsPayload(state);
  const submissionId = `setup_${Date.now()}`;
  try {
    for (const entry of settings) {
      await setSetting({
        key: entry.key,
        value: entry.value,
        actorId: guard.userId,
        reason: `First-run setup wizard (${submissionId})`,
      });
    }
  } catch (e) {
    // Never claim the setup was saved when a write failed.
    return NextResponse.json(
      { error: { code: "SETTINGS_SAVE_FAILED", message: e instanceof Error ? e.message : "Setup settings could not be saved." } },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      data: { submissionId, settings, persisted: true },
      meta: {
        persistence: "database",
        note: "Setup settings saved to the database via Admin Settings (setSetting, audited).",
      },
    },
    { status: 201 },
  );
}
