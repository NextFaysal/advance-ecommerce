import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(appDir, "../..");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@advance-ecommerce/db", "@advance-ecommerce/validators"],
  // instrumentation.ts (server-start DB wiring for feature flags +
  // coupon snapshot) needs the hook enabled on Next 14.
  experimental: { instrumentationHook: true },
  // Prisma on Vercel (pnpm monorepo): pin the file-tracing root to the
  // repo root so the include patterns below resolve from there, and
  // force-include the generated Prisma client directory (which contains
  // the query-engine .so.node) in EVERY route's function bundle. Without
  // this, nft tracing included the engine for some routes only and
  // others failed at runtime with "Prisma Client could not locate the
  // Query Engine for runtime rhel-openssl-3.0.x".
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    "/*": [
      "node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client/**",
      "node_modules/.prisma/client/**",
    ],
  },
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
};
export default nextConfig;
