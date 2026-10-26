/**
 * Subscription-boxes module flag — ADV-23 vertical 4 (doc 22/23,
 * wave 56).
 *
 * Boxes are a LAYER on the wave-51 subscription engine, not a second
 * engine: a box subscription is an ordinary Subscription row whose
 * variant is listed in boxes.config.boxVariantIds. Two flags
 * therefore gate the surface, deliberately:
 *
 *   module.subscriptions       — the ENGINE (create route + worker
 *                                sweep). Wave 51's; unchanged.
 *   module.subscription_boxes — THIS flag: the box layer only (PDP
 *                                box section, admin boxes page,
 *                                cycle-contents requirement at
 *                                generation, box discount).
 *
 * Why not the boxes flag alone: processDueSubscriptions returns
 * early while module.subscriptions is OFF and the create route 403s
 * — box rows created under a standalone boxes flag could never
 * generate. Why not the engine flag alone: the box layer is a
 * separately priced add-on (doc 22); with this flag OFF a listed
 * box variant simply behaves as an ordinary subscription product
 * (its cycles ship the box variant itself, wave-51 semantics), and
 * flipping the flag ON is what turns contents-gating on — there is
 * no state in which a subscription silently changes meaning.
 *
 * The flag DEFINITION is registered centrally by the parent in BOTH
 * src/lib/feature-flags.ts (FEATURE_FLAG_DEFINITIONS) and
 * packages/db/prisma/seed.ts (FEATURE_FLAGS), descriptions
 * identical:
 *
 *   { key: "module.subscription_boxes", description: "Subscription boxes: curated recurring boxes with per-cycle rotating contents on the subscription engine (v2 add-on, ADV-23)" }
 *
 * Until that registration lands, isFeatureEnabled() returns false —
 * the layer fails CLOSED, the correct pre-launch state.
 */
import { isFeatureEnabled } from "@/lib/feature-flags";

export const SUBSCRIPTION_BOXES_FLAG = "module.subscription_boxes";

export function subscriptionBoxesEnabled(): boolean {
  return isFeatureEnabled(SUBSCRIPTION_BOXES_FLAG);
}
