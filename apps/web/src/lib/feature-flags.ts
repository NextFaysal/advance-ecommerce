/**
 * Unified feature-flag reader — Agent 60.
 *
 * THE single flag source for the web app. Before this module, every
 * module kept its own demo / page-local flag store (automation, fraud,
 * loyalty, POS, advanced-orders page, AI-assist page, the feature-flags
 * API store) and they could drift — Agent 46 had to sync two surfaces by
 * hand after `module.advanced_orders` was added to the seed. New flag
 * consumers MUST read through here; do not create another flag store.
 *
 * DB SWAP (landed): the reader is built by `createFeatureFlagReader`
 * over a `FeatureFlagSource`. The shared source below delegates to an
 * in-memory source until the DB source (src/lib/feature-flags-db.ts —
 * Prisma-backed, installed at server start via instrumentation and by
 * the feature-flags API store) is installed through
 * `installFeatureFlagSource(...)`. No consumer changes: every consumer
 * calls the reader functions, never a source directly. Enabled state
 * persists in the FeatureFlag table; the seed is the catalogue truth
 * (20 keys, all OFF by default).
 *
 * CATALOGUE: FEATURE_FLAG_DEFINITIONS mirrors FEATURE_FLAGS in
 * packages/db/prisma/seed.ts EXACTLY (20 keys, descriptions verbatim) —
 * the seed is the source of truth. A smoke test (Agent 60) parses the
 * seed file text and asserts the key sets match. If a flag is added to
 * the seed, add it here too (and re-run that check); flags default OFF
 * everywhere — paid add-ons are unlocked per client install, never
 * globally.
 *
 * Migrated consumers (Agent 60):
 *  - app/api/v1/admin/feature-flags/store.ts (the flags API demo store;
 *    its PATCH writes go through this module's store, so a flip is
 *    visible to every migrated consumer in the same process)
 *  - app/admin/advanced-orders/flags.ts (page gate)
 *  - app/admin/ai-assist/demo-flag.ts (page gate)
 *
 * Migration COMPLETE (Agent 62, 2026-10-24): every module flag store
 * (automation, fraud, loyalty, pos, b2b, callcenter, inbox, reseller,
 * riders, vendors, business packs, src/ai requireFeature) is now a thin
 * adapter over this reader. No module keeps its own enabled-state.
 */

export interface FeatureFlagDefinition {
  key: string;
  description: string;
}

export interface FeatureFlagRecord extends FeatureFlagDefinition {
  enabled: boolean;
}

/** Mirrors FEATURE_FLAGS in packages/db/prisma/seed.ts — keep in sync (see header). */
export const FEATURE_FLAG_DEFINITIONS = [
  { key: "module.reseller", description: "Reseller panel (v2 add-on)" },
  { key: "module.reseller_portal", description: "Reseller self-service portal (v2 add-on, ADV-12)" },
  { key: "module.call_center", description: "Call center (v2 add-on)" },
  { key: "module.call_center_automation", description: "Call center follow-up automation — auto SMS + retry backoff (v2 add-on)" },
  { key: "module.pos", description: "POS (v2 add-on)" },
  { key: "module.multi_vendor", description: "Multi-vendor (v2 add-on)" },
  { key: "module.vendor_portal", description: "Vendor self-service portal (v2 add-on, ADV-13)" },
  { key: "module.automation", description: "Automation engine (v2 add-on)" },
  { key: "module.fraud_scoring", description: "Fraud / risk scoring (v2 add-on)" },
  { key: "module.rider", description: "Own rider management (v2 add-on)" },
  { key: "module.f_commerce", description: "F-commerce inbox (v2 add-on)" },
  { key: "module.ai_assist", description: "AI assist (v2 add-on)" },
  { key: "module.advanced_analytics", description: "Advanced analytics (v2 add-on)" },
  { key: "module.b2b", description: "B2B / wholesale (v2 add-on)" },
  { key: "module.b2b_portal", description: "B2B buyer portal (v2 add-on, ADV-14)" },
  { key: "module.marketing_mechanics", description: "Marketing mechanics: gift cards, membership tiers, spin wheel, A/B tests, bundle builder, EMI display, WhatsApp broadcast (v2 add-on, ADV-18)" },
  { key: "module.subscriptions", description: "Customer subscriptions / auto-replenish (v2 add-on, ADV-18)" },
  { key: "module.fashion", description: "Fashion pack (v2 add-on)" },
  { key: "module.electronics", description: "Electronics pack (v2 add-on)" },
  { key: "module.grocery", description: "Grocery pack (v2 add-on)" },
  { key: "module.pharmacy", description: "Pharmacy pack (v2 add-on)" },
  { key: "module.digital_goods", description: "Digital goods pack (v2 add-on)" },
  { key: "module.erp_lite", description: "ERP-lite accounting (v2 add-on)" },
  { key: "module.loyalty", description: "Loyalty, referral & affiliate (v2 add-on)" },
  { key: "module.advanced_orders", description: "Advanced orders: split, partial, exchange, pre-order (v2 add-on)" },
  { key: "module.product_types", description: "Product types: digital, bundle & pre-order products (v2 add-on)" },
  { key: "module.sourcing", description: "Sourcing import + landed-cost calculator (v2 add-on)" },
  { key: "module.product_extras", description: "Product extras: 360° view + barcode labels (v2 add-on)" },
  { key: "module.inventory_depth", description: "Inventory depth: batch/expiry, serial/IMEI, ABC + dead-stock, auto-reorder (v2 add-on, ADV-20)" },
  { key: "module.warehouse_ops", description: "Warehouse ops: pick, pack & ship scanning (v2 add-on, ADV-21)" },
  { key: "module.social_proof", description: "Social proof — honest variants only: real recent-orders ticker + real low-stock lines (v2 add-on, P11)" },
  { key: "module.restaurant", description: "Restaurant + kitchen display (KDS): dine-in tables & takeaway tickets (v2 add-on, ADV-23)" },
  { key: "module.services", description: "Services + appointment booking: bookable service variants, slot calendar + bookings board (v2 add-on, ADV-23)" },
  { key: "module.rental", description: "Rental: rentable variants, date-range booking with stock-overlap availability + security deposit (v2 add-on, ADV-23)" },
  { key: "module.subscription_boxes", description: "Subscription boxes: curated recurring boxes with per-cycle rotating contents on the subscription engine (v2 add-on, ADV-23)" },
  { key: "module.print_on_demand", description: "Print-on-demand: custom print text + colour on listed variants, per-item print fee, admin print queue (v2 add-on, ADV-23)" },
] as const satisfies readonly FeatureFlagDefinition[];

