"use client";

import { useEffect, useState } from "react";

/**
 * ShellIdentity — the signed-in staff member's real name, role and
 * avatar initials for the admin shell (doc 35 wave 3).
 *
 * Replaces the hardcoded gradient "N" / "Admin / session active"
 * dressing the Sidebar and Topbar used to render for every user.
 * Identity comes from the same who-am-I endpoint the table-prefs
 * module already uses (GET /api/v1/admin/auth/session — display-safe
 * fields of the caller's OWN session only), fetched once per page
 * load behind a module-level promise cache, exactly like
 * fetchStaffUserId in src/admin/table-prefs.tsx.
 *
 * Honesty rules: nothing name-like renders before the fetch resolves
 * (a muted placeholder dot, no letter), and on failure the chip falls
 * back to the caller's generic labels (the strings the shell passes
 * in) — a name is never invented. The avatar is the SOLID brand token:
 * the brand gradient is reserved for hero / primary CTA / logo mark
 * (doc 35 brand exception, see Sidebar).
 */

interface StaffIdentity {
  name: string;
  email: string;
  role: string | null;
}

let identityPromise: Promise<StaffIdentity | null> | null = null;

function fetchStaffIdentity(): Promise<StaffIdentity | null> {
  if (!identityPromise) {
    identityPromise = fetch("/api/v1/admin/auth/session")
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json().catch(() => null)) as
          | { data?: { user?: { name?: string; email?: string; role?: string | null } } }
          | null;
        const u = body?.data?.user;
        if (!u || typeof u.email !== "string") return null;
        return {
          name: typeof u.name === "string" ? u.name : "",
          email: u.email,
          role: typeof u.role === "string" ? u.role : null,
        };
      })
      .catch(() => null);
  }
  return identityPromise;
}

function useStaffIdentity(): StaffIdentity | null | undefined {
  const [identity, setIdentity] = useState<StaffIdentity | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void fetchStaffIdentity().then((id) => {
      if (alive) setIdentity(id);
    });
    return () => {
      alive = false;
    };
  }, []);
  return identity;
}

function initialsOf(identity: StaffIdentity): string {
  const source = identity.name.trim() || identity.email.split("@")[0] || "";
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function ShellIdentity({
  variant,
  fallbackName,
  fallbackDetail,
  avatarLabel,
}: {
  /** "full" renders avatar + name + detail (sidebar footer);
   *  "avatar" renders the avatar alone (topbar). */
  variant: "full" | "avatar";
  /** Generic labels used only when the identity fetch fails. */
  fallbackName: string;
  fallbackDetail: string;
  avatarLabel: string;
}) {
  const identity = useStaffIdentity();
  const loading = identity === undefined;
  const displayName = identity ? identity.name.trim() || identity.email : fallbackName;
  const detail = identity ? identity.role || fallbackDetail : fallbackDetail;
  const initials = identity ? initialsOf(identity) : "";

  const avatar = (
    <span
      aria-hidden={variant === "avatar" ? undefined : true}
      aria-label={variant === "avatar" ? avatarLabel : undefined}
      title={variant === "avatar" && identity ? displayName : undefined}
      className={`flex shrink-0 items-center justify-center rounded-full bg-brand font-bold text-white ring-2 ring-brand-100 ${
        variant === "avatar" ? "h-10 w-10" : "h-9 w-9 text-sm"
      }`}
    >
      {loading ? <span aria-hidden="true" className="h-2 w-2 rounded-full bg-white/50" /> : initials}
    </span>
  );

  if (variant === "avatar") return avatar;

  return (
    <>
      {avatar}
      <span className="min-w-0 group-data-[collapsed=true]/sidebar:hidden">
        <span className="block truncate text-small font-semibold">
          {loading ? fallbackName : displayName}
        </span>
        <span className="block truncate text-caption text-text-muted">{detail}</span>
      </span>
    </>
  );
}
