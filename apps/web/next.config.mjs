/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@advance-ecommerce/db", "@advance-ecommerce/validators"],
  // instrumentation.ts (server-start DB wiring for feature flags +
  // coupon snapshot) needs the hook enabled on Next 14.
  experimental: { instrumentationHook: true },
  // Prisma on Vercel (monorepo + pnpm): the query-engine binary lives in
  // the workspace-root pnpm store next to the generated client, and
  // Next's file tracing does not reliably copy it into every serverless
  // function (symptom: "could not locate the Query Engine for runtime
  // rhel-openssl-3.0.x" on SOME routes only). Externalize the client so
  // it is required from real node_modules at runtime, and force-include
  // the generated-client directory (which holds the engine) for all
  // routes.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
  outputFileTracingIncludes: {
    "/*": [
      "../../node_modules/.pnpm/@prisma+client@5.22.0_prisma@5.22.0/node_modules/.prisma/client/**",
      "../../node_modules/.prisma/client/**",
      "./node_modules/.prisma/client/**",
    ],
  },
};
export default nextConfig;
