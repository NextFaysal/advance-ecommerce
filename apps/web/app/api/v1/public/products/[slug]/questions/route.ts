import { NextResponse } from "next/server";
import { apiError, getCatalogRepository, handleServiceError } from "@/catalog/api";
import { getPublicProductBySlug } from "@/catalog/service";
import { errorResponse, requireCustomer, unauthorized } from "@/customer-auth/http";
import { checkRateLimit } from "@/lib/rate-limit";
import { askQuestionSchema } from "@/qa/schema";
import { askQuestion, listAnsweredQuestions } from "@/qa/store";

// Live data only: never prerender/cache these handlers at build time.
export const dynamic = "force-dynamic";

// GET /api/v1/public/products/[slug]/questions — ANSWERED questions
// only (the store enforces the visibility contract: PENDING and
// HIDDEN never leave the server on a public read).
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  try {
    const repo = await getCatalogRepository();
    const product = await getPublicProductBySlug(repo, params.slug);
    if (!product) return apiError("NOT_FOUND", "Product not found.", 404);
    const questions = await listAnsweredQuestions(product.id);
    return NextResponse.json({
      data: { productId: product.id, questions },
      meta: { persistence: "database" },
    });
  } catch (error) {
    return handleServiceError(error);
  }
}

// POST /api/v1/public/products/[slug]/questions — ask a question.
// Signed-in customers ONLY (401 otherwise): Q&A is tied to a real
// account so moderation has an accountable author. The question is
// born PENDING and becomes public only when staff answer it.
export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();

  const parsed = askQuestionSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", "প্রশ্নটি সঠিকভাবে লিখুন।", 400, parsed.error.issues);
  }

  const limit = await checkRateLimit(`qa-ask:${customer.id}`, 10, 3_600_000);
  if (!limit.allowed) {
    return errorResponse(
      "RATE_LIMITED",
      "অনেকবার চেষ্টা করা হয়েছে — কিছুক্ষণ পর আবার চেষ্টা করুন।",
      429,
    );
  }

  try {
    const repo = await getCatalogRepository();
    const product = await getPublicProductBySlug(repo, params.slug);
    if (!product) return apiError("NOT_FOUND", "Product not found.", 404);
    const question = await askQuestion(product.id, customer, parsed.data.question);
    return NextResponse.json(
      { data: { question }, meta: { persistence: "database" } },
      { status: 201 },
    );
  } catch (error) {
    return handleServiceError(error);
  }
}
