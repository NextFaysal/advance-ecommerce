import { NextResponse } from "next/server";
import { z } from "zod";
import { guardError, requireAdmin } from "@/reports/guard";
import { DEFAULT_ROLE_PERMISSIONS, permissionsForRole } from "@/lib/rbac";
import { demoStaffStore, type DemoStaffMember } from "./store";
import { recordDemoAudit } from "../audit-log/store";

// Staff API — Agent 39.
// GET: staff.view. POST (invite): staff.manage.
// Persistence: in-memory demo store (labelled). NO email is ever sent by
// the invite — the response reports the invite as queued with
// delivered: false until the email provider wiring lands.
// An Owner can NEVER be created through this API: the first Owner is
// created only by packages/db/scripts/create-first-owner.ts (run once,
// local env), and any invite with role "Owner" is rejected with 422.

const STAFF_ROLES: readonly string[] = ["Owner", ...Object.keys(DEFAULT_ROLE_PERMISSIONS)];

function roleCatalogue() {
  return STAFF_ROLES.map((name) => {
    const permissions = permissionsForRole(name);
    return { name, permissionCount: permissions.length, permissions };
  });
}

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
  const filtered = demoStaffStore.filter((m) => {
    if (status && m.status !== status) return false;
    if (role && m.role !== role) return false;
    if (needle && !`${m.name} ${m.email}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);

  return NextResponse.json({
    data: { staff: rows, total: filtered.length, roles: roleCatalogue() },
    meta: {
      page,
      pageSize,
      persistence: "in-memory-demo",
      source: "TEMPORARY_DEMO",
      note: "Fictional demo rows (@sample.invalid). Real wiring reads the User/Role tables; no staff record exists until the DB is seeded and the first Owner is created via the create-first-owner script.",
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
  if (!STAFF_ROLES.includes(role)) {
    return NextResponse.json(
      { error: { code: "INVALID_ROLE", message: `Unknown role: ${role}`, details: { roles: STAFF_ROLES } } },
      { status: 422 },
    );
  }
  const emailLower = email.toLowerCase();
  if (demoStaffStore.some((m) => m.email.toLowerCase() === emailLower)) {
    return NextResponse.json(
      { error: { code: "DUPLICATE_EMAIL", message: "A staff record with this email already exists." } },
      { status: 409 },
    );
  }

  const member: DemoStaffMember = {
    id: `staff_invite_${Date.now()}`,
    name,
    email: emailLower,
    role,
    status: "INVITED",
    totpEnabled: false,
    lastLoginAt: null,
    invitedBy: guard.userId,
    invitedAt: new Date().toISOString(),
  };
  demoStaffStore.push(member);

  recordDemoAudit({
    actorId: guard.userId,
    action: "staff.invite",
    entityType: "User",
    entityId: member.id,
    afterJson: { email: member.email, role: member.role, status: member.status },
    reason: reason ?? "Staff invite created (demo store).",
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
        persistence: "in-memory-demo",
        wiring: "NOT_WIRED",
        note: "Invite recorded in the demo store only. NO email was sent — delivery happens only after the email provider wiring lands; invite status is 'queued', delivered: false.",
      },
    },
    { status: 201 },
  );
}
