"use client";

/**
 * BarcodeScanner — camera barcode scanning for the warehouse UI
 * (doc 23 wave 54-1).
 *
 * Uses the browser's built-in BarcodeDetector API
 * (window.BarcodeDetector, Chromium/Android Chrome) over a
 * getUserMedia video stream — no npm dependency. Detection runs on
 * an interval while the camera view is open; the first decoded code
 * closes the camera and fires onScan exactly once.
 *
 * Honesty / fallback discipline:
 *  - BarcodeDetector missing (Firefox, older Safari, desktop without
 *    support) → the camera button never renders as a promise; the
 *    component shows the typed-code fallback with copy stating the
 *    browser does not support camera scanning.
 *  - Camera permission denied / no camera → an error line appears
 *    and the typed fallback stays usable.
 *  - The typed fallback is always available (prop can hide it where
 *    the host surface already has its own code input, e.g. ship scan).
 *
 * All camera tracks are stopped on close and on unmount. Props are
 * plain data + one callback — this component is rendered by other
 * CLIENT components only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";

/* Minimal local typings for the Shape Detection API — not in the
 * standard DOM lib for this TS version, so declare just the surface
 * used here instead of reaching for `any`. */
interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function getBarcodeDetectorCtor(): BarcodeDetectorCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

const bigBtn =
  "inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-lg font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const ghostBtn =
  "inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 text-base font-semibold text-text-main disabled:cursor-not-allowed disabled:opacity-50";

export function BarcodeScanner({
  onScan,
  typedFallback = true,
  typedPlaceholder,
  disabled = false,
}: {
  onScan: (code: string) => void;
  /** Hide the built-in typed input when the host already has one. */
  typedFallback?: boolean;
  typedPlaceholder?: string;
  disabled?: boolean;
}) {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  const effectivePlaceholder = typedPlaceholder ?? s.barcodePlaceholder;
  const [supported, setSupported] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firedRef = useRef(false);

  useEffect(() => {
    setSupported(getBarcodeDetectorCtor() !== null);
  }, []);

  const stopCamera = useCallback(() => {
    if (loopRef.current !== null) {
      clearInterval(loopRef.current);
      loopRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = useCallback(async () => {
    const Ctor = getBarcodeDetectorCtor();
    if (!Ctor) {
      setSupported(false);
      return;
    }
    setCameraError(null);
    firedRef.current = false;
    setOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      // The <video> mounts when `open` flips true — give React one
      // beat to commit it before wiring the stream up.
      let video = videoRef.current;
      if (!video) {
        await new Promise((r) => setTimeout(r, 100));
        video = videoRef.current;
      }
      if (!video) {
        stopCamera();
        setOpen(false);
        setCameraError(s.barcodeCameraError);
        return;
      }
      video.srcObject = stream;
      await video.play();
      const detector = new Ctor();
      loopRef.current = setInterval(() => {
        const v = videoRef.current;
        if (!v || firedRef.current || v.readyState < 2) return;
        void detector
          .detect(v)
          .then((codes) => {
            const code = codes.find((c) => c.rawValue.trim().length > 0)?.rawValue.trim();
            if (!code || firedRef.current) return;
            firedRef.current = true;
            stopCamera();
            setOpen(false);
            onScan(code);
          })
          .catch(() => {
            // A failed frame is not an error state — the next tick retries.
          });
      }, 300);
    } catch {
      stopCamera();
      setOpen(false);
      setCameraError(s.barcodeCameraDenied);
    }
  }, [onScan, stopCamera, s]);

  const closeCamera = useCallback(() => {
    stopCamera();
    setOpen(false);
  }, [stopCamera]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start gap-2">
        {supported ? (
          <button type="button" className={bigBtn} disabled={disabled || open} onClick={() => void startCamera()}>
            <Icon name="camera" size={22} />
            {s.barcodeCameraScan}
          </button>
        ) : null}
        {typedFallback ? (
          <form
            className="flex min-w-64 flex-1 gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const value = typed.trim();
              if (!value) return;
              setTyped("");
              onScan(value);
            }}
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={effectivePlaceholder}
              className="min-h-14 flex-1 rounded-xl border border-border bg-card px-4 font-mono text-lg"
              aria-label={s.barcodeInputLabel}
            />
            <button type="submit" className={ghostBtn} disabled={disabled || !typed.trim()}>
              {s.barcodeTick}
            </button>
          </form>
        ) : null}
      </div>

      {supported === false ? (
        <p className="text-sm text-text-muted">
          {s.barcodeUnsupported}
        </p>
      ) : null}
      {cameraError ? (
        <p role="alert" className="text-sm font-medium text-red-700">
          {cameraError}
        </p>
      ) : null}

      {open ? (
        <div className="space-y-2 rounded-2xl border border-border bg-card p-3">
          <video
            ref={videoRef}
            className="aspect-video w-full rounded-xl bg-black object-cover"
            playsInline
            muted
            aria-label={s.barcodeCameraLabel}
          />
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-text-muted">{s.barcodeHint}</p>
            <button type="button" className={ghostBtn} onClick={closeCamera}>
              {s.close}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
