import { PageHeader } from "@/components/ui/page-header";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { listEffectiveScripts } from "@/callcenter/scripts-store";
import { pick } from "@/i18n/locale";
import { getRequestLocale } from "@/i18n/server";
import { CallCenterTabs } from "../tabs";
import { CALL_CENTER_STRINGS } from "../strings";
import { ScriptsEditor, type ScriptSourceData } from "./scripts-editor";

// Call-center scripts editor — C3. Per-source scripts are versioned
// JSON docs in the Setting store (src/callcenter/scripts-store.ts);
// a source with nothing saved shows the built-in CONFIRMATION_SCRIPT
// as "v1 — built-in default", honestly labelled in the editor.
// Saving bumps the version; the version label is stamped on call
// logs when an agent records an outcome. Guarded by the module flag
// here and by orders.view / orders.update_status in the API.
export const dynamic = "force-dynamic";

export default async function AdminCallCenterScriptsPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, CALL_CENTER_STRINGS);
  await ensureDbFeatureFlags();
  if (!isCallCenterEnabled(demoCallCenterFlags)) {
    return (
      <main>
        <PageHeader title={s.scriptsTitle} description={s.scriptsDescShort} breadcrumb={s.breadcrumb} />
        <p role="status">
          {s.lockedA} <code>module.call_center</code> {s.lockedB}
        </p>
      </main>
    );
  }

  let scripts: ScriptSourceData[] | null = null;
  try {
    const effective = await listEffectiveScripts();
    scripts = effective.map((sc) => ({
      source: sc.source,
      version: sc.version,
      versionLabel: sc.versionLabel,
      isDefault: sc.isDefault,
      steps: sc.steps.map((st) => ({ key: st.key, promptBn: st.promptBn, promptEn: st.promptEn ?? "" })),
      updatedAt: sc.updatedAt ?? null,
    }));
  } catch {
    scripts = null;
  }

  return (
    <main>
      <PageHeader
        title={s.scriptsTitle}
        description={s.scriptsDescLong}
        breadcrumb={s.breadcrumb}
      />
      <CallCenterTabs active="scripts" />
      {scripts === null ? (
        <p role="alert" className="rounded-md bg-rose-50 px-3.5 py-2.5 text-small leading-relaxed text-rose-700">
          {s.scriptsReadError}
        </p>
      ) : (
        <ScriptsEditor initialScripts={scripts} />
      )}
    </main>
  );
}
