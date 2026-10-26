/**
 * GET /api/v1/public/account/me — the logged-in customer's public
 * profile (id, name, phone + masked phone, email, member-since) plus
 * their date of birth (schema wave 2) for the birthday-offer feature.
 * 401 when there is no valid customer_session.
 *
 * PATCH — set or clear the date of birth. Body:
 * { "birthDate": "YYYY-MM-DD" } or { "birthDate": null }. Stored as
 * UTC midnight (date-only semantics, the B2bCustomer.oldestDueDate
 * precedent); read back as the YYYY-MM-DD string. The field is
 * optional — a customer who never sets it simply never enters the
 * birthday window.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { methodNotAllowed, requireCustomer, unauthorized } from "@/customer-auth/http";

function birthDateString(value: Date | null): string | null {
  if (value === null) return null;
  return value.toISOString().slice(0, 10);
}

export async function GET() {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();
  const row = await prisma.customer.findUnique({
    where: { id: customer.id },
    select: { birthDate: true },
  });
  return NextResponse.json({
    data: { customer, birthDate: birthDateString(row?.birthDate ?? null) },
    meta: { db: "PRISMA" },
  });
}

const birthDatePatchSchema = z.object({
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "তারিখ YYYY-MM-DD আকারে দিন")
    .nullable(),
});

export async function PATCH(req: Request) {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();
  const parsed = birthDatePatchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "সঠিক জন্মতারিখ দিন (YYYY-MM-DD), অথবা মুছতে null পাঠান।", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  let stored: Date | null = null;
  if (parsed.data.birthDate !== null) {
    const [y, m, d] = parsed.data.birthDate.split("-").map(Number) as [number, number, number];
    const candidate = new Date(Date.UTC(y, m - 1, d));
    // Reject rollovers (e.g. Feb 30) and absurd values: the stored
    // date must round-trip to the same Y/M/D, not be in the future,
    // and not predate 1900.
    if (
      candidate.getUTCFullYear() !== y ||
      candidate.getUTCMonth() !== m - 1 ||
      candidate.getUTCDate() !== d ||
      candidate.getTime() > Date.now() ||
      y < 1900
    ) {
      return NextResponse.json(
        { error: { code: "INVALID_INPUT", message: "জন্মতারিখটি সঠিক নয়।" } },
        { status: 400 },
      );
    }
    stored = candidate;
  }
  const updated = await prisma.customer.update({
    where: { id: customer.id },
    data: { birthDate: stored },
    select: { birthDate: true },
  });
  return NextResponse.json({
    data: { birthDate: birthDateString(updated.birthDate) },
    meta: { db: "PRISMA" },
  });
}

export function POST() {
  return methodNotAllowed();
}
