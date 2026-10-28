import { navItemLabel } from "@/admin-nav/config";
import { CommandPaletteTrigger } from "@/admin/command-palette";
import { pick, type Locale } from "@/i18n/locale";
import { LanguageSwitcher } from "@/i18n/LanguageSwitcher";
import { ADMIN_STRINGS } from "@/admin/strings";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { ShellIcon } from "./icons";
import { activeNavItem } from "./nav-utils";

/**
 * Topbar — sticky glass admin header (doc 31, D2; Aurora Pro).
 *
 * Server component. Contents (all preserved from the pre-D2 layout,
 * plus the theme toggle the D2 brief adds): mobile brand, breadcrumb
 * (Admin › active section), the ⌘K command-palette trigger, the "+ New"
 * button (unchanged — it carries no menu/links today, so no quick-create
 * menu is invented here), notifications, ThemeToggle, LanguageSwitcher
 * and the admin avatar. An environment chip is deliberately skipped:
 * the sidebar store card already carries the Live status, and a second
 * chip would need data the shell does not have.
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
        <button
          type="button"
          className="focus-ring brand-gradient flex min-h-[44px] items-center gap-1.5 rounded-md px-3.5 text-sm font-semibold text-white shadow-md transition duration-fast ease-smooth hover:shadow-glow"
        >
          <ShellIcon name="Plus" className="h-4 w-4" />
          <span className="hidden sm:inline">{s.newItem}</span>
        </button>
        <button
          type="button"
          aria-label={s.notifications}
          className="focus-ring relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md text-text-muted transition duration-fast hover:bg-surface-2 hover:text-text-main"
        >
          <ShellIcon name="Bell" className="h-5 w-5" />
        </button>
        <ThemeToggle />
        <LanguageSwitcher />
        <span aria-label={s.adminAvatar} className="brand-gradient ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-bold text-white ring-2 ring-brand-100">
          N
        </span>
      </span>
    </header>
  );
}
