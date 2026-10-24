/**
 * Staff data access — DB-backed (Prisma User/Role tables).
 *
 * This module used to be an in-memory demo store seeded with fictional
 * rows (@sample.invalid). It now reads/writes the real User and Role
 * tables. The member shape the staff route returns is unchanged.
 *
 * Schema notes (drift, deliberately NOT papered over):
 * - User has no status enum and no invitedBy/invitedAt columns. Status is
 *   derived: isActive → ACTIVE; inactive and never logged in → INVITED;
 *   inactive after a login → SUSPENDED. invitedBy is always null (not
 *   tracked); invitedAt is the row's createdAt for INVITED members only.
 * - An invite creates an INACTIVE User row with an unusable random
 *   password hash (User.passwordHash is required). The invitee cannot log
 *   in until an admin activates the account and a real password is set
 *   through the password-reset flow. No email is sent by the invite.
 */
import { prisma } from "@advance-ecommerce/db";

export type StaffStatus = "ACTIVE" | "INVITED" | "SUSPENDED";

export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: string;
  status: StaffStatus;
  totpEnabled: boolean;
  lastLoginAt: string | null; // ISO 8601
  invitedBy: string | null;
  invitedAt: string | null; // ISO 8601
}

interface StaffUserRow {
  id: string;
  name: string | null;
  email: string | null;
  twoFactorEnabled: boolean;
  lastLoginAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  role: { name: string } | null;
}

function deriveStatus(user: { isActive: boolean; lastLoginAt: Date | null }): StaffStatus {
  if (user.isActive) return "ACTIVE";
  return user.lastLoginAt === null ? "INVITED" : "SUSPENDED";
}

function toStaffMember(user: StaffUserRow): StaffMember {
  const status = deriveStatus(user);
  return {
    id: user.id,
    name: user.name ?? "",
    email: user.email ?? "",
    role: user.role?.name ?? "",
    status,
    totpEnabled: user.twoFactorEnabled,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    invitedBy: null,
    invitedAt: status === "INVITED" ? user.createdAt.toISOString() : null,
  };
}

const staffInclude = { role: { select: { name: true } } } as const;

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

/**
 * Create an invited (inactive) staff user. `passwordHash` must be a hash of
 * an unguessable random value — never a real credential — because the
 * invitee sets their own password later via the reset flow.
 */
export async function createStaffInvite(input: {
  name: string;
  email: string;
  roleName: string;
  passwordHash: string;
}): Promise<StaffMember> {
  const role = await prisma.role.findUnique({ where: { name: input.roleName } });
  if (role === null) throw new Error(`Unknown role: ${input.roleName}`);
  const user = await prisma.user.create({
    data: {
      name: input.name,
      email: input.email.toLowerCase(),
      passwordHash: input.passwordHash,
      roleId: role.id,
      isActive: false,
    },
    include: staffInclude,
  });
  return toStaffMember(user);
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
