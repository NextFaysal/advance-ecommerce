import type { ReactNode } from "react";
import { PageHeader as ShellPageHeader } from "@/admin-shell/PageHeader";

/**
 * PageHeader — THE admin page-heading system (doc 35 wave 3).
 *
 * This module used to be a second, competing implementation (h1-scale
 * title + optional `section-eyebrow`). The codebase now has exactly
 * one renderer: the admin shell's PageHeader (doc 31 D2, text-page-title
 * scale). This file remains only as a props-compatible delegate so the
 * ~54 existing call sites keep compiling and rendering identically to
 * the ~29 shell call sites:
 *
 *   title       → title
 *   description → subtitle
 *   breadcrumb  → a one-crumb breadcrumb trail (plain string in,
 *                 shell crumb out; pass `breadcrumbLabel` through the
 *                 shell component directly when an aria-label is needed)
 *   actions     → actions
 *
 * The `eyebrow` prop is REMOVED, not deprecated: no call site passed
 * it (verified by grep at wave 3), and the eyebrow pattern is a Taste
 * gate fail. New pages should import PageHeader from
 * "@/admin-shell/PageHeader" directly.
 */
export function PageHeader({ title, description, breadcrumb, actions, className }: {
  title: string;
  description?: string;
  breadcrumb?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <ShellPageHeader
      title={title}
      subtitle={description}
      breadcrumbs={breadcrumb ? [{ label: breadcrumb }] : undefined}
      actions={actions}
      className={className}
    />
  );
}
