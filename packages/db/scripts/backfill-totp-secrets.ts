/**
 * Backfill legacy staff TOTP state — idempotent, safe to re-run.
 *
 * Why this exists (see apps/web/src/lib/SECURITY-NOTES.md §2): TOTP
 * secrets enrolled before envelope encryption landed are stored as raw
 * base32 plaintext in User.twoFactorSecret. The verify path still
 * accepts them (resolveTotpSecret in apps/web/src/lib/auth.ts), so
 * nobody is locked out by them — but they sit in the DB exactly as
 * exposed as the day they were written. This script re-encrypts them
 * in place. It also repairs two inconsistent legacy states that DO
 * lock a user out permanently:
 *
 *   - twoFactorEnabled = true with twoFactorSecret = null: the login
 *     flow demands a TOTP code that can never verify (there is no
 *     secret), so the account can never sign in. Repair: clear the
 *     flag — the user signs in with their password and re-enrols.
 *   - a stored secret that is neither a valid envelope nor plausible
 *     base32 (corrupt / hand-edited / undecryptable after an
 *     AUTH_ENCRYPTION_KEY rotation): same permanent lockout. Repair:
 *     clear secret + flag; the user re-enrols.
 *
 * Categories (counts printed at the end; re-running reports zeroes
 * for every action category):
 *   reEncrypted               plaintext base32 -> v1: envelope
 *   alreadyEncrypted          envelope decrypts fine — untouched
 *   corruptReset              secret not plausible base32 -> cleared
 *   undecryptableReset        envelope fails to decrypt -> cleared
 *   enabledWithoutSecretReset flag on, secret null -> flag cleared
 *
 * Usage (local / server shell only — needs DATABASE_URL and, whenever
 * any secret row exists, AUTH_ENCRYPTION_KEY from server env):
 *   pnpm --filter @advance-ecommerce/db exec tsx scripts/backfill-totp-secrets.ts
 *   pnpm --filter @advance-ecommerce/db exec tsx scripts/backfill-totp-secrets.ts --dry-run
 *
 * The AES-256-GCM envelope helpers below DUPLICATE
 * apps/web/src/lib/auth.ts (encryptTotpSecret / decryptTotpSecret) on
 * purpose — packages/db must not depend on apps/web (same precedent as
 * hashPassword in create-first-owner.ts). If the envelope format
 * changes, update both places together.
 *
 * Nothing secret is ever printed: no plaintext secrets, no envelopes,
 * no key material — only counts and the ids/emails of accounts whose
 * 2FA was reset (so the owner knows who must re-enrol).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const ENVELOPE_PREFIX = "v1:";

/* ------------------------------------------------------------------ */
/* Envelope crypto — duplicated from apps/web/src/lib/auth.ts.         */
/* ------------------------------------------------------------------ */

function authEncryptionKey(): Buffer {
  const raw = process.env["AUTH_ENCRYPTION_KEY"];
  if (raw === undefined || raw === "") {
    throw new Error(
      "AUTH_ENCRYPTION_KEY is not set — refusing to touch TOTP secrets. Set it in server env (64 hex chars).",
    );
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) throw new Error("AUTH_ENCRYPTION_KEY must be 32 bytes (64 hex chars).");
  return key;
}

function encryptTotpSecret(secretBase32: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(secretBase32, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

/** Throws on a malformed envelope, a bad tag, or a wrong key. */
function decryptTotpSecret(stored: string, key: Buffer): string {
  const parts = stored.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Unsupported envelope format.");
  const [, ivHex, tagHex, cipherHex] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex as string, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex as string, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherHex as string, "hex")),
    decipher.final(),
  ]).toString("utf8");
}

/**
 * A plausible legacy secret is base32 (A-Z2-7, padding/space tolerated)
 * decoding to at least 10 bytes — generateTotpSecret() makes 20 bytes /
 * 32 chars; common authenticator secrets are 16+ chars. Anything else
 * in a non-envelope value cannot ever produce a valid code.
 */
