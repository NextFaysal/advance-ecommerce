"use client";

// Staff member list — REAL data from GET /api/v1/admin/staff
// (User/Role tables via Prisma; the same store the invite panel
// below uses). Shows name, identifier (email, falling back to
// phone), role, derived status (ACTIVE / INVITED / SUSPENDED),
// usable 2FA state (the API reports totpEnabled only when a secret
// is actually stored — a legacy flag without a secret reads as off)
// and last login.
//
// Row actions: the staff API genuinely supports only invite
// resend / revoke for members whose invite is still pending, and
// those are wired here (resend returns a fresh one-time link — the
// old link dies; revoke soft-deletes the never-activated row). There
// is NO activate / suspend endpoint in the staff API, so no such
// buttons are rendered — the note under the table says so plainly.
import { useCallback, useEffect, useState } from "react";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

interface StaffMember {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  status: "ACTIVE" | "INVITED" | "SUSPENDED";
  totpEnabled: boolean;
  lastLoginAt: string | null;
  invitedBy: string | null;
  invitePending: boolean;
  inviteExpiresAt: string | null;
}

type LoadState = "loading" | "error" | "ready";

function formatBnDate(iso: string | null): string {
  if (iso === null) return "কখনো নয়";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "কখনো নয়";
  return new Intl.DateTimeFormat("bn-BD", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Dhaka",
  }).format(d);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const STATUS_BADGE: Record<StaffMember["status"], { label: string; tone: "success" | "warning" | "danger" }> = {
  ACTIVE: { label: "সক্রিয় (ACTIVE)", tone: "success" },
  INVITED: { label: "আমন্ত্রিত (INVITED)", tone: "warning" },
  SUSPENDED: { label: "স্থগিত (SUSPENDED)", tone: "danger" },
};

