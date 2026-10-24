import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, permissionsForRole } from "@/lib/rbac";
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

const ROLE_LABEL_BN: Record<string, string> = {
  Owner: "মালিক — সব অনুমতি",
  Manager: "ম্যানেজার",
  "Order Processor": "অর্ডার প্রসেসর",
  Inventory: "ইনভেন্টরি",
  Support: "সাপোর্ট",
  Accountant: "হিসাবরক্ষক",
  "Content Editor": "কন্টেন্ট এডিটর",
};

export default function AdminStaffPage() {
  return (
    <main>
      <PageHeader
        title="স্টাফ ও ভূমিকা"
        description="আসল স্টাফ তালিকা ডাটাবেসের User/Role টেবিল থেকে আসে; আমন্ত্রণও আসল API দিয়ে যায়। ভূমিকার অনুমতি আসল rbac ক্যাটালগ থেকে হিসাব করা। (Staff & Roles — staff.view / staff.manage / roles.manage)"
        breadcrumb="Admin / System"
      />

      <StaffList permissionCount={PERMISSIONS.length} />

      <h2 className="mb-3 mt-8 text-lg font-semibold">ভূমিকা ও অনুমতি (Roles)</h2>
      <p className="mb-3 text-sm text-text-muted">
        প্রতিটি কার্ডের সংখ্যা ও তালিকা <code>src/lib/rbac.ts</code>-এর আসল{" "}
        <code>permissionsForRole()</code> দিয়ে হিসাব করা — Owner পায় পুরো ক্যাটালগ, বাকিরা{" "}
        <code>DEFAULT_ROLE_PERMISSIONS</code> অনুযায়ী।
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
                  <p className="text-xs text-text-muted">{ROLE_LABEL_BN[role] ?? role}</p>
                </div>
                <Badge tone="info">{perms.length}টি অনুমতি</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {shown.map((p) => (
                  <span key={p} className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-[11px] text-text-muted">
                    {p}
                  </span>
                ))}
                {extra > 0 ? (
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-medium text-brand-700">
                    + আরও {extra}টি
                  </span>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">নতুন স্টাফ আমন্ত্রণ</h2>
      <Card>
        <InviteForm />
      </Card>

      <Card className="mt-6 border-amber-200 bg-amber-50">
        <p className="text-sm font-medium text-amber-900">প্রথম Owner সম্পর্কে নিয়ম</p>
        <p className="mt-1 text-sm text-amber-800">
          প্রথম Owner অ্যাকাউন্ট শুধুমাত্র লোকাল স্ক্রিপ্ট দিয়ে তৈরি হয় —{" "}
          <code className="font-mono text-xs">pnpm --filter @advance-ecommerce/db exec tsx scripts/create-first-owner.ts</code>{" "}
          (তথ্য শুধু লোকাল env থেকে নেয়, পাসওয়ার্ড কখনো ছাপা হয় না)। কোনো seeded বা default
          Owner অ্যাকাউন্ট নেই এবং থাকবেও না — ডাটাবেসে জানা পাসওয়ার্ডসহ কোনো অ্যাকাউন্ট
          আগে থেকে বসানো হয় না।
        </p>
      </Card>
    </main>
  );
}
