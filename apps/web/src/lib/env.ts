import { z } from "zod";

// Typed env loader — missing env hole app start e clear error dibe, pore silent fail hobe na.
// Secret value kokhono log kora hobe na, sudhu key name error e asbe.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_NAME: z.string().default("Advance Ecommerce"),
  ADMIN_PATH: z.string().default("/admin"),
  TZ: z.string().default("Asia/Dhaka"),
  DEFAULT_LOCALE: z.string().default("bn"),
  DEFAULT_CURRENCY: z.string().default("BDT"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL missing — set it in .env.local"),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  NEXTAUTH_URL: z.string().url().default("http://localhost:3000"),
  NEXTAUTH_SECRET: z.string().min(32, "NEXTAUTH_SECRET must be 32+ chars").optional(),
  MEILISEARCH_HOST: z.string().default("http://localhost:7700"),
  MEILISEARCH_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(raw: Record<string, string | undefined>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const keys = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid env: ${keys}`);
  }
  return parsed.data;
}
