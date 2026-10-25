import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ALL_PACKS } from "@/business-modules/packs";
import { demoPackFlags } from "@/business-modules/types";
import { DOMAIN_EVENTS } from "@/extensibility/types";
import { demoAdapterRegistry } from "@/extensibility/registry";
import { Icon } from "@/components/ui/icon";
import { featureFlags } from "@/lib/feature-flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";

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

const ADAPTER_KIND_TEXT: Record<string, string> = {
  payment: "পেমেন্ট",
  courier: "কুরিয়ার",
  sms: "SMS",
  email: "ইমেইল",
  storage: "স্টোরেজ",
};

export default async function AdminModulesPage() {
  await ensureDbFeatureFlags();
  const flags = demoPackFlags.list();
  const packs = ALL_PACKS;
  const enabledCount = packs.filter((p) => flags[p.flagKey]).length;
  const erpEnabled = featureFlags.isFeatureEnabled("module.erp_lite");
  const adapters = demoAdapterRegistry.list();

  const packRows = packs.map((pack) => ({
    pack: (
      <span className="font-medium">
        {pack.nameBn} <span className="text-text-muted">({pack.nameEn})</span>
      </span>
    ),
    description: pack.description,
    flag: <code className="font-mono text-xs">{pack.flagKey}</code>,
    status: flags[pack.flagKey] ? (
      <Badge tone="success">✓ সক্রিয়</Badge>
    ) : (
      <Badge tone="neutral">লক করা</Badge>
    ),
  }));

  const adapterRows = adapters.map((a) => ({
    kind: ADAPTER_KIND_TEXT[a.kind] ?? a.kind,
    provider: a.displayName,
    key: <code className="font-mono text-xs">{a.providerKey}</code>,
    source: a.source === "core" ? "কোর" : `প্লাগইন: ${a.source}`,
    mode: a.sandbox ? <Badge tone="warning">স্যান্ডবক্স</Badge> : <Badge tone="success">লাইভ</Badge>,
  }));

  return (
    <main>
      <PageHeader
        title="মডিউলসমূহ (Modules)"
        description="ব্যবসার ধরন অনুযায়ী প্যাক ও এক্সটেনসিবিলিটি ক্যাটালগ। প্যাকের অবস্থা আসল feature_flags টেবিল থেকে পড়া হয় — লক করা প্যাক চালানো যায় না; চালু/বন্ধ করা হয় Feature Flags পেজ থেকে (এই পেজ শুধু দেখায়)।"
        breadcrumb="Admin / Modules"
      />

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="ব্যবসায়িক প্যাক" value={String(packs.length)} delta="Part C" icon={<Icon name="grid" size={22} />} />
        <StatCard label="সক্রিয় প্যাক" value={String(enabledCount)} delta="feature_flags টেবিল অনুযায়ী" icon={<Icon name="check" size={22} />} />
        <StatCard label="ডোমেইন ইভেন্ট" value={String(DOMAIN_EVENTS.length)} delta="হুক সাবস্ক্রিপশন" icon={<Icon name="sparkles" size={22} />} />
        <StatCard label="রেজিস্টার্ড অ্যাডাপ্টার" value={String(adapters.length)} delta="এই বিল্ডে রেজিস্ট্রি খালি" icon={<Icon name="settings" size={22} />} />
      </div>

      <h2 className="mb-3 text-lg font-semibold">ব্যবসায়িক প্যাক</h2>
      <DataTable
        caption="প্রতিটি প্যাক একটি config + validation বান্ডল — কোর কখনো ফোর্ক হয় না, প্যাক flag দিয়ে সক্রিয় হয়"
        columns={[
          { key: "pack", header: "প্যাক" },
          { key: "description", header: "বিবরণ" },
          { key: "flag", header: "ফিচার ফ্ল্যাগ" },
          { key: "status", header: "অবস্থা" },
        ]}
        rows={packRows}
      />

      <h2 className="mb-3 mt-8 text-lg font-semibold">ERP-lite হিসাবরক্ষণ</h2>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold">ERP-lite (হিসাব খাতা, জার্নাল, VAT)</h3>
            <p className="mt-1 max-w-xl text-sm text-text-muted">
              দ্বি-পক্ষীয় জার্নাল এন্ট্রি, খরচ ও সরবরাহকারী পেমেন্ট, VAT রিপোর্ট ও পিরিয়ড লক।
              ফ্ল্যাগ: <code className="font-mono text-xs">module.erp_lite</code> (seed-এ OFF — পেইড অ্যাড-অন)।
            </p>
          </div>
          {erpEnabled ? (
            <Badge tone="success">✓ সক্রিয় (feature_flags অনুযায়ী)</Badge>
          ) : (
            <Badge tone="neutral">লক করা (feature_flags অনুযায়ী)</Badge>
          )}
        </div>
        <div className="mt-4">
          <Link href="/admin/erp" className="text-sm font-medium text-brand-700 hover:underline">
            ERP-lite পেজ খুলুন →
          </Link>
        </div>
      </Card>

      <h2 className="mb-3 mt-8 text-lg font-semibold">এক্সটেনসিবিলিটি</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h3 className="text-base font-semibold">প্লাগইন ও হুক</h3>
          <p className="mt-1 text-sm text-text-muted">
            প্লাগইনরা ডোমেইন ইভেন্টে সাবস্ক্রাইব করে। একটি হুক ব্যর্থ হলেও মূল কাজ বা অন্য হুক আটকায় না।
            প্লাগইন কোড এই প্রসেসে চালানো হয় না — runtime sandboxing আলাদা ধাপ (docs/MODULES.md)।
          </p>
        </Card>
        <Card>
          <h3 className="text-base font-semibold">ওয়েবহুক</h3>
          <p className="mt-1 text-sm text-text-muted">
            আউটবাউন্ড ওয়েবহুক ডেলিভারি যায় <code className="font-mono text-xs">webhook-delivery</code> কিউ দিয়ে,
            HMAC স্বাক্ষরসহ। সাইনিং সিক্রেট শুধু Admin Settings-এ encrypted থাকে — এই পেজে কখনো দেখানো হয় না।
          </p>
        </Card>
        <Card>
          <h3 className="text-base font-semibold">API কী</h3>
          <p className="mt-1 text-sm text-text-muted">
            API কী শুধু হ্যাশ আকারে সংরক্ষিত হয়; পূর্ণ কী তৈরির সময় একবারই দেখা যায় এবং পরে কখনো
            পুনরুদ্ধার করা যায় না। নিরাপত্তার কারণে এই ক্যাটালগ পেজে কোনো কী বা হ্যাশ দেখানো হয় না।
          </p>
        </Card>
        <Card>
          <h3 className="text-base font-semibold">কাস্টম ফিল্ড</h3>
          <p className="mt-1 text-sm text-text-muted">
            পণ্য, অর্ডার, গ্রাহক ও ভ্যারিয়েন্টে মার্চেন্ট-সংজ্ঞায়িত অতিরিক্ত ফিল্ড। টাকার ফিল্ড সবসময়
            পূর্ণসংখ্যা পয়সা — float মান গ্রহণ করা হয় না।
          </p>
        </Card>
      </div>

      <h3 className="mb-3 mt-6 text-base font-semibold">ডোমেইন ইভেন্ট</h3>
      <div className="flex flex-wrap gap-2">
        {DOMAIN_EVENTS.map((event) => (
          <Badge key={event} tone="brand">
            <span className="font-mono">{event}</span>
          </Badge>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">অ্যাডাপ্টার রেজিস্ট্রি</h2>
      {adapters.length === 0 ? (
        <EmptyState
          title="কোনো অ্যাডাপ্টার রেজিস্টার হয়নি"
          description="এই বিল্ডে অ্যাডাপ্টার রেজিস্ট্রি খালি: boot ধাপে কোনো অ্যাডাপ্টার রেজিস্ট্রেশন wired নেই — পেমেন্ট/কুরিয়ার/SMS অ্যাডাপ্টারগুলো integrations লেয়ারে আলাদাভাবে চলে, এই রেজিস্ট্রিতে আসে না। রেজিস্ট্রি API প্রস্তুত; boot registration যুক্ত হলে এখানে তালিকা দেখা যাবে।"
        />
      ) : (
        <DataTable
          caption="রেজিস্টার্ড অ্যাডাপ্টার — কোর ও প্লাগইন প্রদত্ত"
          columns={[
            { key: "kind", header: "ধরন" },
            { key: "provider", header: "প্রোভাইডার" },
            { key: "key", header: "কী" },
            { key: "source", header: "উৎস" },
            { key: "mode", header: "মোড" },
          ]}
          rows={adapterRows}
        />
      )}
    </main>
  );
}