export type FeatureFlagKey = (typeof FEATURE_FLAG_DEFINITIONS)[number]["key"];

/**
 * Storage seam behind the reader. The DB implementation replaces the
 * in-memory one at this interface only (see header).
 */
export interface FeatureFlagSource {
  isKnown(key: string): boolean;
  isEnabled(key: string): boolean;
  getFlag(key: string): FeatureFlagRecord | null;
  listFlags(): FeatureFlagRecord[];
  setEnabled(key: string, enabled: boolean): void;
}

/** In-memory demo source: catalogue fixed at construction, all flags OFF. */
export class InMemoryFeatureFlagSource implements FeatureFlagSource {
  private readonly definitions: readonly FeatureFlagDefinition[];
  private readonly enabledState: Map<string, boolean>;

  constructor(definitions: readonly FeatureFlagDefinition[] = FEATURE_FLAG_DEFINITIONS) {
    this.definitions = definitions;
    this.enabledState = new Map(definitions.map((f) => [f.key, false]));
  }

  isKnown(key: string): boolean {
    return this.enabledState.has(key);
  }

  /** Unknown keys are OFF — a locked/unknown module never runs open. */
  isEnabled(key: string): boolean {
    return this.enabledState.get(key) ?? false;
  }

  getFlag(key: string): FeatureFlagRecord | null {
    const definition = this.definitions.find((f) => f.key === key);
    if (!definition) return null;
    return { ...definition, enabled: this.isEnabled(key) };
  }

  listFlags(): FeatureFlagRecord[] {
    return this.definitions.map((f) => ({ ...f, enabled: this.isEnabled(f.key) }));
  }

  setEnabled(key: string, enabled: boolean): void {
    this.enabledState.set(key, enabled);
  }
}

export interface FeatureFlagReader {
  isFeatureEnabled(key: string): boolean;
  getFeatureFlag(key: string): FeatureFlagRecord | null;
  isKnownFlag(key: string): boolean;
  listFeatureFlags(): FeatureFlagRecord[];
  setFeatureEnabled(key: string, enabled: boolean): void;
}

export function createFeatureFlagReader(source: FeatureFlagSource): FeatureFlagReader {
  return {
    isFeatureEnabled: (key) => source.isEnabled(key),
    getFeatureFlag: (key) => source.getFlag(key),
    isKnownFlag: (key) => source.isKnown(key),
    listFeatureFlags: () => source.listFlags(),
    setFeatureEnabled: (key, enabled) => source.setEnabled(key, enabled),
  };
}

/**
 * The shared flag source behind the default reader. Delegates to an
 * in-memory source (all OFF — fail-closed) until a persistent source is
 * installed via installFeatureFlagSource(); after installation every
 * read/write goes to the installed source. This indirection is what
 * lets the Prisma-backed source live in a server-only module
 * (feature-flags-db.ts) without this module — imported by client-safe
 * adapters — ever importing Prisma.
 */
export class SharedFeatureFlagSource implements FeatureFlagSource {
  private fallback: FeatureFlagSource = new InMemoryFeatureFlagSource();
  private installed: FeatureFlagSource | null = null;

  install(source: FeatureFlagSource): void {
    this.installed = source;
  }

  get isInstalled(): boolean {
    return this.installed !== null;
  }

  private get active(): FeatureFlagSource {
    return this.installed ?? this.fallback;
  }

  isKnown(key: string): boolean {
    return this.active.isKnown(key);
  }
  isEnabled(key: string): boolean {
    return this.active.isEnabled(key);
  }
  getFlag(key: string): FeatureFlagRecord | null {
    return this.active.getFlag(key);
  }
  listFlags(): FeatureFlagRecord[] {
    return this.active.listFlags();
  }
  setEnabled(key: string, enabled: boolean): void {
    this.active.setEnabled(key, enabled);
  }
}

export const sharedFeatureFlagSource = new SharedFeatureFlagSource();

/** Installs the persistent (DB) source behind the shared reader. */
export function installFeatureFlagSource(source: FeatureFlagSource): void {
  sharedFeatureFlagSource.install(source);
}

/**
 * Back-compat alias: before the DB swap this WAS the in-memory demo
 * source; it now names the shared delegating source, so existing
 * imports keep reading/writing the one app-wide flag state.
 */
export const demoFeatureFlagSource: FeatureFlagSource = sharedFeatureFlagSource;

/** Default reader over the shared source; the DB source is installed
 *  behind it (see header), never by changing these calls. */
export const featureFlags: FeatureFlagReader = createFeatureFlagReader(sharedFeatureFlagSource);

export function isFeatureEnabled(key: string): boolean {
  return featureFlags.isFeatureEnabled(key);
}

export function getFeatureFlag(key: string): FeatureFlagRecord | null {
  return featureFlags.getFeatureFlag(key);
}
