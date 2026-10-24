"use client";

/**
 * ConsentBanner — Agent 26.
 * Bangla-first tracking consent banner. Shows ONLY while no choice is
 * stored (consent state "unknown"); answering stores the choice via
 * ../client/consent-storage (which notifies the pixel client: grant ->
 * queued events flush, deny -> queued events are discarded) and hides
 * the banner. It also hides/shows live if the choice changes in another
 * tab (subscribeConsent). Mount it once, next to <TrackingProvider />.
 */
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
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
      aria-label="ট্র্যাকিং সম্মতি"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-card px-4 py-4 shadow-lg sm:px-6"
    >
      <div className="mx-auto flex max-w-[1440px] flex-col gap-3 md:flex-row md:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-main">আপনার গোপনীয়তা</p>
          <p className="mt-1 text-sm leading-relaxed text-text-muted">
            আপনার কেনাকাটার অভিজ্ঞতা ভালো করতে এবং বিজ্ঞাপনের ফলাফল মাপতে আমরা কুকি ও
            ট্র্যাকিং ব্যবহার করতে চাই। সম্মতি দিলে কেবল হ্যাশ করা তথ্য পাঠানো হয় —
            আপনার ফোন নম্বর বা ইমেইল কখনো সরাসরি পাঠানো হয় না। বিস্তারিত জানতে{" "}
            <a href={privacyHref} className="font-medium text-brand-700 underline">
              গোপনীয়তা নীতি
            </a>{" "}
            দেখুন।
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="outline" onClick={() => decide("denied")}>
            না, ধন্যবাদ
          </Button>
          <Button type="button" variant="primary" onClick={() => decide("granted")}>
            সম্মতি দিচ্ছি
          </Button>
        </div>
      </div>
    </div>
  );
}
