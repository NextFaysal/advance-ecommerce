// Live-mode guard — Agent 9.
// Sandbox adapters must NEVER run in live mode, and live mode must NEVER
// be enabled from a settings value alone: it requires a verified credential
// reference (configured === true, i.e. a credential row exists in Settings).
// The credential VALUE is never inspected, logged, or returned here — only
// the boolean that a row exists, as provided by getIntegrationStatus().
import type { ProviderConfig } from "../types";

export class LiveModeBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveModeBlockedError";
  }
}

/** Throw if a sandbox adapter is asked to run outside sandbox mode. */
export function assertSandboxMode(config: ProviderConfig): void {
  if (config.mode !== "sandbox") {
    throw new LiveModeBlockedError(
      `Sandbox adapter for ${config.provider} refuses to run in mode "${config.mode}". Use the real provider adapter.`,
    );
  }
  if (!config.enabled) {
    throw new LiveModeBlockedError(`Provider ${config.provider} is disabled in settings.`);
  }
}

/**
 * Server-side guard for enabling live mode in settings:
 * configured must be true (a credential row exists). This function does
 * NOT verify that the credential is valid — that is the test-connection
 * step of the real provider adapter, which must run before live is enabled.
 */
export function canEnableLive(configured: boolean, credentialRef: string | null): boolean {
  return configured && credentialRef !== null && credentialRef !== "";
}

/** Client/UI guard message for the settings pages. */
export function liveModeGuardMessage(configured: boolean, credentialRef: string | null): string | null {
  if (canEnableLive(configured, credentialRef)) return null;
  return "Live mode requires a verified credential reference in Settings. Save a credential reference first, then test the connection.";
}
