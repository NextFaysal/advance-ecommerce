/**
 * GET  /api/v1/public/account/addresses — the logged-in customer's
 *      saved addresses (default first). These are rows of the existing
 *      Address model — the same ones checkout creates.
 * POST /api/v1/public/account/addresses — add an address.
 *      Body: { label?, division, district, upazila, union?,
 *              addressLine, isDefault? } — the address shape mirrors
 *      bdAddressSchema from checkout validation. The first address is
 *      always the default; isDefault:true moves the default flag.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@advance-ecommerce/db";
import { listCustomerAddresses } from "@/customer-auth/auth";
import { bdAddressSchema } from "@/checkout/validation";
import { errorResponse, methodNotAllowed, requireCustomer, unauthorized } from "@/customer-auth/http";

const addAddressSchema = bdAddressSchema.extend({
  label: z.string().trim().max(50).optional(),
  isDefault: z.boolean().optional(),
});

export async function GET() {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();
  const addresses = await listCustomerAddresses(customer.id);
  return NextResponse.json({ data: { addresses }, meta: { db: "PRISMA" } });
}

export async function POST(req: Request) {
  const customer = await requireCustomer();
  if (customer === null) return unauthorized();

  const body = await req.json().catch(() => null);
  const parsed = addAddressSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", "ঠিকানার তথ্য সঠিকভাবে দিন।", 400);
  }
  const input = parsed.data;

  await prisma.$transaction(async (tx) => {
    const count = await tx.address.count({ where: { customerId: customer.id } });
    const makeDefault = count === 0 || input.isDefault === true;
    if (makeDefault && count > 0) {
      await tx.address.updateMany({
        where: { customerId: customer.id, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.address.create({
      data: {
        customerId: customer.id,
        label: input.label ?? null,
        division: input.division,
        district: input.district,
        upazila: input.upazila,
        union: input.union ?? null,
        addressLine: input.addressLine,
        isDefault: makeDefault,
      },
    });
  });

  const addresses = await listCustomerAddresses(customer.id);
  return NextResponse.json({ data: { addresses }, meta: { db: "PRISMA" } }, { status: 201 });
}

export function DELETE() {
  return methodNotAllowed();
}
