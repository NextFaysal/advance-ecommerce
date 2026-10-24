/**
 * Create the first Owner staff user — run ONCE locally, never in seed.
 *
 * Usage (local only, password from env, never commit it, never pass it in chat):
 *   FIRST_OWNER_EMAIL=owner@example.com FIRST_OWNER_PHONE=+8801XXXXXXXXX \
 *   FIRST_OWNER_PASSWORD='...' FIRST_OWNER_NAME='Owner' \
 *   pnpm --filter @advance-ecommerce/db exec tsx scripts/create-first-owner.ts
 *
 * The password is hashed with the same scrypt format as src/lib/auth.ts
 * (hashPassword in apps/web) — this script duplicates that format on purpose
 * so packages/db does not depend on apps/web. If the auth hashing changes,
 * update both places together.
 * Requires a generated Prisma client and a reachable DATABASE_URL in
 * .env.local (local only). It refuses to run if an Owner already exists.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

async function main(): Promise<void> {
  const email = process.env["FIRST_OWNER_EMAIL"];
  const phone = process.env["FIRST_OWNER_PHONE"];
  const password = process.env["FIRST_OWNER_PASSWORD"];
  const name = process.env["FIRST_OWNER_NAME"] ?? "Owner";
  if (!password || password.length < 12 || (!email && !phone)) {
    throw new Error("Set FIRST_OWNER_PASSWORD (12+ chars) and FIRST_OWNER_EMAIL or FIRST_OWNER_PHONE in local env.");
  }
  const prisma = new PrismaClient();
  try {
    const ownerRole = await prisma.role.findUnique({ where: { name: "Owner" } });
    if (!ownerRole) throw new Error("Owner role not found — run the seed first.");
    const existingOwner = await prisma.user.findFirst({ where: { roleId: ownerRole.id, deletedAt: null } });
    if (existingOwner) throw new Error("An Owner already exists — refusing to create another from this script.");
    const user = await prisma.user.create({
      data: {
        email: email?.toLowerCase() ?? null,
        phone: phone ?? null,
        name,
        passwordHash: hashPassword(password),
        roleId: ownerRole.id,
        isActive: true,
      },
      select: { id: true, email: true, phone: true },
    });
    // Never print the password or its hash.
    console.log(`First Owner created: id=${user.id} email=${user.email ?? "-"} phone=${user.phone ?? "-"}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "Failed to create first Owner.");
  process.exit(1);
});
