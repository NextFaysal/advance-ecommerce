import { createSessionToken, hashSessionToken } from "@/lib/auth";

/**
 * Staff invite tokens.
 *
 * A token is 32 random bytes (hex, via the same generator as staff
 * session tokens). Only its SHA-256 hash is stored on the User row
 * (User.inviteTokenHash); the raw token exists only in the invite link
 * returned ONCE to the inviter — and, since ADV-3, on the queued
 * invite-email job that carries the same link to the invitee's inbox
 * (src/email/send.ts). It is never stored anywhere else and can never
 * be reconstructed. Tokens live 72 hours; resending an invite
 * replaces the hash, which invalidates every previously shared link.
 */
export const STAFF_INVITE_TTL_MS = 72 * 60 * 60 * 1000;

export function createStaffInviteToken(): {
  token: string;
  tokenHash: string;
  expiresAt: Date;
} {
  const token = createSessionToken();
  return {
    token,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + STAFF_INVITE_TTL_MS),
  };
}

/** Hash a raw token from an accept link for lookup (never log the raw). */
export function hashStaffInviteToken(token: string): string {
  return hashSessionToken(token);
}

export function staffInviteLink(origin: string, token: string): string {
  const url = new URL("/admin/accept-invite", origin);
  url.searchParams.set("token", token);
  return url.toString();
}
