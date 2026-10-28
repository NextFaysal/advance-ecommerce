import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ALL_PACKS } from "@/business-modules/packs";
import { WeightedSyncPanel } from "./weighted-sync-panel";
import { demoPackFlags } from "@/business-modules/types";
import { DOMAIN_EVENTS } from "@/extensibility/types";
import { demoAdapterRegistry } from "@/extensibility/registry";
import { Icon } from "@/components/ui/icon";
import { featureFlags } from "@/lib/feature-flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { getRequestLocale } from "@/i18n/server";
import { interpolate, pick } from "@/i18n/locale";
import { MODULES_STRINGS } from "./strings";

// Admin > Modules — catalogue view (flags wired to the DB, 2026-10-25).
// Packs are LISTED with their lock state, never hidden and never runnable
// while locked — same contract as GET /api/v1/admin/modules. Enabled
// state is the REAL feature_flags table state: demoPackFlags is an
// adapter over the unified flag reader, hydrated here from the DB via
// ensureDbFeatureFlags(). This page is READ-ONLY for flags — toggling
// happens in Admin > Settings > Feature Flags. No API keys, hashes, or
// webhook secrets are ever shown on this page — the extensibility
// section describes capabilities only.

export const dynamic = "force-dynamic";



export default async function AdminModulesPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, MODULES_STRINGS);
  const ADAPTER_KIND_TEXT: Record<string, string> = { payment: s.kindPayment, courier: s.kindCourier, sms: s.kindSms, email: s.kindEmail, storage: s.kindStorage };
  await ensureDbFeatureFlags();
  const flags = demoPackFlags.list();
  const packs = ALL_PACKS;
  const enabledCount = packs.filter((p) => flags[p.flagKey]).length;
  const erpEnabled = featureFlags.isFeatureEnabled("module.erp_lite");
  const adapters = demoAdapterRegistry.list();

  const packRows = packs.map((pack) => ({
    pack: (
      <span className="font-medium">
        {locale === "bn" ? pack.nameBn : pack.nameEn}
      </span>
    ),
    description: pack.description,
    flag: <code className="font-mono text-xs">{pack.flagKey}</code>,
    status: flags[pack.flagKey] ? (
      <Badge tone="success">{s.activeBadge}</Badge>
    ) : (
      <Badge tone="neutral">{s.lockedBadge}</Badge>
    ),
  }));

  const adapterRows = adapters.map((a) => ({
    kind: ADAPTER_KIND_TEXT[a.kind] ?? a.kind,
    provider: a.displayName,
    key: <code className="font-mono text-xs">{a.providerKey}</code>,
    source: a.source === "core" ? s.coreSource : interpolate(s.pluginSource, { source: a.source }),
    mode: a.sandbox ? <Badge tone="warning">{s.sandboxBadge}</Badge> : <Badge tone="success">{s.liveBadge}</Badge>,
  }));

  return (
    <main className="space-y-6">
      <PageHeader title={s.title} description={s.description} breadcrumb={s.breadcrumb} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={s.statPacks} value={String(packs.length)} delta={s.statPacksDelta} icon={<Icon name="grid" size={22} />} />
        <StatCard label={s.statActivePacks} value={String(enabledCount)} delta={s.statActiveDelta} icon={<Icon name="check" size={22} />} />
        <StatCard label={s.statEvents} value={String(DOMAIN_EVENTS.length)} delta={s.statEventsDelta} icon={<Icon name="sparkles" size={22} />} />
        <StatCard label={s.statAdapters} value={String(adapters.length)} delta={s.statAdaptersDelta} icon={<Icon name="settings" size={22} />} />
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-main">{s.packsTitle}</h2>
        <DataTable
        caption={s.packsCaption}
        columns={[
          { key: "pack", header: s.colPack },
          { key: "description", header: s.colDescription },
          { key: "flag", header: s.colFlag },
          { key: "status", header: s.colStatus },
        ]}
          rows={packRows}
        />
      </section>

      {flags["module.grocery"] ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-text-main">{s.groceryTitle}</h2>
          <Card>
            <WeightedSyncPanel />
          </Card>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-main">{s.erpTitle}</h2>
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-text-main">{s.erpCardTitle}</h3>
              <p className="mt-1 max-w-xl text-sm text-text-muted">
                {s.erpDesc}
              </p>
            </div>
            {erpEnabled ? (
              <Badge tone="success">{s.erpActive}</Badge>
            ) : (
              <Badge tone="neutral">{s.erpLocked}</Badge>
            )}
          </div>
          <div className="mt-4">
            <Link href="/admin/erp" className="text-sm font-medium text-brand-700 hover:underline">
              {s.erpOpen}
            </Link>
          </div>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-main">{s.extensibilityTitle}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <h3 className="text-base font-semibold text-text-main">{s.pluginsTitle}</h3>
            <p className="mt-1 text-sm text-text-muted">
              {s.pluginsDesc}
            </p>
          </Card>
          <Card>
            <h3 className="text-base font-semibold text-text-main">{s.webhooksTitle}</h3>
            <p className="mt-1 text-sm text-text-muted">
              {s.webhooksDesc}
            </p>
          </Card>
          <Card>
            <h3 className="text-base font-semibold text-text-main">{s.apiKeysTitle}</h3>
            <p className="mt-1 text-sm text-text-muted">
              {s.apiKeysDesc}
            </p>
          </Card>
          <Card>
            <h3 className="text-base font-semibold text-text-main">{s.customFieldsTitle}</h3>
            <p className="mt-1 text-sm text-text-muted">
              {s.customFieldsDesc}
            </p>
          </Card>
        </div>

        <h3 className="pt-2 text-base font-semibold text-text-main">{s.eventsTitle}</h3>
        <div className="flex flex-wrap gap-2">
          {DOMAIN_EVENTS.map((event) => (
            <Badge key={event} tone="brand">
              <span className="font-mono">{event}</span>
            </Badge>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-text-main">{s.adaptersTitle}</h2>
        {adapters.length === 0 ? (
          <EmptyState
            title={s.noAdaptersTitle}
            description={s.noAdaptersDesc}
          />
        ) : (
          <DataTable
            caption={s.adaptersCaption}
            columns={[
              { key: "kind", header: s.colKind },
              { key: "provider", header: s.colProvider },
              { key: "key", header: s.colKey },
              { key: "source", header: s.colSource },
              { key: "mode", header: s.colMode },
            ]}
            rows={adapterRows}
          />
        )}
      </section>
    </main>
  );
}
