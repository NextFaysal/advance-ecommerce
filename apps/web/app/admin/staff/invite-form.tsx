"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
const ROLE_OPTIONS = [
  { value: "Manager", label: "Manager — ম্যানেজার" },
  { value: "Order Processor", label: "Order Processor — অর্ডার প্রসেসর" },
  { value: "Inventory", label: "Inventory — ইনভেন্টরি" },
  { value: "Support", label: "Support — সাপোর্ট" },
  { value: "Accountant", label: "Accountant — হিসাবরক্ষক" },
  { value: "Content Editor", label: "Content Editor — কন্টেন্ট এডিটর" },
];

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

function formatBnDate(iso: string | null): string {
  if (iso === null) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
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

function OneTimeLink({ link, expiresAt }: { link: string; expiresAt?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div role="status" className="rounded-md bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
      <p className="font-medium">আমন্ত্রণ তৈরি হয়েছে। নিচের লিংকটি কপি করে নিজে শেয়ার করুন।</p>
      <p className="mt-1 text-xs">
        কোনো ইমেইল পাঠানো হয়নি — লিংকটি শুধু এই একবারই দেখানো হচ্ছে (সার্ভারে শুধু এর হ্যাশ থাকে)।
        {expiresAt ? ` মেয়াদ: ${formatBnDate(expiresAt)} পর্যন্ত।` : ""}
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          className="h-10 min-w-0 flex-1 rounded-lg border border-emerald-200 bg-white px-3 font-mono text-xs text-text-main"
          aria-label="আমন্ত্রণ লিংক"
        />
        <Button
          type="button"
          variant="secondary"
          onClick={async () => {
            setCopied(await copyText(link));
          }}
        >
          {copied ? "কপি হয়েছে ✓" : "লিংক কপি করুন"}
        </Button>
      </div>
    </div>
  );
}

export function InviteForm() {
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
      setError("ইমেইল বা ফোন — যেকোনো একটি দিতেই হবে।");
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
        setError(json?.error?.message ?? "আমন্ত্রণ তৈরি করা যায়নি। আবার চেষ্টা করুন।");
        setSubmitting(false);
        return;
      }
      setIssued({ link: json.data.invite.link, expiresAt: json.data.invite.expiresAt });
      setName("");
      setEmail("");
      setPhone("");
      setRefreshKey((k) => k + 1);
    } catch {
      setError("সার্ভারে সংযোগ করা যায়নি। আবার চেষ্টা করুন।");
    }
    setSubmitting(false);
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-3">
        <Input
          name="invite-name"
          label="নাম (Name)"
          placeholder="নতুন স্টাফের নাম"
          autoComplete="off"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Input
          name="invite-email"
          label="ইমেইল (Email)"
          placeholder="staff@your-shop.com"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          name="invite-phone"
          label="ফোন (Phone)"
          placeholder="01XXXXXXXXX"
          type="tel"
          autoComplete="off"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <Combobox label="ভূমিকা (Role)" options={ROLE_OPTIONS} value={role} onChange={setRole} placeholder="ভূমিকা খুঁজুন…" />
        <div className="sm:col-span-2">
          <Button type="submit" variant="secondary" disabled={submitting}>
            {submitting ? "অপেক্ষা করুন…" : "আমন্ত্রণ তৈরি করুন"}
          </Button>
          <p className="mt-2 text-xs text-text-muted">
            ইমেইল বা ফোন — যেকোনো একটি দিলেই হবে। আমন্ত্রিত স্টাফ লিংক খুলে নিজে পাসওয়ার্ড সেট করবেন —
            এখানে কোনো পাসওয়ার্ড তৈরি বা দেখানো হয় না। আমন্ত্রণে কোনো ইমেইল যায় না; তৈরি হওয়া
            লিংকটি আপনাকে নিজে শেয়ার করতে হবে।
          </p>
        </div>
        {error ? (
          <p role="alert" className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-3">
            {error}
          </p>
        ) : null}
        {issued ? (
          <div className="sm:col-span-3">
            <OneTimeLink link={issued.link} expiresAt={issued.expiresAt} />
          </div>
        ) : null}
      </form>
      <PendingInvites refreshKey={refreshKey} />
    </div>
  );
}

