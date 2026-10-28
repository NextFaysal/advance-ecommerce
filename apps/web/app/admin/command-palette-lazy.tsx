"use client";

/**
 * AdminCommandPaletteLazy — lazy ⌘K palette mount (admin perf
 * wave B1).
 *
 * The palette (src/admin/command-palette.tsx) renders nothing until
 * opened, but the layout used to mount it eagerly, so its code —
 * ADMIN_STRINGS, the nav config and the record-search machinery —
 * rode along in every admin page's First Load (~17–20 kB gz). Now
 * only this tiny shim is eager; the real palette is a next/dynamic
 * chunk that loads on the FIRST open trigger.
 *
 * First-press contract (must match the eager behaviour exactly):
 * the shim — not the palette — owns the global listeners until the
 * palette is mounted and listening:
 *   - ⌘K / Ctrl+K: the shim swallows the keydown (preventDefault,
 *     like the palette does, so the browser never steals the
 *     shortcut), starts the lazy mount, and the palette opens as
 *     soon as it mounts. A second ⌘K landing while the chunk is
 *     still loading flips the pending intent, preserving the
 *     palette's toggle semantics.
 *   - OPEN_COMMAND_PALETTE_EVENT (topbar trigger click): same —
 *     the shim starts the mount with open intent.
 * Once the palette signals ready, the shim's handlers stand down
 * permanently and the palette's own listeners own both triggers.
 *
 * The shim also forwards the layout's live off-feature-flag list to
 * the palette, so its page entries show the add-on chip only while
 * the module's flag is actually OFF (same state as the sidebar).
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

// Must stay equal to OPEN_COMMAND_PALETTE_EVENT in
// src/admin/command-palette.tsx. Duplicated as a literal on purpose:
// importing anything from the palette module here would pull the
// palette into the eager bundle this shim exists to keep it out of.
const OPEN_COMMAND_PALETTE_EVENT = "admin:open-command-palette";

interface PaletteGateProps {
  /** Open intent captured from the first trigger(s) while loading. */
  startOpen: boolean;
  /** Fired once the real palette is mounted and its listeners live. */
  onReady: () => void;
  /** Feature-flag keys currently OFF (live, from the admin layout). */
  offFeatureFlags?: readonly string[];
}

/**
 * The gate wraps the real palette INSIDE the lazy chunk: it renders
 * the palette, then — in a mount effect, which runs after the
 * palette's own listener-registration effects (child effects first)
 * — replays the captured open intent through the palette's own
 * event channel and reports readiness to the shim.
 */
const LazyPaletteGate = dynamic<PaletteGateProps>(
  () =>
    import("@/admin/command-palette").then((m) => {
      const Palette = m.AdminCommandPalette;
      return function PaletteGate({ startOpen, onReady, offFeatureFlags }: PaletteGateProps) {
        const firedRef = useRef(false);
        useEffect(() => {
          if (firedRef.current) return;
          firedRef.current = true;
          if (startOpen) {
            window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
          }
          onReady();
        }, [startOpen, onReady]);
        return <Palette offFeatureFlags={offFeatureFlags} />;
      };
    }),
  { ssr: false },
);

export function AdminCommandPaletteLazy({
  offFeatureFlags,
}: {
  /** Feature-flag keys currently OFF (live, from the admin layout);
   *  forwarded to the palette once it mounts. */
  offFeatureFlags?: readonly string[];
}) {
  // null = palette not requested yet; otherwise the open intent
  // captured from the first trigger (⌘K while closed = open).
  const [mount, setMount] = useState<{ startOpen: boolean } | null>(null);
  const mountRef = useRef(false);
  const readyRef = useRef(false);

  const handleReady = useCallback(() => {
    readyRef.current = true;
  }, []);

  useEffect(() => {
    const beginMount = (startOpen: boolean) => {
      if (mountRef.current) return;
      mountRef.current = true;
      setMount({ startOpen });
    };
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      if (readyRef.current) return; // the palette owns the toggle now
      event.preventDefault();
      if (!mountRef.current) {
        beginMount(true);
      } else {
        // Chunk still loading: a further ⌘K flips the pending
        // intent, so an even number of presses lands closed —
        // the same end state as the eager palette's toggle.
        setMount((m) => (m ? { startOpen: !m.startOpen } : m));
      }
    };
    const onOpenEvent = () => {
      if (readyRef.current) return; // the palette hears it directly
      if (!mountRef.current) {
        beginMount(true);
      } else {
        setMount((m) => (m ? { startOpen: true } : m));
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenEvent);
    };
  }, []);

  if (!mount) return null;
  return (
    <LazyPaletteGate
      startOpen={mount.startOpen}
      onReady={handleReady}
      offFeatureFlags={offFeatureFlags}
    />
  );
}
