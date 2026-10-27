"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, type Locale } from "@/i18n/locale";
import { STAFF_STRINGS, type StaffStrings } from "./strings";

/**
 * Staff invites — REAL wiring (staff invite flow).
 *
 * InviteForm: POST /api/v1/admin/staff (guarded by `staff.manage`).
 * The API creates an inactive User with a hashed one-time invite token
 * and returns the invite link exactly ONCE — this form shows it with a
 * copy button. NO email is sent by the system yet: the inviter shares
 * the link manually (WhatsApp / Messenger / in person). The invitee
 * opens /admin/accept-invite, sets their own name + password, and only
 * then can log in — no password is ever created or shown here.
 *
 * PendingInvites: lists members with a live invite (GET ?status=INVITED).
 * The original link can never be shown again (only its hash is stored),
 * so "নতুন লিংক কপি করুন" generates a FRESH link via resend — which
 * invalidates the previous one — and copies it. "বাতিল করুন" revokes
 * the invite (token cleared, row soft-deleted).
 */

interface InviteResponse {
  data?: {
    invite?: { link?: string; expiresAt?: string };
  };
  error?: { message?: string };
}

interface PendingMember {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  invitedBy: string | null;
  inviteExpiresAt: string | null;
  invitePending: boolean;
}

function formatDate(iso: string | null, locale: Locale): string {
  if (iso === null) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
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

function OneTimeLink({ link, expiresAt, t, locale }: { link: string; expiresAt?: string; t: StaffStrings; locale: Locale }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="rounded-md bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
      <p className="font-medium">{t.linkCreatedTitle}</p>
      <p className="mt-1 text-xs">
        {t.linkCreatedNote}
        {expiresAt ? interpolate(t.linkExpiry, { date: formatDate(expiresAt, locale) }) : ""}
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          className="h-10 min-w-0 flex-1 rounded-lg border border-emerald-200 bg-white px-3 font-mono text-xs text-text-main"
          aria-label={t.inviteLinkAria}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            setCopied(await copyText(link));
          }}
        >
          {copied ? t.copied : t.copyLink}
        </Button>
      </div>
    </div>
  );
}

export function InviteForm() {
  const { locale } = useLocale();
  const t = STAFF_STRINGS[locale];
  const roleOptions = [
    { value: "Manager", label: t.roleOptManager },
    { value: "Order Processor", label: t.roleOptOrderProcessor },
    { value: "Inventory", label: t.roleOptInventory },
    { value: "Support", label: t.roleOptSupport },
    { value: "Accountant", label: t.roleOptAccountant },
    { value: "Content Editor", label: t.roleOptContentEditor },
  ];
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("Support");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [issued, setIssued] = useState<{ link: string; expiresAt?: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIssued(null);
    if (email.trim() === "" && phone.trim() === "") {
      setError(t.needContact);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          ...(email.trim() !== "" ? { email: email.trim() } : {}),
          ...(phone.trim() !== "" ? { phone: phone.trim() } : {}),
          role,
          reason: "Staff invite created from admin staff page.",
        }),
      });
      const json = (await res.json().catch(() => null)) as InviteResponse | null;
      if (!res.ok || json?.data?.invite?.link === undefined) {
        setError(json?.error?.message ?? t.inviteFailed);
        setSubmitting(false);
        return;
      }
      setIssued({ link: json.data.invite.link, expiresAt: json.data.invite.expiresAt });
      setName("");
      setEmail("");
      setPhone("");
      setRefreshKey((k) => k + 1);
    } catch {
      setError(t.connectRetry);
    }
    setSubmitting(false);
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-3">
        <Input
          name="invite-name"
          label={t.fName}
          placeholder={t.fNamePlaceholder}
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Input
          name="invite-email"
          label={t.fEmail}
          placeholder="staff@your-shop.com"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          name="invite-phone"
          label={t.fPhone}
          placeholder="01XXXXXXXXX"
          type="tel"
          autoComplete="off"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Combobox label={t.fRole} options={roleOptions} value={role} onChange={setRole} placeholder={t.fRolePlaceholder} />
        <div className="sm:col-span-2">
          <Button type="submit" variant="secondary" disabled={submitting}>
            {submitting ? t.submitWait : t.submit}
          </Button>
          <p className="mt-2 text-xs text-text-muted">{t.formNote}</p>
        </div>
        {error ? (
          <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-3">
            {error}
          </p>
        ) : null}
        {issued ? (
          <div className="sm:col-span-3">
            <OneTimeLink link={issued.link} expiresAt={issued.expiresAt} t={t} locale={locale} />
          </div>
        ) : null}
      </form>
      <PendingInvites refreshKey={refreshKey} />
    </div>
  );
}

