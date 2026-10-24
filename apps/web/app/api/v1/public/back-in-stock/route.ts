import { NextResponse } from "next/server";
import { backInStockSignupSchema } from "@/storefront-ux/back-in-stock";
import { dbBackInStockStore } from "@/storefront-ux/back-in-stock-db";

// POST /api/v1/public/back-in-stock — back-in-stock notify signup.
// Public (no account needed): a BD phone is stored normalized in the
// BackInStockSignup table; the response only ever carries the MASKED
// phone. A duplicate signup for the same product+variant+phone is a
// no-op success (the unique key also bounds abuse: one phone can hold
// at most one signup per product+variant). No SMS is sent here — the
// notify job sends one message when stock is restored.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = backInStockSignupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "সঠিক তথ্য দিন।" } },
      { status: 400 },
    );
  }
  try {
    const result = await dbBackInStockStore.add(parsed.data);
    if (!result.ok) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: result.error } },
        { status: 400 },
      );
    }
    return NextResponse.json(
      {
        data: { signup: result.signup, duplicate: result.duplicate },
        meta: { persistence: "database", sms: "not-sent" },
      },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "সার্ভারে সমস্যা হয়েছে — আবার চেষ্টা করুন।" } },
      { status: 503 },
    );
  }
}
