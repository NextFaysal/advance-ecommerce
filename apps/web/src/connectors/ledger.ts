/**
 * Connector attempt ledger (ADV-25 part 2) — a capped JSON doc in the
 * Setting table under the key `connectors.attempts`, the established
 * Setting-doc pattern (warehouse.pick_lists / marketing docs): the
 * generic settings API rejects unknown keys and this document is
 * machine-shaped, so it gets its own zod-validated doc store over
 * prisma.setting, written directly.
 *
 * The ledger is evidence, not decoration: it records what was
 * actually attempted and what the provider answered (codes only).
 * Recording must never break a send path, so every function here
 * swallows its own errors — a lost ledger row is acceptable, a
 * broken order funnel is not.
 */
import { z } from "zod";
import {
  CONNECTOR_CHANNELS,
  CONNECTOR_EVENTS,
  type AttemptRecord,
} from "./types";

export const ATTEMPTS_DOC_KEY = "connectors.attempts";
/** Cap: the doc keeps the newest 50 attempts; older ones fall off. */
export const ATTEMPTS_CAP = 50;

const attemptSchema = z.object({
  at: z.string().min(1),
  channel: z.enum(CONNECTOR_CHANNELS),
  event: z.enum([...CONNECTOR_EVENTS, "test"]),
  status: z.enum(["sent", "failed", "not_configured"]),
  errorCode: z.string().max(80).optional(),
  detail: z.string().max(300).optional(),
});

const attemptsDocSchema = z.object({
  version: z.literal(1),
  attempts: z.array(attemptSchema).max(ATTEMPTS_CAP),
});

export interface ConnectorDocStore {
  read(key: string): Promise<string | null>;
  write(key: string, value: string, actorId: string): Promise<void>;
}

/** Production store — prisma imported lazily (the saved-reports /
 *  marketing-docs pattern) so pure-logic consumers never drag the
 *  DB client in. */
export function prismaConnectorDocStore(): ConnectorDocStore {
  return {
    async read(key) {
      const { prisma } = await import("@advance-ecommerce/db");
      const row = await prisma.setting.findUnique({ where: { key } });
      return row?.value ?? null;
    },
    async write(key, value, actorId) {
      const { prisma } = await import("@advance-ecommerce/db");
      await prisma.setting.upsert({
        where: { key },
        create: {
          key,
          value,
          valueEncrypted: false,
          isPublic: false,
          category: "general",
          description: "Outbound connector attempt ledger (JSON, ADV-25)",
          updatedById: actorId,
        },
        update: { value, valueEncrypted: false, updatedById: actorId },
      });
    },
  };
}

async function readAttempts(store: ConnectorDocStore): Promise<AttemptRecord[]> {
  const raw = await store.read(ATTEMPTS_DOC_KEY);
  if (raw === null || raw.trim() === "") return [];
  try {
    const parsed = attemptsDocSchema.safeParse(JSON.parse(raw));
    return parsed.success ? (parsed.data.attempts as AttemptRecord[]) : [];
  } catch {
    return [];
  }
}

/** Newest first. Never throws — a broken ledger reads as empty. */
export async function listConnectorAttempts(
  limit = 20,
  store: ConnectorDocStore = prismaConnectorDocStore(),
): Promise<AttemptRecord[]> {
  try {
    const attempts = await readAttempts(store);
    return attempts.slice(0, Math.max(0, limit));
  } catch {
    return [];
  }
}

/**
 * Prepend one attempt and re-cap the doc. Read-modify-write, the
 * same trade-off the other Setting-doc stores make (low write rate:
 * lifecycle events + admin tests). NEVER throws.
 */
export async function recordConnectorAttempt(
  attempt: AttemptRecord,
  store: ConnectorDocStore = prismaConnectorDocStore(),
): Promise<void> {
  try {
    const parsed = attemptSchema.safeParse(attempt);
    if (!parsed.success) return;
    const existing = await readAttempts(store);
    const next = [parsed.data, ...existing].slice(0, ATTEMPTS_CAP);
    await store.write(
      ATTEMPTS_DOC_KEY,
      JSON.stringify({ version: 1, attempts: next }),
      "system:connectors",
    );
  } catch {
    // Ledger loss is logged nowhere on purpose: this runs inside
    // fire-and-forget fan-out, and a console line per failed write
    // would spam exactly when the DB is already in trouble.
  }
}