export function StaffList({ permissionCount }: { permissionCount: number }) {
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [total, setTotal] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [rowError, setRowError] = useState<string | null>(null);
  const [freshLink, setFreshLink] = useState<{ id: string; link: string; expiresAt?: string } | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const res = await fetch("/api/v1/admin/staff?pageSize=100");
      const body = (await res.json().catch(() => null)) as
        | { data?: { staff?: StaffMember[]; total?: number }; error?: { code: string; message: string } }
        | null;
      if (res.ok && body?.data?.staff) {
        setMembers(body.data.staff);
        setTotal(body.data.total ?? body.data.staff.length);
        setLoadState("ready");
      } else {
        setLoadError(
          body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`,
        );
        setLoadState("error");
      }
    } catch {
      setLoadError("নেটওয়ার্ক সমস্যা — API-তে পৌঁছানো যায়নি।");
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleResend(member: StaffMember) {
    setRowError(null);
    setFreshLink(null);
    setLinkCopied(false);
    setBusyId(member.id);
    try {
      const res = await fetch(`/api/v1/admin/staff/${member.id}/resend-invite`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as
        | { data?: { invite?: { link?: string; expiresAt?: string } }; error?: { message?: string } }
        | null;
      if (!res.ok || json?.data?.invite?.link === undefined) {
        setRowError(json?.error?.message ?? "নতুন লিংক তৈরি করা যায়নি।");
      } else {
        setFreshLink({ id: member.id, link: json.data.invite.link, expiresAt: json.data.invite.expiresAt });
        setLinkCopied(await copyText(json.data.invite.link));
        await load();
      }
    } catch {
      setRowError("সার্ভারে সংযোগ করা যায়নি।");
    }
    setBusyId(null);
  }

  async function handleRevoke(member: StaffMember) {
    if (!window.confirm(`"${member.name}"-এর আমন্ত্রণ বাতিল করবেন? লিংকটি সাথে সাথে অকার্যকর হয়ে যাবে।`)) return;
    setRowError(null);
    setBusyId(member.id);
    try {
      const res = await fetch(`/api/v1/admin/staff/${member.id}/revoke-invite`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setRowError(json?.error?.message ?? "আমন্ত্রণ বাতিল করা যায়নি।");
      } else {
        if (freshLink?.id === member.id) setFreshLink(null);
        await load();
      }
    } catch {
      setRowError("সার্ভারে সংযোগ করা যায়নি।");
    }
    setBusyId(null);
  }

  const activeCount = members.filter((m) => m.status === "ACTIVE").length;
  const invitedCount = members.filter((m) => m.status === "INVITED").length;
  const totpCount = members.filter((m) => m.totpEnabled).length;

  const rows = members.map((m) => {
    const badge = STATUS_BADGE[m.status] ?? STATUS_BADGE.INVITED;
    return {
      name: <span className="font-medium">{m.name}</span>,
      identifier: (
        <span className="font-mono text-xs">{m.email !== "" ? m.email : m.phone !== "" ? m.phone : "—"}</span>
      ),
      role: <Badge tone="brand">{m.role}</Badge>,
      status: <Badge tone={badge.tone}>{badge.label}</Badge>,
      lastLogin: m.lastLoginAt ? formatBnDate(m.lastLoginAt) : "কখনো নয় (লগইন হয়নি)",
      totp: m.totpEnabled ? (
        <Badge tone="success">2FA চালু</Badge>
      ) : (
        <Badge tone="warning">2FA বন্ধ</Badge>
      ),
      actions: m.invitePending ? (
        <span className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={busyId === m.id} onClick={() => void handleResend(m)}>
            নতুন লিংক
          </Button>
          <Button type="button" variant="destructive" disabled={busyId === m.id} onClick={() => void handleRevoke(m)}>
            বাতিল করুন
          </Button>
        </span>
      ) : (
        <span className="text-xs text-text-subtle">—</span>
      ),
    };
  });

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="মোট স্টাফ" value={String(total)} delta="আসল তালিকা (DB)" icon={<Icon name="users" size={22} />} />
        <StatCard label="সক্রিয়" value={String(activeCount)} delta={`${invitedCount} জন আমন্ত্রিত`} icon={<Icon name="check" size={22} />} />
        <StatCard
          label="2FA চালু আছে"
          value={members.length > 0 ? `${totpCount}/${members.length}` : "0"}
          delta="বাকিদের চালু করতে বলুন"
          deltaTone="down"
          icon={<Icon name="shield" size={22} />}
        />
        <StatCard label="মোট অনুমতি (ক্যাটালগ)" value={String(permissionCount)} delta="rbac.ts PERMISSIONS" icon={<Icon name="settings" size={22} />} />
      </div>

      <h2 className="mb-3 text-lg font-semibold">স্টাফ তালিকা</h2>

      {loadState === "loading" && (
        <div role="status" aria-label="স্টাফ লোড হচ্ছে" className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0">
              <div className="h-4 w-32 animate-pulse rounded bg-border" />
              <div className="h-4 w-40 animate-pulse rounded bg-border" />
              <div className="ml-auto h-4 w-16 animate-pulse rounded bg-border" />
            </div>
          ))}
          <p className="px-4 py-3 text-small text-text-muted">স্টাফ তালিকা লোড হচ্ছে…</p>
        </div>
      )}

      {loadState === "error" && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-5 shadow-card">
          <p className="font-semibold text-rose-700">স্টাফ তালিকা লোড হয়নি</p>
          <p className="mt-1 text-small text-rose-600">{loadError}</p>
          <Button variant="outline" className="mt-4 bg-card" onClick={() => void load()}>
            আবার চেষ্টা করুন
          </Button>
        </div>
      )}

      {loadState === "ready" && members.length === 0 && (
        <div className="rounded-lg border border-border bg-card px-6 py-12 text-center shadow-card">
          <h3 className="text-h3">কোনো স্টাফ নেই</h3>
          <p className="mx-auto mt-1 max-w-md text-small leading-relaxed text-text-muted">
            ডাটাবেসে এখনো কোনো স্টাফ অ্যাকাউন্ট নেই। নিচের ফর্ম দিয়ে প্রথম আমন্ত্রণ তৈরি করুন।
          </p>
        </div>
      )}

      {loadState === "ready" && members.length > 0 && (
        <DataTable
          caption="আসল স্টাফ — ডাটাবেসের User/Role টেবিল থেকে (GET /api/v1/admin/staff)"
          columns={[
            { key: "name", header: "নাম" },
            { key: "identifier", header: "ইমেইল / ফোন" },
            { key: "role", header: "ভূমিকা" },
            { key: "status", header: "অবস্থা" },
            { key: "lastLogin", header: "শেষ লগইন" },
            { key: "totp", header: "2FA (TOTP)" },
            { key: "actions", header: "অ্যাকশন" },
          ]}
          rows={rows}
        />
      )}

      {freshLink ? (
        <div role="status" className="mt-4 rounded-md bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
          <p className="font-medium">
            নতুন আমন্ত্রণ লিংক তৈরি হয়েছে{linkCopied ? " এবং কপি করা হয়েছে" : ""} — নিজে শেয়ার করুন।
          </p>
          <p className="mt-1 text-xs">
            কোনো ইমেইল পাঠানো হয়নি; আগের লিংকটি বাতিল হয়ে গেছে।
            {freshLink.expiresAt ? ` মেয়াদ: ${formatBnDate(freshLink.expiresAt)} পর্যন্ত।` : ""}
          </p>
          <input
            readOnly
            value={freshLink.link}
            onFocus={(e) => e.target.select()}
            className="mt-2 h-10 w-full rounded-lg border border-emerald-200 bg-white px-3 font-mono text-xs text-text-main"
            aria-label="নতুন আমন্ত্রণ লিংক"
          />
        </div>
      ) : null}

      {rowError ? (
        <p role="alert" className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {rowError}
        </p>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-text-muted">
        সীমাবদ্ধতা: স্টাফ API-তে সক্রিয়/স্থগিত করার (activate/suspend) কোনো endpoint নেই — তাই সেই
        বোতাম রাখা হয়নি। শুধু অপেক্ষমাণ আমন্ত্রণের লিংক আবার পাঠানো বা বাতিল করা যায় (উপরে);
        আমন্ত্রণ গ্রহণ হলেই অ্যাকাউন্ট সক্রিয় হয়। 2FA অবস্থা "ব্যবহারযোগ্য" হিসেবে দেখানো হয় —
        সিক্রেট সংরক্ষিত না থাকলে চালু ধরা হয় না।
      </p>
    </>
  );
}
