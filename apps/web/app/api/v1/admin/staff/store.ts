/**
 * Staff data access — DB-backed (Prisma User/Role tables).
 *
 * This module used to be an in-memory demo store seeded with fictional
 * rows (@sample.invalid). It now reads/writes the real User and Role
 * tables. The member shape the staff route returns is unchanged.
 *
 * Schema notes:
 * - User has no status enum. Status is derived: isActive → ACTIVE;
 *   inactive with a live invite token → INVITED; inactive and never
 *   logged in → INVITED (legacy invites from before token tracking);
 *   inactive after a login → SUSPENDED.
 * - Invites (migration 20261024195811_staff_invites): User carries
 *   inviteTokenHash (SHA-256 of the raw token — the raw token is shown
 *   once to the inviter and NEVER stored or logged), inviteExpiresAt
 *   (72h) and invitedById. An invite creates an INACTIVE User row with
 *   an unusable random password hash (User.passwordHash is required);
 *   the invitee cannot log in until they accept the invite, which sets
 *   their own password, activates the row and clears the token fields.
 *   No email is sent by the invite — the inviter shares the link manually.
 */
import { prisma } from "@advance-ecommerce/db";

export type StaffStatus = "ACTIVE" | "INVITED" | "SUSPENDED";

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  status: StaffStatus;
  totpEnabled: boolean;
  lastLoginAt: string | null; // ISO 8601
  invitedBy: string | null;
  invitedAt: string | null; // ISO 8601
  /** True while a token-based invite is outstanding for this member. */
  invitePending: boolean;
  inviteExpiresAt: string | null; // ISO 8601
}

interface StaffUserRow {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  twoFactorEnabled: boolean;
  /** Selected only to judge whether the 2FA flag is usable — never surfaced. */
  twoFactorSecret: string | null;
  lastLoginAt: Date | null;
  isActive: boolean;
  inviteTokenHash: string | null;
  inviteExpiresAt: Date | null;
  createdAt: Date;
  role: { name: string } | null;
  invitedBy: { name: string | null; email: string | null } | null;
}

function deriveStatus(user: {
  isActive: boolean;
  lastLoginAt: Date | null;
  inviteTokenHash: string | null;
}): StaffStatus {
  if (user.isActive) return "ACTIVE";
  if (user.inviteTokenHash !== null) return "INVITED";
  return user.lastLoginAt === null ? "INVITED" : "SUSPENDED";
}

function toStaffMember(user: StaffUserRow): StaffMember {
  const status = deriveStatus(user);
  return {
    id: user.id,
    name: user.name ?? "",
    email: user.email ?? "",
    phone: user.phone ?? "",
    role: user.role?.name ?? "",
    status,
    // Report a USABLE 2FA state, not the bare flag: a legacy row with
    // the flag on but no stored secret cannot verify any code, so
    // showing "2FA চালু" for it would misreport (see hasUsableTotp in
    // src/lib/auth.ts and the TOTP backfill script).
    totpEnabled: user.twoFactorEnabled && user.twoFactorSecret !== null,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    invitedBy: user.invitedBy ? (user.invitedBy.name ?? user.invitedBy.email ?? null) : null,
    invitePending: !user.isActive && user.inviteTokenHash !== null,
    inviteExpiresAt: user.inviteExpiresAt?.toISOString() ?? null,
    invitedAt: status === "INVITED" ? user.createdAt.toISOString() : null,
  };
}

const staffInclude = {
  role: { select: { name: true } },
  invitedBy: { select: { name: true, email: true } },
} as const;

/** All non-deleted staff users, oldest first. */
export async function listStaffMembers(): Promise<StaffMember[]> {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    include: staffInclude,
    orderBy: { createdAt: "asc" },
  });
  return users.map(toStaffMember);
}

/** One staff member by email (case-insensitive), or null. */
export async function findStaffMemberByEmail(email: string): Promise<StaffMember | null> {
  const user = await prisma.user.findFirst({
    where: { email: email.toLowerCase(), deletedAt: null },
    include: staffInclude,
  });
  return user === null ? null : toStaffMember(user);
}

/** One staff member by phone (normalized +8801XXXXXXXXX), or null. */
export async function findStaffMemberByPhone(phone: string): Promise<StaffMember | null> {
  const user = await prisma.user.findFirst({
    where: { phone, deletedAt: null },
    include: staffInclude,
  });
  return user === null ? null : toStaffMember(user);
}

/** One staff member by id, or null. */
export async function findStaffMemberById(id: string): Promise<StaffMember | null> {
  const user = await prisma.user.findFirst({
    where: { id, deletedAt: null },
    include: staffInclude,
  });
  return user === null ? null : toStaffMember(user);
}

