/**
 * Reset (or create) the Owner staff user's login — recovery path for a
 * lost first-owner password. Run ONLY inside the gated Vercel bootstrap
 * (RESET_OWNER=1) or locally by the operator.
 *
 * Reads FIRST_OWNER_EMAIL + FIRST_OWNER_PASSWORD from env (the NEW
 * values). If an Owner exists, its email + password hash are replaced
 * and any login lockout is cleared; if none exists, one is created
 * (same behaviour as create-first-owner.ts). Password hashing uses the
 * exact scrypt format of src/lib/auth.ts (duplicated on purpose, same
 * as create-first-owner.ts). Never prints the email, password, or hash.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

async function main(): Promise<void> {
  const email = process.env["FIRST_OWNER_EMAIL"]?.toLowerCase();
  const password = process.env["FIRST_OWNER_PASSWORD"];
  if (!email || !password || password.length < 12) {
    throw new Error("Set FIRST_OWNER_EMAIL and FIRST_OWNER_PASSWORD (12+ chars) in env.");
  }
  const prisma = new PrismaClient();
  try {
    const ownerRole = await prisma.role.findUnique({ where: { name: "Owner" } });
    if (!ownerRole) throw new Error("Owner role not found — run the seed first.");
    const existing = await prisma.user.findFirst({
      where: { roleId: ownerRole.id, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          email,
          passwordHash: hashPassword(password),
          isActive: true,
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      console.log(`Owner login reset: id=${existing.id} (email+password replaced, lockout cleared)`);
    } else {
      const user = await prisma.user.create({
        data: {
          email,
          name: "Owner",
          passwordHash: hashPassword(password),
          roleId: ownerRole.id,
          isActive: true,
        },
        select: { id: true },
      });
      console.log(`Owner created (none existed): id=${user.id}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "Failed to reset Owner.");
  process.exit(1);
});
