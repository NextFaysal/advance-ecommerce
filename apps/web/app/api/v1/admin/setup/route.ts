import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import {
  buildSetupSettingsPayload,
  initialSetupState,
  isSetupComplete,
  recordSetupSubmission,
  validateSetupStep,
  type SetupState,
} from "@/platform/setup";

// First-run setup wizard submission — Agent 37. RBAC: settings.edit.
// DEMO PERSISTENCE: the payload (settings-contract shape) is recorded in
// an in-memory store labelled NOT_WIRED and the response carries
// `persisted: false`. Nothing here writes to the settings table — when
// DB wiring lands, these entries go through setSetting() in
// src/lib/settings.ts behind this same contract, with an audit reason.

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
  const submission = recordSetupSubmission(settings);

  return NextResponse.json(
    {
      data: { submissionId: submission.id, settings, persisted: false },
      meta: {
        persistence: "in-memory-demo",
        wiring: "NOT_WIRED",
        note: "Recorded in a demo in-memory store only. Settings were NOT saved to the database; real wiring writes these entries via Admin Settings (encrypted) once the DB lands.",
      },
    },
    { status: 201 },
  );
}
