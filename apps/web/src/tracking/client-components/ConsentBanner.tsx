"use client";

/**
 * ConsentBanner — Agent 26.
 * Tracking consent banner (copy switches with the doc-30 locale via
 * useLocale). Shows ONLY while no choice is stored (consent state
 * "unknown"); answering stores the choice via
 * ../client/consent-storage (which notifies the pixel client: grant ->
 * queued events flush, deny -> queued events are discarded) and hides
 * the banner. It also hides/shows live if the choice changes in another
 * tab (subscribeConsent). Mount it once, next to <TrackingProvider />.
 */
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { TRACKING_STRINGS } from "../strings";
import {
  readConsentState,
  subscribeConsent,
  writeConsentState,
  type StoredConsentState,
} from "../client/consent-storage";

export interface ConsentBannerProps {
  /**
   * Privacy-policy link target. PLACEHOLDER default — the main agent
   * should point this at the store's real privacy page when it exists.
   */
  privacyHref?: string;
  /** Called after the visitor answers (the choice is already stored). */
  onDecision?: (state: StoredConsentState) => void;
}

export function ConsentBanner({ privacyHref = "/privacy", onDecision }: ConsentBannerProps) {
  const [visible, setVisible] = useState(false);
  const { locale } = useLocale();
  const t = pick(locale, TRACKING_STRINGS);

  useEffect(() => {
    setVisible(readConsentState() === "unknown");
    return subscribeConsent((state) => {
      setVisible(state === "unknown");
    });
  }, []);

  if (!visible) return null;

  const decide = (state: StoredConsentState): void => {
    writeConsentState(state);
    onDecision?.(state);
    setVisible(false);
  };

  return (
    <div
      role="region"
      aria-label={t.consentAriaLabel}
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card px-4 py-4 shadow-lg sm:px-6"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-3 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-main">{t.consentTitle}</p>
          <p className="mt-1 text-sm leading-relaxed text-text-muted">
            {t.consentBodyBeforeLink}{" "}
            <a href={privacyHref} className="font-medium text-brand-700 underline">
              {t.consentPrivacyLink}
            </a>
            {t.consentBodyAfterLink ? <> {t.consentBodyAfterLink}</> : null}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" onClick={() => decide("denied")}>
            {t.consentDeny}
          </Button>
          <Button type="button" variant="primary" onClick={() => decide("granted")}>
            {t.consentGrant}
          </Button>
        </div>
      </div>
    </div>
  );
}