export function PendingInvites({ refreshKey = 0 }: { refreshKey?: number }) {
  const { locale } = useLocale();
  const t = STAFF_STRINGS[locale];
  const [members, setMembers] = useState<PendingMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [freshLink, setFreshLink] = useState<{ id: string; link: string; expiresAt?: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/staff?status=INVITED&pageSize=100");
      const json = (await res.json().catch(() => null)) as
        | { data?: { staff?: PendingMember[] }; error?: { message?: string } }
        | null;
      if (!res.ok || json?.data?.staff === undefined) {
        setLoadError(json?.error?.message ?? t.listLoadFailed);
        setMembers([]);
        return;
      }
      setMembers(json.data.staff.filter((m) => m.invitePending));
    } catch {
      setLoadError(t.connectError);
      setMembers([]);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load, reload, refreshKey]);

  async function handleResend(member: PendingMember) {
    setRowError(null);
    setFreshLink(null);
    setBusyId(member.id);
    try {
      const res = await fetch(`/api/v1/admin/staff/${member.id}/resend-invite`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as InviteResponse | null;
      if (!res.ok || json?.data?.invite?.link === undefined) {
        setRowError(json?.error?.message ?? t.resendFailed);
      } else {
        setFreshLink({ id: member.id, link: json.data.invite.link, expiresAt: json.data.invite.expiresAt });
        await copyText(json.data.invite.link);
        setReload((k) => k + 1);
      }
    } catch {
      setRowError(t.connectError);
    }
    setBusyId(null);
  }

  async function handleRevoke(member: PendingMember) {
    if (!window.confirm(interpolate(t.revokeConfirm, { name: member.name }))) return;
    setRowError(null);
    setBusyId(member.id);
    try {
      const res = await fetch(`/api/v1/admin/staff/${member.id}/revoke-invite`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setRowError(json?.error?.message ?? t.revokeFailed);
      } else {
        setReload((k) => k + 1);
      }
    } catch {
      setRowError(t.connectError);
    }
    setBusyId(null);
  }

  return (
    <div className="mt-8">
      <h3 className="text-base font-semibold text-text-main">{t.pendingTitle}</h3>
      <p className="mt-1 text-xs text-text-muted">{t.pendingNote}</p>
      {loadError ? (
        <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {loadError}
        </p>
      ) : null}
      {members === null ? (
        <p className="mt-3 text-sm text-text-muted">{t.loadingShort}</p>
      ) : members.length === 0 ? (
        <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-sm text-text-muted">{t.noPending}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
          {members.map((m) => (
            <li key={m.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-medium text-text-main">{m.name}</span>
                <span className="font-mono text-xs text-text-muted">{m.email !== "" ? m.email : m.phone}</span>
                <Badge tone="brand">{m.role}</Badge>
                <Badge tone="warning">{t.invitedBadge}</Badge>
                <span className="text-xs text-text-muted">
                  {interpolate(t.expiryLabel, { date: formatDate(m.inviteExpiresAt, locale) })}
                  {m.invitedBy ? interpolate(t.invitedByLabel, { name: m.invitedBy }) : ""}
                </span>
                <span className="ml-auto flex gap-2">
                  <Button type="button" variant="secondary" disabled={busyId === m.id} onClick={() => void handleResend(m)}>
                    {t.copyNewLink}
                  </Button>
                  <Button type="button" variant="destructive" disabled={busyId === m.id} onClick={() => void handleRevoke(m)}>
                    {t.revoke}
                  </Button>
                </span>
              </div>
              {freshLink?.id === m.id ? (
                <div className="mt-3">
                  <OneTimeLink link={freshLink.link} expiresAt={freshLink.expiresAt} t={t} locale={locale} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {rowError ? (
        <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {rowError}
        </p>
      ) : null}
    </div>
  );
}
