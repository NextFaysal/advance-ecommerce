import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, permissionsForRole } from "@/lib/rbac";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { ROLE_LABEL_KEYS, STAFF_STRINGS } from "./strings";
import { InviteForm } from "./invite-form";
import { StaffList } from "./staff-list";

// Staff & Roles admin.
// Permissions behind this page: staff.view / staff.manage / roles.manage
// (see src/lib/rbac.ts). The member list is REAL — <StaffList> reads
// GET /api/v1/admin/staff (User/Role tables via Prisma, the same
// store the invite flow writes to). Role cards are computed from the
// real DEFAULT_ROLE_PERMISSIONS / permissionsForRole() in
// src/lib/rbac.ts (Owner = the full PERMISSIONS catalogue).

const ROLE_NAMES: string[] = ["Owner", ...Object.keys(DEFAULT_ROLE_PERMISSIONS)];

export default async function AdminStaffPage() {
  const locale = await getRequestLocale();
  const t = pick(locale, STAFF_STRINGS);
  return (
    <main>
      <PageHeader title={t.title} description={t.description} breadcrumb={t.breadcrumb} />

      <StaffList permissionCount={PERMISSIONS.length} />

      <h2 className="mb-3 mt-8 text-lg font-semibold">{t.rolesTitle}</h2>
      <p className="mb-3 text-sm text-text-muted">
        {t.rolesNoteA}
        <code>src/lib/rbac.ts</code>
        {t.rolesNoteB}
        <code>permissionsForRole()</code>
        {t.rolesNoteC}
        <code>DEFAULT_ROLE_PERMISSIONS</code>
        {t.rolesNoteD}
      </p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {ROLE_NAMES.map((role) => {
          const perms = permissionsForRole(role);
          const shown = perms.slice(0, 6);
          const extra = perms.length - shown.length;
          return (
            <Card key={role}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{role}</p>
                  <p className="text-xs text-text-muted">{ROLE_LABEL_KEYS[role] ? t[ROLE_LABEL_KEYS[role]] : role}</p>
                </div>
                <Badge tone="info">{interpolate(t.permCount, { count: perms.length })}</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {shown.map((p) => (
                  <span key={p} className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-text-muted">
                    {p}
                  </span>
                ))}
                {extra > 0 ? (
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                    {interpolate(t.morePerms, { count: extra })}
                  </span>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">{t.inviteTitle}</h2>
      <Card>
        <InviteForm />
      </Card>

      <Card className="mt-6 border-amber-200 bg-amber-50">
        <p className="text-sm font-medium text-amber-900">{t.ownerRuleTitle}</p>
        <p className="mt-1 text-sm text-amber-800">
          {t.ownerRuleA}
          <code className="font-mono text-xs">pnpm --filter @advance-ecommerce/db exec tsx scripts/create-first-owner.ts</code>
          {t.ownerRuleB}
        </p>
      </Card>
    </main>
  );
}
