import { navItemLabel } from "@/admin-nav/config";
import { CommandPaletteTrigger } from "@/admin/command-palette-trigger";
import { QuickCreateMenu } from "./QuickCreateMenu";
import { pick, type Locale } from "@/i18n/locale";
import { LanguageSwitcher } from "@/i18n/LanguageSwitcher";
import { ADMIN_STRINGS } from "@/admin/strings";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ShellIcon } from "./icons";
import { ShellIdentity } from "./ShellIdentity";
import { activeNavItem } from "./nav-utils";

/**
 * Topbar — sticky glass admin header (doc 31, D2; Aurora Pro).
 *
 * Server component. Contents (all preserved from the pre-D2 layout,
 * plus the theme toggle the D2 brief adds): mobile brand, breadcrumb
 * (Admin › active section), the ⌘K command-palette trigger, the "+ New"
 * quick-create menu, ThemeToggle, LanguageSwitcher and the admin
 * avatar. An environment chip is deliberately skipped: the sidebar
 * store card already carries the Live status, and a second chip would
 * need data the shell does not have.
 *
 * Doc 35 wave 1: the "+ New" button was dead (no menu, no action) and
 * is now the QuickCreateMenu client island. The notifications bell was
 * also dead — no badge, no panel — and is REMOVED rather than wired:
 * the only unread source is the inbox, whose sole existing helper
 * (loadInbox in src/inbox/store.ts) loads every conversation and every
 * message, far too heavy for a shell that renders on every admin page
 * and deliberately carries no badge queries. No count is faked; the
 * bell can return when a cheap unread-count query exists.
 *
 * Doc 35 wave 3: the avatar is no longer a hardcoded gradient "N" —
 * ShellIdentity renders the real signed-in staff member's initials
 * from their own session. Brand exception (recorded): the only
 * brand-gradient left in this header is the QuickCreateMenu "+ New"
 * button, a primary CTA — the gradient is reserved for hero, primary
 * CTAs and logo marks, nowhere else.
 */
export function Topbar({ pathname, locale }: { pathname: string; locale: Locale }) {
  const s = pick(locale, ADMIN_STRINGS);
  const activeItem = activeNavItem(pathname);
  return (
    <header className="sticky top-0 z-40 flex h-16 items-center gap-3 border-b border-border/70 bg-card/80 px-4 shadow-xs backdrop-blur-xl sm:px-6">
      <span className="font-bold text-brand-700 md:hidden">Advance Ecommerce</span>
      {/* Breadcrumb */}
      <nav aria-label={s.breadcrumb} className="hidden min-w-0 items-center gap-1.5 text-sm md:flex">
        <a href="/admin" className="focus-ring shrink-0 rounded-sm font-medium text-text-muted transition duration-fast hover:text-brand-700">
          {s.admin}
        </a>
        <span aria-hidden="true" className="text-text-subtle">
          <ShellIcon name="ChevronRight" className="h-4 w-4" />
        </span>
        <span aria-current="page" className="truncate font-semibold text-text-main">
          {navItemLabel(activeItem, locale)}
        </span>
      </nav>
      <div className="relative ml-auto hidden w-full max-w-sm lg:block">
        <CommandPaletteTrigger />
      </div>
      <span className="ml-auto flex items-center gap-1.5 lg:ml-0">
        <QuickCreateMenu />
        <ThemeToggle />
        <LanguageSwitcher />
        <span className="ml-1">
          <ShellIdentity
            variant="avatar"
            fallbackName={s.admin}
            fallbackDetail={s.sessionActive}
            avatarLabel={s.adminAvatar}
          />
        </span>
      </span>
    </header>
  );
}
