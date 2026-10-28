"use client";

/**
 * CommandPaletteTrigger — the visible search button in the admin
 * topbar (styled like the search field it replaces). Clicking it
 * dispatches the palette's open event, which AdminCommandPalette
 * (lazy-mounted via app/admin/command-palette-lazy) listens for.
 *
 * This lives in its own module (admin perf wave, slice A follow-up):
 * it previously sat inside command-palette.tsx, and the Topbar's
 * import of it dragged the WHOLE palette module (search logic, nav
 * index, result rendering) into the eager bundle of every admin
 * page, defeating the palette's lazy mount. Everything imported
 * here (locale, ADMIN_STRINGS, Icon) is already eager in the admin
 * shell, so this module adds no new eager weight. The event name is
 * a literal pinned to OPEN_COMMAND_PALETTE_EVENT in
 * command-palette.tsx — importing the constant would re-create the
 * eager edge this module exists to sever.
 */
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";
import { Icon } from "@/components/ui/icon";

const OPEN_COMMAND_PALETTE_EVENT = "admin:open-command-palette";

export function CommandPaletteTrigger() {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  return (
    <button
      type="button"
      aria-label={s.paletteTriggerLabel}
      onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT))}
      className="flex h-10 w-full items-center gap-2.5 rounded-md border border-border bg-card pl-3 pr-2.5 text-left text-sm text-text-subtle shadow-sm transition motion-fast hover:border-brand-300 hover:text-text-muted focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
    >
      <Icon name="search" size={16} />
      <span className="min-w-0 flex-1 truncate">{s.palettePlaceholder}</span>
      <kbd className="shrink-0 rounded border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-caption font-medium text-text-muted">
        ⌘K
      </kbd>
    </button>
  );
}