/**
 * Create an invited (inactive) staff user. `passwordHash` must be a hash of
 * an unguessable random value — never a real credential — because the
 * invitee sets their own password when accepting the invite.
 * `inviteTokenHash` is the SHA-256 of the raw invite token; the raw token
 * itself is never stored here (or anywhere) — the caller shows it once.
 */
export async function createStaffInvite(input: {
  name: string;
  email?: string | null;
  phone?: string | null;
  roleName: string;
  passwordHash: string;
  inviteTokenHash?: string;
  inviteExpiresAt?: Date;
  invitedById?: string;
}): Promise<StaffMember> {
  const role = await prisma.role.findUnique({ where: { name: input.roleName } });
  if (role === null) throw new Error(`Unknown role: ${input.roleName}`);
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email ? input.email.toLowerCase() : null,
      phone: input.phone ?? null,
      passwordHash: input.passwordHash,
      roleId: role.id,
      isActive: false,
      inviteTokenHash: input.inviteTokenHash ?? null,
      inviteExpiresAt: input.inviteExpiresAt ?? null,
      invitedById: input.invitedById ?? null,
    },
    include: staffInclude,
  });
  return toStaffMember(user);
}

/**
 * Replace the invite token of a still-pending invite (resend). The old
 * token hash is overwritten, so any previously shared link stops working.
 * Returns null when the member is not a pending invite.
 */
export async function regenerateStaffInvite(input: {
  userId: string;
  inviteTokenHash: string;
  inviteExpiresAt: Date;
}): Promise<StaffMember | null> {
  const existing = await prisma.user.findFirst({
    where: { id: input.userId, deletedAt: null, isActive: false, inviteTokenHash: { not: null } },
  });
  if (existing === null) return null;
  const user = await prisma.user.update({
    where: { id: input.userId },
    data: { inviteTokenHash: input.inviteTokenHash, inviteExpiresAt: input.inviteExpiresAt },
    include: staffInclude,
  });
  return toStaffMember(user);
}

/**
 * Revoke a pending invite: the token is cleared and the never-activated
 * row is soft-deleted, so it disappears from staff lists and the email /
 * phone becomes available for a future invite. Returns false when the
 * member is not a pending invite.
 */
export async function revokeStaffInvite(userId: string): Promise<boolean> {
  const existing = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null, isActive: false, inviteTokenHash: { not: null } },
  });
  if (existing === null) return false;
  await prisma.user.update({
    where: { id: userId },
    data: { inviteTokenHash: null, inviteExpiresAt: null, deletedAt: new Date() },
  });
  return true;
}

export interface PendingStaffInvite {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  inviteExpiresAt: Date;
}

/**
 * Look up a live invite by the SHA-256 hash of its raw token. Expired,
 * used, revoked and unknown tokens ALL return null — callers must render
 * one generic failure state, never which case it was.
 */
export async function findPendingInviteByTokenHash(
  tokenHash: string,
): Promise<PendingStaffInvite | null> {
  const user = await prisma.user.findFirst({
    where: { inviteTokenHash: tokenHash, deletedAt: null, isActive: false },
    include: staffInclude,
  });
  if (user === null || user.inviteExpiresAt === null || user.inviteExpiresAt <= new Date()) {
    return null;
  }
  return {
    id: user.id,
    name: user.name ?? "",
    email: user.email,
    phone: user.phone,
    role: user.role?.name ?? "",
    inviteExpiresAt: user.inviteExpiresAt,
  };
}

/**
 * Accept an invite: the invitee sets their own name + password, the
 * account activates, and the token fields are cleared so the link can
 * never be replayed. invitedById is kept as the audit trail of who
 * invited this staff member.
 */
export async function acceptStaffInvite(input: {
  userId: string;
  name: string;
  passwordHash: string;
}): Promise<void> {
  await prisma.user.update({
    where: { id: input.userId },
    data: {
      name: input.name,
      passwordHash: input.passwordHash,
      isActive: true,
      inviteTokenHash: null,
      inviteExpiresAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });
}

export interface RoleCatalogueEntry {
  name: string;
  permissionCount: number;
  permissions: string[];
}

/** Role catalogue from the Role/RolePermission tables (seeded from rbac.ts defaults). */
export async function listRoleCatalogue(): Promise<RoleCatalogueEntry[]> {
  const roles = await prisma.role.findMany({
    include: {
      permissions: { include: { permission: { select: { key: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  return roles.map((role) => {
    const permissions = role.permissions.map((rp) => rp.permission.key).sort();
    return { name: role.name, permissionCount: permissions.length, permissions };
  });
}

/** Names of all roles in the database. */
export async function listRoleNames(): Promise<string[]> {
  const roles = await prisma.role.findMany({ select: { name: true }, orderBy: { createdAt: "asc" } });
  return roles.map((r) => r.name);
}
