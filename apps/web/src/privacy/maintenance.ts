/**
 * Maintenance mode — server-side reader (ADV-29, doc 22). The pure
 * config/gate logic lives in maintenance-core.ts (edge-safe, shared
 * with middleware); this module adds the Settings-backed read.
 *
 * WHY the middleware polls a route instead of reading here: Next
 * middleware runs on the edge and cannot read the DB Settings store,
 * and this codebase has NO established settings-in-middleware
 * pattern (the existing middleware is cookie-presence only; feature
 * flags resolve through a server-side DB source). So middleware.ts
 * polls GET /api/v1/public/site-status (which uses this reader)
 * with a short in-isolate TTL cache and fails OPEN on any error.
 */
import { getSetting } from "@/lib/settings";
import {
  MAINTENANCE_SETTING_KEY,
  parseMaintenanceConfig,
  type MaintenanceConfig,
} from "./maintenance-core";

export * from "./maintenance-core";

/** Server-side read (route handlers, server components). Never throws. */
export async function getMaintenanceConfig(): Promise<MaintenanceConfig> {
  try {
    return parseMaintenanceConfig(await getSetting(MAINTENANCE_SETTING_KEY));
  } catch {
    return parseMaintenanceConfig(null);
  }
}
