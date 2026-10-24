import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { hashPassword } from "@/lib/auth";
import {
  createStaffInvite,
  findStaffMemberByEmail,
  listRoleCatalogue,
  listRoleNames,
  listStaffMembers,
} from "./store";
import { recordDemoAudit } from "../audit-log/store";

// Staff API — Agent 39, DB-backed since the Prisma persistence swap.
// GET: staff.view. POST (invite): staff.manage.
// Persistence: the User/Role tables via Prisma (see ./store.ts for the
// status derivation — the schema has no status/invite columns). NO email
// is ever sent by the invite — the response reports the invite as queued
// with delivered: false until the email provider wiring lands. The invite
// creates an INACTIVE user with an unusable random password hash; the
// invitee cannot log in until activated with a real password.
// An Owner can NEVER be created through this API: the first Owner is
// created only by packages/db/scripts/create-first-owner.ts (run once,
// local env), and any invite with role "Owner" is rejected with 422.

const listQuerySchema = z.object({
  status: z.enum(["ACTIVE", "INVITED", "SUSPENDED"]).optional(),
  role: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(req: Request) {
  const guard = await requireAdmin("staff.view");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const url = new URL(req.url);
  const parsed = listQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid staff query.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const { status, role, q, page, pageSize } = parsed.data;
  const needle = q?.toLowerCase();
  const [members, roles] = await Promise.all([listStaffMembers(), listRoleCatalogue()]);
  const filtered = members.filter((m) => {
    if (status && m.status !== status) return false;
    if (role && m.role !== role) return false;
    if (needle && !`${m.name} ${m.email}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);

  return NextResponse.json({
    data: { staff: rows, total: filtered.length, roles },
    meta: {
      page,
      pageSize,
      persistence: "database",
      source: "User/Role tables via Prisma",
      note: "Status is derived (schema has no status column): active → ACTIVE, inactive + never logged in → INVITED, inactive after a login → SUSPENDED. invitedBy is not tracked in the schema and is always null.",
    },
  });
}

const inviteSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  role: z.string().trim().min(1),
  reason: z.string().trim().min(1).optional(),
});

export async function POST(req: Request) {
  const guard = await requireAdmin("staff.manage");
  if (!guard.ok) return NextResponse.json(guardError(guard), { status: guard.status });

  const body = await req.json().catch(() => null);
  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Invalid invite payload.", details: parsed.error.issues } },
      { status: 400 },
    );
  }
  const { name, email, role, reason } = parsed.data;

  if (role === "Owner") {
    return NextResponse.json(
      {
        error: {
          code: "OWNER_VIA_API_FORBIDDEN",
          message:
            "An Owner cannot be created via the API. The first Owner is created only by packages/db/scripts/create-first-owner.ts.",
        },
      },
      { status: 422 },
    );
  }
  const roleNames = await listRoleNames();
  if (!roleNames.includes(role)) {
    return NextResponse.json(
      { error: { code: "INVALID_ROLE", message: `Unknown role: ${role}`, details: { roles: roleNames } } },
      { status: 422 },
    );
  }
  const emailLower = email.toLowerCase();
  if ((await findStaffMemberByEmail(emailLower)) !== null) {
    return NextResponse.json(
      { error: { code: "DUPLICATE_EMAIL", message: "A staff record with this email already exists." } },
      { status: 409 },
    );
  }

  const member = await createStaffInvite({
    name,
    email: emailLower,
    roleName: role,
    // Unusable credential: a hash of random bytes nobody knows. The
    // invitee gets a real password only through the reset flow after
    // activation — this value must never be treated as a login password.
    passwordHash: hashPassword(randomBytes(32).toString("hex")),
  });

  await recordDemoAudit({
    actorId: guard.userId,
    action: "staff.invite",
    entityType: "User",
    entityId: member.id,
    afterJson: { email: member.email, role: member.role, status: member.status },
    reason: reason ?? "Staff invite created.",
    ip: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
  });

  return NextResponse.json(
    {
      data: {
        member,
        invite: { status: "queued", delivered: false, channel: "email" },
      },
      meta: {
        persistence: "database",
        note: "Invite recorded as an inactive User row in the database. NO email was sent — delivery happens only after the email provider wiring lands; invite status is 'queued', delivered: false.",
      },
    },
    { status: 201 },
  );
}