function plausibleBase32Secret(raw: string): string | null {
  const clean = raw.replace(/[\s=]+/g, "").toUpperCase();
  if (!/^[A-Z2-7]{16,}$/.test(clean)) return null;
  if (Math.floor((clean.length * 5) / 8) < 10) return null;
  return clean;
}

/* ------------------------------------------------------------------ */
/* Backfill                                                            */
/* ------------------------------------------------------------------ */

interface Counts {
  scanned: number;
  reEncrypted: number;
  alreadyEncrypted: number;
  corruptReset: number;
  undecryptableReset: number;
  enabledWithoutSecretReset: number;
}

async function main(): Promise<void> {
  const dryRun =
    process.argv.includes("--dry-run") || process.env["BACKFILL_TOTP_DRY_RUN"] === "1";
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        OR: [{ twoFactorSecret: { not: null } }, { twoFactorEnabled: true }],
      },
      select: {
        id: true,
        email: true,
        phone: true,
        twoFactorEnabled: true,
        twoFactorSecret: true,
      },
      orderBy: { createdAt: "asc" },
    });

    // The key is needed iff any secret row exists (to re-encrypt or to
    // test-decrypt). Validate it BEFORE any write so a missing key can
    // never leave a half-migrated table.
    const hasSecretRows = users.some((u) => u.twoFactorSecret !== null);
    const key = hasSecretRows ? authEncryptionKey() : null;

    const counts: Counts = {
      scanned: users.length,
      reEncrypted: 0,
      alreadyEncrypted: 0,
      corruptReset: 0,
      undecryptableReset: 0,
      enabledWithoutSecretReset: 0,
    };
    const resetAccounts: string[] = [];

    for (const user of users) {
      const label = `${user.id} (${user.email ?? user.phone ?? "no identifier"})`;
      const secret = user.twoFactorSecret;

      if (secret === null) {
        // Enabled with no secret = permanent 2FA-step lockout.
        if (user.twoFactorEnabled) {
          counts.enabledWithoutSecretReset += 1;
          resetAccounts.push(label);
          if (!dryRun) {
            await prisma.user.update({
              where: { id: user.id },
              data: { twoFactorEnabled: false },
            });
          }
        }
        continue;
      }

      if (!secret.startsWith(ENVELOPE_PREFIX)) {
        const plausible = plausibleBase32Secret(secret);
        if (plausible !== null) {
          counts.reEncrypted += 1;
          if (!dryRun) {
            await prisma.user.update({
              where: { id: user.id },
              data: { twoFactorSecret: encryptTotpSecret(plausible, key as Buffer) },
            });
          }
        } else {
          counts.corruptReset += 1;
          resetAccounts.push(label);
          if (!dryRun) {
            await prisma.user.update({
              where: { id: user.id },
              data: { twoFactorSecret: null, twoFactorEnabled: false },
            });
          }
        }
        continue;
      }

      // Envelope: fine only if it decrypts under the CURRENT key.
      try {
        decryptTotpSecret(secret, key as Buffer);
        counts.alreadyEncrypted += 1;
      } catch {
        counts.undecryptableReset += 1;
        resetAccounts.push(label);
        if (!dryRun) {
          await prisma.user.update({
            where: { id: user.id },
            data: { twoFactorSecret: null, twoFactorEnabled: false },
          });
        }
      }
    }

    console.log(`TOTP backfill ${dryRun ? "(DRY RUN — no writes)" : "(applied)"}`);
    console.log(`  rows scanned:                ${counts.scanned}`);
    console.log(`  re-encrypted (plaintext):    ${counts.reEncrypted}`);
    console.log(`  already encrypted:           ${counts.alreadyEncrypted}`);
    console.log(`  corrupt secret reset:        ${counts.corruptReset}`);
    console.log(`  undecryptable reset:         ${counts.undecryptableReset}`);
    console.log(`  enabled-without-secret reset: ${counts.enabledWithoutSecretReset}`);
    if (resetAccounts.length > 0) {
      console.log("  2FA was reset for these accounts — they must re-enrol:");
      for (const label of resetAccounts) console.log(`    - ${label}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "TOTP backfill failed.");
  process.exit(1);
});
