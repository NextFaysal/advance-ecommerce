/**
 * AI Assist feature-flag store — Agent 45 (page-local), migrated to the
 * unified reader by Agent 60.
 *
 * The real flag is the DB `feature_flags` row `module.ai_assist`,
 * seeded OFF (paid add-on); the AI API routes check it server-side via
 * requireFeature() in src/ai/feature-flag.ts, fail-closed. This page
 * previously kept its own in-memory demo store; it now delegates to the
 * ONE unified flag store in src/lib/feature-flags.ts — the same store
 * the feature-flags API PATCHes — so a toggle in Admin > Settings >
 * Feature Flags is visible here in the same process. Defaults OFF: a
 * locked module renders the lock panel, never runs open.
 *
 * The AiAssistFlagStore interface is unchanged, so the page and any
 * test doubles keep working; the class below is now a thin adapter over
 * the unified reader rather than a private store. Do not change any
 * default to ON — paid add-on modules are unlocked per client.
 */
import { featureFlags } from "@/lib/feature-flags";
import { AI_FEATURE_FLAG } from "@/ai/types";

export type AiAssistFlagKey = typeof AI_FEATURE_FLAG;

export interface AiAssistFlagStore {
  isEnabled(key: AiAssistFlagKey): boolean;
  setEnabled(key: AiAssistFlagKey, enabled: boolean): void;
  list(): Record<AiAssistFlagKey, boolean>;
}

/** Adapter over the unified flag store (src/lib/feature-flags.ts). */
export class InMemoryAiAssistFlagStore implements AiAssistFlagStore {
  isEnabled(key: AiAssistFlagKey): boolean {
    return featureFlags.isFeatureEnabled(key);
  }

  setEnabled(key: AiAssistFlagKey, enabled: boolean): void {
    featureFlags.setFeatureEnabled(key, enabled);
  }

  list(): Record<AiAssistFlagKey, boolean> {
    return { [AI_FEATURE_FLAG]: featureFlags.isFeatureEnabled(AI_FEATURE_FLAG) };
  }
}

/** Shared demo instance used by the AI Assist admin page. */
export const demoAiAssistFlags: AiAssistFlagStore = new InMemoryAiAssistFlagStore();

export function isAiAssistEnabled(store: AiAssistFlagStore = demoAiAssistFlags): boolean {
  return store.isEnabled(AI_FEATURE_FLAG);
}
