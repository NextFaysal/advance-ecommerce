import Link from "next/link";
import { findPendingInviteByTokenHash } from "../../api/v1/admin/staff/store";
import { hashStaffInviteToken } from "../../api/v1/admin/staff/invite-token";
import { AcceptInviteForm } from "./accept-form";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { ACCEPT_INVITE_STRINGS } from "./strings";

// Accept a staff invite — PUBLIC page (middleware allows it, the admin
// layout renders it bare like login). The token from the link is looked
// up server-side by its SHA-256 hash: a live token renders the
// set-password form; anything else — unknown, expired, used, revoked,
// missing — renders ONE generic error state (no enumeration). The raw
// token is never logged.
export const dynamic = "force-dynamic";

function BrandPanel({ welcome, text }: { welcome: string; text: string }) {
  return (
    <aside className="brand-gradient relative hidden w-[44%] flex-col justify-between overflow-hidden p-10 text-white lg:flex">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/20 text-xl font-extrabold backdrop-blur">
          A
        </span>
        <span className="text-lg font-bold">Advance Ecommerce</span>
      </div>
      <div>
        <h2 className="max-w-md text-4xl font-extrabold leading-snug">{welcome}</h2>
        <p className="mt-4 max-w-md text-sm leading-relaxed text-white/85">{text}</p>
      </div>
      <p className="text-xs text-white/70">© 2026 Advance Ecommerce</p>
    </aside>
  );
}

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: { token?: string | string[] };
}) {
  const s = pick(await getRequestLocale(), ACCEPT_INVITE_STRINGS);
  const rawToken = Array.isArray(searchParams.token) ? searchParams.token[0] : searchParams.token;
  const invite =
    rawToken !== undefined && rawToken.length >= 32
      ? await findPendingInviteByTokenHash(hashStaffInviteToken(rawToken))
      : null;

  return (
    <main className="flex min-h-screen">
      <BrandPanel welcome={s.brandWelcome} text={s.brandText} />
      <section className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="brand-gradient flex h-10 w-10 items-center justify-center rounded-xl text-lg font-extrabold text-white">
              A
            </span>
            <span className="font-bold text-text-main">Advance Ecommerce</span>
          </div>
          <h1 className="text-2xl font-bold text-text-main">{s.title}</h1>
          {invite !== null && rawToken !== undefined ? (
            <>
              <p className="mt-1 text-sm text-text-muted">{s.subtitle}</p>
              <AcceptInviteForm
                token={rawToken}
                invitedName={invite.name}
                identifier={invite.email ?? invite.phone ?? ""}
                role={invite.role}
              />
            </>
          ) : (
            <>
              <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-600">
                {s.invalidLink}
              </p>
              <Link
                href="/admin/login"
                className="mt-6 block text-center text-sm font-medium text-brand-700 hover:underline"
              >
                {s.goToLogin}
              </Link>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
