import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

// On Vercel + Neon, the platform injects POSTGRES_PRISMA_URL — the pooled
// connection string WITH ?pgbouncer=true, which Prisma needs to disable
// prepared statements against Neon's transaction-mode pooler. The plain
// pooled DATABASE_URL makes multi-statement queries fail with
// "prepared statement does not exist". Prefer the Prisma-tuned URL when
// present; local/dev keeps using DATABASE_URL.
const datasourceUrl = process.env["POSTGRES_PRISMA_URL"] ?? process.env["DATABASE_URL"];

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(
    datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : undefined,
  );

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
