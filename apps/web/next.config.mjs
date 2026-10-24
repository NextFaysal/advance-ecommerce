/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@advance-ecommerce/db", "@advance-ecommerce/validators"],
  // instrumentation.ts (server-start DB wiring for feature flags +
  // coupon snapshot) needs the hook enabled on Next 14.
  experimental: { instrumentationHook: true },
};
export default nextConfig;
