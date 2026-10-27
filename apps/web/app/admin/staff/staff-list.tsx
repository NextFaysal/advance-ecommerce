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
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, type Locale } from "@/i18n/locale";
import { STAFF_STRINGS, type StaffStrings } from "./strings";

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

function formatDate(iso: string | null, locale: Locale, neverLabel: string): string {
  if (iso === null) return neverLabel;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return neverLabel;
  return new Intl.DateTimeFormat(intlLocale(locale), {
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

function statusBadge(
  status: StaffMember["status"],
  t: StaffStrings,
): { label: string; tone: "success" | "warning" | "danger" } {
  switch (status) {
    case "ACTIVE":
      return { label: t.statusActive, tone: "success" };
    case "SUSPENDED":
      return { label: t.statusSuspended, tone: "danger" };
    default:
      return { label: t.statusInvited, tone: "warning" };
  }
}

export function StaffList({ permissionCount }: { permissionCount: number }) {
  const { locale } = useLocale();
  const t = STAFF_STRINGS[locale];
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
      setLoadError(t.networkError);
      setLoadState("error");
    }
  }, [t]);

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
        setRowError(json?.error?.message ?? t.resendFailed);
      } else {
        setFreshLink({ id: member.id, link: json.data.invite.link, expiresAt: json.data.invite.expiresAt });
        setLinkCopied(await copyText(json.data.invite.link));
        await load();
      }
    } catch {
      setRowError(t.connectError);
    }
    setBusyId(null);
  }

  async function handleRevoke(member: StaffMember) {
    if (!window.confirm(interpolate(t.revokeConfirm, { name: member.name }))) return;
    setRowError(null);
    setBusyId(member.id);
    try {
      const res = await fetch(`/api/v1/admin/staff/${member.id}/revoke-invite`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setRowError(json?.error?.message ?? t.revokeFailed);
      } else {
        if (freshLink?.id === member.id) setFreshLink(null);
        await load();
      }
    } catch {
      setRowError(t.connectError);
    }
    setBusyId(null);
  }

  const activeCount = members.filter((m) => m.status === "ACTIVE").length;
  const invitedCount = members.filter((m) => m.status === "INVITED").length;
  const totpCount = members.filter((m) => m.totpEnabled).length;

  const rows = members.map((m) => {
    const badge = statusBadge(m.status, t);
    return {
      name: <span className="font-medium">{m.name}</span>,
      identifier: (
        <span className="font-mono text-xs">{m.email !== "" ? m.email : m.phone !== "" ? m.phone : "—"}</span>
      ),
      role: <Badge tone="brand">{m.role}</Badge>,
      status: <Badge tone={badge.tone}>{badge.label}</Badge>,
      lastLogin: m.lastLoginAt ? formatDate(m.lastLoginAt, locale, t.never) : t.neverLoggedIn,
      totp: m.totpEnabled ? (
        <Badge tone="success">{t.totpOn}</Badge>
      ) : (
        <Badge tone="warning">{t.totpOff}</Badge>
      ),
      actions: m.invitePending ? (
        <span className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={busyId === m.id} onClick={() => void handleResend(m)}>
            {t.newLink}
          </Button>
          <Button type="button" variant="destructive" disabled={busyId === m.id} onClick={() => void handleRevoke(m)}>
            {t.revoke}
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
        <StatCard label={t.statTotal} value={String(total)} delta={t.statTotalDelta} icon={<Icon name="users" size={22} />} />
        <StatCard label={t.statActive} value={String(activeCount)} delta={interpolate(t.statActiveDelta, { count: invitedCount })} icon={<Icon name="check" size={22} />} />
        <StatCard
          label={t.stat2fa}
          value={members.length > 0 ? `${totpCount}/${members.length}` : "0"}
          delta={t.stat2faDelta}
          deltaTone="down"
          icon={<Icon name="shield" size={22} />}
        />
        <StatCard label={t.statPerms} value={String(permissionCount)} delta={t.statPermsDelta} icon={<Icon name="settings" size={22} />} />
      </div>

      <h2 className="mb-3 text-lg font-semibold">{t.listTitle}</h2>

      {loadState === "loading" && (
        <div role="status" aria-label={t.loadingAria} className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-0">
              <div className="h-4 w-32 animate-pulse rounded bg-border" />
              <div className="h-4 w-40 animate-pulse rounded bg-border" />
              <div className="ml-auto h-4 w-16 animate-pulse rounded bg-border" />
            </div>
          ))}
          <p className="px-4 py-3 text-small text-text-muted">{t.loadingText}</p>
        </div>
      )}

      {loadState === "error" && (
        <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-5 shadow-card">
          <p className="font-semibold text-rose-700">{t.loadErrorTitle}</p>
          <p className="mt-1 text-small text-rose-600">{loadError}</p>
          <Button variant="outline" className="mt-4 bg-card" onClick={() => void load()}>
            {t.retry}
          </Button>
        </div>
      )}

      {loadState === "ready" && members.length === 0 && (
        <div className="rounded-lg border border-border bg-card px-6 py-12 text-center shadow-card">
          <h3 className="text-h3">{t.emptyTitle}</h3>
          <p className="mx-auto mt-1 max-w-md text-small leading-relaxed text-text-muted">{t.emptyDesc}</p>
        </div>
      )}

      {loadState === "ready" && members.length > 0 && (
        <DataTable
          caption={t.tableCaption}
          columns={[
            { key: "name", header: t.colName },
            { key: "identifier", header: t.colIdentifier },
            { key: "role", header: t.colRole },
            { key: "status", header: t.colStatus },
            { key: "lastLogin", header: t.colLastLogin },
            { key: "totp", header: t.colTotp },
            { key: "actions", header: t.colActions },
          ]}
          rows={rows}
        />
      )}

      {freshLink ? (
        <div role="status" className="mt-4 rounded-md bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
          <p className="font-medium">
            {t.freshLinkTitle}
            {linkCopied ? t.freshLinkCopied : ""}
            {t.freshLinkTitleSuffix}
          </p>
          <p className="mt-1 text-xs">
            {t.freshLinkNote}
            {freshLink.expiresAt ? interpolate(t.freshLinkExpiry, { date: formatDate(freshLink.expiresAt, locale, t.never) }) : ""}
          </p>
          <input
            readOnly
            value={freshLink.link}
            onFocus={(e) => e.target.select()}
            className="mt-2 h-10 w-full rounded-lg border border-emerald-200 bg-white px-3 font-mono text-xs text-text-main"
            aria-label={t.freshLinkAria}
          />
        </div>
      ) : null}

      {rowError ? (
        <p role="alert" className="mt-4 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {rowError}
        </p>
      ) : null}

      <p className="mt-3 text-xs leading-relaxed text-text-muted">{t.limitsNote}</p>
    </>
  );
}
