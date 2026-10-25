import { PageHeader } from "@/components/ui/page-header";
import { demoCallCenterFlags, isCallCenterEnabled } from "@/callcenter/flags";
import { ensureDbFeatureFlags } from "@/lib/feature-flags-db";
import { listEffectiveScripts } from "@/callcenter/scripts-store";
import { CallCenterTabs } from "../tabs";
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
  await ensureDbFeatureFlags();
  if (!isCallCenterEnabled(demoCallCenterFlags)) {
    return (
      <main>
        <PageHeader title="কল স্ক্রিপ্ট" description="Call Scripts (module.call_center)" breadcrumb="Admin / Call Center" />
        <p role="status">
          🔒 এই মডিউলটি এই ইনস্টলে লক করা আছে। Call Center একটি পেইড অ্যাড-অন —
          খুলতে Admin &gt; Settings থেকে <code>module.call_center</code> ফিচার ফ্ল্যাগ চালু করুন।
          (This module is locked — enable the <code>module.call_center</code> feature flag to unlock it.)
        </p>
      </main>
    );
  }

  let scripts: ScriptSourceData[] | null = null;
  try {
    const effective = await listEffectiveScripts();
    scripts = effective.map((s) => ({
      source: s.source,
      version: s.version,
      versionLabel: s.versionLabel,
      isDefault: s.isDefault,
      steps: s.steps.map((st) => ({ key: st.key, promptBn: st.promptBn, promptEn: st.promptEn ?? "" })),
      updatedAt: s.updatedAt ?? null,
    }));
  } catch {
    scripts = null;
  }

  return (
    <main>
      <PageHeader
        title="কল স্ক্রিপ্ট"
        description="প্রতিটি টাস্কের ধরন অনুযায়ী এজেন্টের বলার স্ক্রিপ্ট। সেভ করলে সংস্করণ বাড়ে (বিল্ট-ইন = v1); কল লগে কোন সংস্করণ ব্যবহার হয়েছে তা ছাপ থাকে। (Call Scripts — per-source, versioned)"
        breadcrumb="Admin / Call Center"
      />
      <CallCenterTabs active="scripts" />
      {scripts === null ? (
        <p role="alert" className="rounded-md bg-rose-50 px-3.5 py-2.5 text-small leading-relaxed text-rose-700">
          ডাটাবেস থেকে স্ক্রিপ্ট পড়া যায়নি — কোনো স্ক্রিপ্ট দেখানো হচ্ছে না। (Could not
          read scripts from the database; nothing is shown.)
        </p>
      ) : (
        <ScriptsEditor initialScripts={scripts} />
      )}
    </main>
  );
}
