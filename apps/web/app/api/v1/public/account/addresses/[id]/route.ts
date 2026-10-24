/**
 * DELETE /api/v1/public/account/addresses/[id] — delete one of the
 * logged-in customer's own addresses. An id belonging to another
 * customer returns the same 404 as a non-existent id (no enumeration).
 * If the deleted address was the default, the oldest remaining address
 * becomes the default.
 */
import { NextResponse } from "next/server";
import { prisma } from "@advance-ecommerce/db";
import { listCustomerAddresses } from "@/customer-auth/auth";
import { errorResponse, methodNotAllowed, requireCustomer, unauthorized } from "@/customer-auth/http";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();
  const { id } = await params;

  const existing = await prisma.address.findFirst({
    where: { id, customerId: customer.id },
  });
  if (existing === null) {
    return errorResponse("NOT_FOUND", "ঠিকানাটি পাওয়া যায়নি।", 404);
  }

  await prisma.$transaction(async (tx) => {
    await tx.address.delete({ where: { id: existing.id } });
    if (existing.isDefault) {
      const next = await tx.address.findFirst({
        where: { customerId: customer.id },
        orderBy: { createdAt: "asc" },
      });
      if (next !== null) {
        await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    }
  });

  const addresses = await listCustomerAddresses(customer.id);
  return NextResponse.json({ data: { addresses }, meta: { db: "PRISMA" } });
}

export function GET() {
  return methodNotAllowed();
}