export function PendingInvites({ refreshKey = 0 }: { refreshKey?: number }) {
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
        setLoadError(json?.error?.message ?? "তালিকা লোড করা যায়নি।");
        setMembers([]);
        return;
      }
      setMembers(json.data.staff.filter((m) => m.invitePending));
    } catch {
      setLoadError("সার্ভারে সংযোগ করা যায়নি।");
      setMembers([]);
    }
  }, []);

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
        setRowError(json?.error?.message ?? "নতুন লিংক তৈরি করা যায়নি।");
      } else {
        setFreshLink({ id: member.id, link: json.data.invite.link, expiresAt: json.data.invite.expiresAt });
        await copyText(json.data.invite.link);
        setReload((k) => k + 1);
      }
    } catch {
      setRowError("সার্ভারে সংযোগ করা যায়নি।");
    }
    setBusyId(null);
  }

  async function handleRevoke(member: PendingMember) {
    if (!window.confirm(`"${member.name}"-এর আমন্ত্রণ বাতিল করবেন? লিংকটি সাথে সাথে অকার্যকর হয়ে যাবে।`)) return;
    setRowError(null);
    setBusyId(member.id);
    try {
      const res = await fetch(`/api/v1/admin/staff/${member.id}/revoke-invite`, { method: "POST" });
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!res.ok) {
        setRowError(json?.error?.message ?? "আমন্ত্রণ বাতিল করা যায়নি।");
      } else {
        setReload((k) => k + 1);
      }
    } catch {
      setRowError("সার্ভারে সংযোগ করা যায়নি।");
    }
    setBusyId(null);
  }

  return (
    <div className="mt-8">
      <h3 className="text-base font-semibold text-text-main">অপেক্ষমাণ আমন্ত্রণ</h3>
      <p className="mt-1 text-xs text-text-muted">
        আগের লিংক আবার দেখা যায় না (শুধু হ্যাশ সংরক্ষিত) — "নতুন লিংক কপি করুন" চাপলে নতুন লিংক তৈরি হয়ে
        কপি হবে এবং আগের লিংক বাতিল হয়ে যাবে।
      </p>
      {loadError ? (
        <p role="alert" className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {loadError}
        </p>
      ) : null}
      {members === null ? (
        <p className="mt-3 text-sm text-text-muted">লোড হচ্ছে…</p>
      ) : members.length === 0 ? (
        <p className="mt-3 rounded-md bg-surface-2 px-3 py-2 text-sm text-text-muted">
          কোনো অপেক্ষমাণ আমন্ত্রণ নেই।
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
          {members.map((m) => (
            <li key={m.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-medium text-text-main">{m.name}</span>
                <span className="font-mono text-xs text-text-muted">{m.email !== "" ? m.email : m.phone}</span>
                <Badge tone="brand">{m.role}</Badge>
                <Badge tone="warning">আমন্ত্রিত</Badge>
                <span className="text-xs text-text-muted">
                  মেয়াদ: {formatBnDate(m.inviteExpiresAt)}
                  {m.invitedBy ? ` · আমন্ত্রণকারী: ${m.invitedBy}` : ""}
                </span>
                <span className="ml-auto flex gap-2">
                  <Button type="button" variant="secondary" disabled={busyId === m.id} onClick={() => void handleResend(m)}>
                    নতুন লিংক কপি করুন
                  </Button>
                  <Button type="button" variant="destructive" disabled={busyId === m.id} onClick={() => void handleRevoke(m)}>
                    বাতিল করুন
                  </Button>
                </span>
              </div>
              {freshLink?.id === m.id ? (
                <div className="mt-3">
                  <OneTimeLink link={freshLink.link} expiresAt={freshLink.expiresAt} />
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
