import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, permissionsForRole } from "@/lib/rbac";
import { InviteForm } from "./invite-form";

// Staff & Roles admin — Agent 27.
// Permissions behind this page: staff.view / staff.manage / roles.manage
// (see src/lib/rbac.ts). ALL PEOPLE BELOW ARE FICTIONAL SAMPLE ROWS —
// demo-labelled, no real person, no real email. Role cards are computed
// from the real DEFAULT_ROLE_PERMISSIONS / permissionsForRole() in
// src/lib/rbac.ts (Owner = the full PERMISSIONS catalogue).
// Real wiring (later): staff list from the User/Role tables via an admin
// staff API; status changes and invites audited (see /admin/audit).

type StaffStatus = "ACTIVE" | "INVITED" | "SUSPENDED";

interface SampleStaff {
  id: string;
  name: string;
  email: string;
  role: string;
  status: StaffStatus;
  lastLogin: string;
  totpEnabled: boolean;
}

const SAMPLE_STAFF: SampleStaff[] = [
  {
    id: "staff_sample_owner",
    name: "SAMPLE মালিক (Demo Owner)",
    email: "owner@sample.invalid",
    role: "Owner",
    status: "ACTIVE",
    lastLogin: "২৪ অক্টোবর ২০২৬, ০৯:১৫",
    totpEnabled: true,
  },
  {
    id: "staff_sample_manager",
    name: "SAMPLE ম্যানেজার (Demo Manager)",
    email: "manager@sample.invalid",
    role: "Manager",
    status: "ACTIVE",
    lastLogin: "২৪ অক্টোবর ২০২৬, ১০:০২",
    totpEnabled: true,
  },
  {
    id: "staff_sample_processor",
    name: "SAMPLE অর্ডার প্রসেসর (Demo Processor)",
    email: "processor@sample.invalid",
    role: "Order Processor",
    status: "ACTIVE",
    lastLogin: "২৪ অক্টোবর ২০২৬, ১১:৪০",
    totpEnabled: false,
  },
  {
    id: "staff_sample_inventory",
    name: "SAMPLE ইনভেন্টরি (Demo Inventory)",
    email: "inventory@sample.invalid",
    role: "Inventory",
    status: "ACTIVE",
    lastLogin: "২৩ অক্টোবর ২০২৬, ১৮:২২",
    totpEnabled: false,
  },
  {
    id: "staff_sample_accountant",
    name: "SAMPLE হিসাবরক্ষক (Demo Accountant)",
    email: "accountant@sample.invalid",
    role: "Accountant",
    status: "SUSPENDED",
    lastLogin: "১০ অক্টোবর ২০২৬, ১২:০৫",
    totpEnabled: true,
  },
  {
    id: "staff_sample_support",
    name: "SAMPLE সাপোর্ট (Demo Support)",
    email: "support@sample.invalid",
    role: "Support",
    status: "INVITED",
    lastLogin: "কখনো নয় (আমন্ত্রণ অপেক্ষমাণ)",
    totpEnabled: false,
  },
];

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
  const activeCount = SAMPLE_STAFF.filter((s) => s.status === "ACTIVE").length;
  const invitedCount = SAMPLE_STAFF.filter((s) => s.status === "INVITED").length;
  const totpCount = SAMPLE_STAFF.filter((s) => s.totpEnabled).length;

  const staffRows = SAMPLE_STAFF.map((s) => ({
    name: <span className="font-medium">{s.name}</span>,
    email: <span className="font-mono text-xs">{s.email}</span>,
    role: <Badge tone="brand">{s.role}</Badge>,
    status: (
      <Badge tone={s.status === "ACTIVE" ? "success" : s.status === "INVITED" ? "warning" : "danger"}>
        {s.status === "ACTIVE" ? "সক্রিয় (ACTIVE)" : s.status === "INVITED" ? "আমন্ত্রিত (INVITED)" : "স্থগিত (SUSPENDED)"}
      </Badge>
    ),
    lastLogin: s.lastLogin,
    totp: s.totpEnabled ? (
      <Badge tone="success">2FA চালু</Badge>
    ) : (
      <Badge tone="warning">2FA বন্ধ</Badge>
    ),
  }));

  return (
    <main>
      <PageHeader
        title="স্টাফ ও ভূমিকা"
        description="TEMPORARY DEMO — নিচের সব মানুষ কাল্পনিক SAMPLE সারি; কোনো আসল ব্যক্তি বা ইমেইল নয়। ভূমিকার অনুমতি আসল rbac ক্যাটালগ থেকে হিসাব করা। (Staff & Roles — staff.view / staff.manage / roles.manage)"
        breadcrumb="Admin / System"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="মোট স্টাফ (ডেমো)" value={String(SAMPLE_STAFF.length)} delta="নমুনা তালিকা" icon="👥" />
        <StatCard label="সক্রিয়" value={String(activeCount)} delta={`${invitedCount} জন আমন্ত্রিত`} icon="✅" />
        <StatCard label="2FA চালু আছে" value={`${totpCount}/${SAMPLE_STAFF.length}`} delta="বাকিদের চালু করতে বলুন" deltaTone="down" icon="🔐" />
        <StatCard label="মোট অনুমতি (ক্যাটালগ)" value={String(PERMISSIONS.length)} delta="rbac.ts PERMISSIONS" icon="🗝️" />
      </div>

      <h2 className="mb-3 text-lg font-semibold">স্টাফ তালিকা (SAMPLE)</h2>
      <DataTable
        caption="নমুনা স্টাফ — আসল তালিকা DB-র User/Role টেবিল থেকে আসবে; স্ট্যাটাস বদল staff.manage অনুমতিতে অডিটসহ হবে"
        columns={[
          { key: "name", header: "নাম" },
          { key: "email", header: "ইমেইল" },
          { key: "role", header: "ভূমিকা" },
          { key: "status", header: "অবস্থা" },
          { key: "lastLogin", header: "শেষ লগইন" },
          { key: "totp", header: "2FA (TOTP)" },
        ]}
        rows={staffRows}
      />

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

      <h2 className="mb-3 mt-8 text-lg font-semibold">নতুন স্টাফ আমন্ত্রণ (আউটলাইন)</h2>
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
