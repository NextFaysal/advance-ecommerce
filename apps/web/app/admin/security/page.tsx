import { cookies } from "next/headers";
import { prisma } from "@advance-ecommerce/db";
import { PageHeader } from "@/components/ui/page-header";
import { hasUsableTotp, validateSessionToken } from "@/lib/auth";
import { PasskeyCard } from "@/components/admin/passkey-card";
import { SecurityAlertsCard } from "@/components/admin/security-alerts-card";
import { SecurityIpRulesCard } from "@/components/admin/security-ip-rules-card";
import { SecuritySessionsCard } from "@/components/admin/security-sessions-card";
import TotpEnrollCard from "./totp-enroll-card";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { SECURITY_STRINGS } from "./strings";

// Account + store security (ADV-28 core composition).
//
// Top: self-service TOTP 2FA enrolment for the signed-in staff member.
// The server side passes only serializable status props to the client
// card; the secret itself is fetched by the card from
// POST /api/v1/admin/auth/2fa/enroll (shown once) and never rendered
// from the server. Status uses hasUsableTotp: a legacy flag-without-
// secret row reports "বন্ধ আছে" and can enrol from here — never a trap.
//
// Below: three self-fetching client cards — IP allow/block rules,
// security alerts, and the active staff-session list with revoke.
// They are mounted with NO props at all: no function props cross the
// server→client boundary (the wave-31 RSC incident rule), each card
// loads its own data from its /api/v1/admin/security/* route.
export const dynamic = "force-dynamic";

export default async function AdminSecurityPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, SECURITY_STRINGS);
  const token = cookies().get("admin_session")?.value;
  const session = token ? await validateSessionToken(token) : null;

  if (!session) {
    return (
      <main>
        <PageHeader title={s.title} description={s.loginRequiredDesc} breadcrumb={s.breadcrumb} />
        <p role="status" className="text-sm text-text-muted">
          {s.loginRequired}
        </p>
      </main>
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true, phone: true, twoFactorEnabled: true, twoFactorSecret: true },
  });
  const totpEnabled = user ? hasUsableTotp(user) : false;
  const enrolmentPending = user !== null && user.twoFactorSecret !== null && !user.twoFactorEnabled;

  return (
    <main>
      <PageHeader
        title={s.title}
        description={s.description}
        breadcrumb={s.breadcrumb}
      />
      <div className="max-w-2xl">
        <TotpEnrollCard
          totpEnabled={totpEnabled}
          enrolmentPending={enrolmentPending}
          accountLabel={user?.email ?? user?.phone ?? session.user.id}
        />
      </div>
      <div className="mt-6 max-w-2xl">
        <PasskeyCard />
      </div>
      <div className="mt-6 grid max-w-5xl gap-6">
        <SecurityIpRulesCard />
        <SecurityAlertsCard />
        <SecuritySessionsCard />
      </div>
    </main>
  );
}
