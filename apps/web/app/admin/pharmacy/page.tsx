// /admin/pharmacy (ADV-22) — pharmacist verification queue.
// Locked-add-on page: while module.pharmacy is OFF this renders the
// lock panel; the queue mounts only when on. Every API behind it
// re-checks orders.view/orders.edit + the flag.
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { isPackEnabled } from "@/business-modules/packs";
import { RxQueuePanel } from "./rx-queue-panel";
import { pick } from "@/i18n/locale";
import { getRequestLocale } from "@/i18n/server";
import { PHARMACY_STRINGS } from "./strings";

export const dynamic = "force-dynamic";

export default async function PharmacyQueuePage() {
  const s = pick(await getRequestLocale(), PHARMACY_STRINGS);
  await ensureDbFeatureFlags();
  const enabled = isPackEnabled("pharmacy");
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-extrabold text-slate-900">{s.title}</h1>
      <p className="mt-1 text-sm text-slate-500">{s.description}</p>
      {enabled ? (
        <RxQueuePanel />
      ) : (
        <div className="mt-6 rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200">
          <p className="text-4xl" aria-hidden>
            🔒
          </p>
          <h2 className="mt-3 text-lg font-bold text-slate-900">{s.lockedTitle}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            {s.lockedPrefix}{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px]">module.pharmacy</code>{" "}
            {s.lockedSuffix}
          </p>
        </div>
      )}
    </div>
  );
}
