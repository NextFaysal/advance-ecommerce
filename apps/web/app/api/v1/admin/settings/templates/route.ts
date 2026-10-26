/**
 * Admin template-designer API — /api/v1/admin/settings/templates
 * (ADV-29, doc 23 wave 53).
 *
 *   GET    -> the stored overrides + the resolved invoice slot
 *             texts + the built-in defaults, for the designer UI
 *             and the print centre. Requires settings.view.
 *   PUT    -> save ONE document (the invoice doc, or one email
 *             key's doc). Requires settings.edit and a non-empty
 *             `reason`; the write is audited (templates.update).
 *   DELETE -> reset ONE slot/field to its built-in default (one
 *             invoice slot, or one locale field of one email key).
 *             Requires settings.edit + `reason`; audited
 *             (templates.reset).
 *
 * Storage is the Setting-document store in src/templates/
 * overrides.ts — NOT the generic settings POST: setSetting()
 * rejects `templates.*` keys (not in SETTING_DEFAULTS and outside
 * its provider-key pattern), so the doc store writes the rows
 * directly, the same mechanism CMS (cms.*) and reports
 * (reports.*) documents use.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateSessionToken } from "@/lib/auth";
import { requirePermission, RbacError } from "@/lib/rbac";
import { writeAudit } from "@/lib/audit";
import {
  DEFAULT_INVOICE_FOOTER,
  OVERRIDABLE_EMAIL_KEYS,
  EMAIL_PLACEHOLDERS,
  invoiceSlotText,
  loadEmailOverrides,
  loadInvoiceOverrides,
  resetEmailField,
  resetInvoiceSlot,
  resolveInvoiceTexts,
  saveEmailOverrides,
  saveInvoiceOverrides,
  type BilingualSlot,
  type EmailTemplateKey,
  type EmailTemplateOverrides,
  type InvoiceSlotName,
  type InvoiceTemplateOverrides,
} from "@/templates/overrides";

export const dynamic = "force-dynamic";

function err(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

async function requireAdmin(permission: "settings.view" | "settings.edit") {
  const token = cookies().get("admin_session")?.value;
  if (!token) return { error: err("UNAUTHENTICATED", "Admin login required.", 401) };
  try {
    const session = await validateSessionToken(token);
    if (!session) return { error: err("UNAUTHENTICATED", "Session expired or revoked.", 401) };
    requirePermission(session.user.permissions, permission);
    return { session };
  } catch (e) {
    if (e instanceof RbacError) return { error: err("FORBIDDEN", e.message, 403) };
    return { error: err("DB_NOT_READY", "Session check needs a working database.", 503) };
  }
}

const EMPTY_SLOT: BilingualSlot = { bn: "", en: "" };
const EMPTY_EMAIL_DOC: EmailTemplateOverrides = {
  bn: { subject: "", intro: "" },
  en: { subject: "", intro: "" },
};

export async function GET() {
  const auth = await requireAdmin("settings.view");
  if ("error" in auth) return auth.error;

  const [invoice, resolved] = await Promise.all([loadInvoiceOverrides(), resolveInvoiceTexts()]);
  const emailDocs: Record<string, unknown> = {};
  for (const key of OVERRIDABLE_EMAIL_KEYS) {
    const doc = await loadEmailOverrides(key);
    emailDocs[key] = {
      doc: doc ?? EMPTY_EMAIL_DOC,
      configured: doc !== null,
      placeholders: EMAIL_PLACEHOLDERS[key],
      docKey: `templates.email.${key}`,
    };
  }

  return NextResponse.json({
    data: {
      invoice: {
        docKey: "templates.invoice",
        doc: invoice ?? { headerNote: EMPTY_SLOT, footerNote: EMPTY_SLOT, termsLine: EMPTY_SLOT },
        configured: invoice !== null,
        /** Slot texts as the renderers resolve them (null = unset). */
        effective: resolved,
        defaults: {
          footerNote: invoiceSlotText(DEFAULT_INVOICE_FOOTER),
          headerNote: null,
          termsLine: null,
        },
      },
      email: emailDocs,
    },
    meta: { source: "database" },
  });
}

interface PutBody {
  target?: unknown;
  key?: unknown;
  doc?: unknown;
  reason?: unknown;
}

function asSlot(value: unknown): BilingualSlot {
  const v = (value ?? {}) as { bn?: unknown; en?: unknown };
  return {
    bn: typeof v.bn === "string" ? v.bn : "",
    en: typeof v.en === "string" ? v.en : "",
  };
}

function asEmailDoc(value: unknown): EmailTemplateOverrides {
  const v = (value ?? {}) as { bn?: { subject?: unknown; intro?: unknown }; en?: { subject?: unknown; intro?: unknown } };
  const copy = (c: { subject?: unknown; intro?: unknown } | undefined) => ({
    subject: typeof c?.subject === "string" ? c.subject : "",
    intro: typeof c?.intro === "string" ? c.intro : "",
  });
  return { bn: copy(v.bn), en: copy(v.en) };
}

export async function PUT(req: Request) {
  const auth = await requireAdmin("settings.edit");
  if ("error" in auth) return auth.error;
  const body = (await req.json().catch(() => ({}))) as PutBody;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason === "") return err("INVALID_INPUT", "A non-empty reason is required.", 400);
  const actorId = auth.session.user.id;
  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const userAgent = req.headers.get("user-agent") ?? undefined;

  if (body.target === "invoice") {
    const doc = (body.doc ?? {}) as Partial<InvoiceTemplateOverrides>;
    const input: InvoiceTemplateOverrides = {
      headerNote: asSlot(doc.headerNote),
      footerNote: asSlot(doc.footerNote),
      termsLine: asSlot(doc.termsLine),
    };
    const result = await saveInvoiceOverrides(input, actorId);
    if (!result.ok) return err("INVALID_INPUT", result.message, 400);
    await writeAudit({
      actorId,
      action: "templates.update",
      entityType: "Setting",
      entityId: "templates.invoice",
      afterJson: { ...input },
      reason,
      ip,
      userAgent,
    });
    return NextResponse.json({ data: { saved: true, target: "invoice" }, meta: { source: "database" } });
  }

  if (body.target === "email") {
    const key = body.key as EmailTemplateKey;
    if (!OVERRIDABLE_EMAIL_KEYS.includes(key)) {
      return err("INVALID_INPUT", `Unknown or non-overridable email template: ${String(body.key)}`, 400);
    }
    const input = asEmailDoc(body.doc);
    const result = await saveEmailOverrides(key, input, actorId);
    if (!result.ok) return err("INVALID_INPUT", result.message, 400);
    await writeAudit({
      actorId,
      action: "templates.update",
      entityType: "Setting",
      entityId: `templates.email.${key}`,
      afterJson: { ...input },
      reason,
      ip,
      userAgent,
    });
    return NextResponse.json({ data: { saved: true, target: "email", key }, meta: { source: "database" } });
  }

  return err("INVALID_INPUT", "Body target must be \"invoice\" or \"email\".", 400);
}

interface DeleteBody {
  target?: unknown;
  slot?: unknown;
  key?: unknown;
  locale?: unknown;
  field?: unknown;
  reason?: unknown;
}

export async function DELETE(req: Request) {
  const auth = await requireAdmin("settings.edit");
  if ("error" in auth) return auth.error;
  const body = (await req.json().catch(() => ({}))) as DeleteBody;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason === "") return err("INVALID_INPUT", "A non-empty reason is required.", 400);
  const actorId = auth.session.user.id;
  const ip = req.headers.get("x-forwarded-for") ?? undefined;
  const userAgent = req.headers.get("user-agent") ?? undefined;

  if (body.target === "invoice") {
    const slot = body.slot as InvoiceSlotName;
    if (slot !== "headerNote" && slot !== "footerNote" && slot !== "termsLine") {
      return err("INVALID_INPUT", `Unknown invoice slot: ${String(body.slot)}`, 400);
    }
    await resetInvoiceSlot(slot, actorId);
    await writeAudit({
      actorId,
      action: "templates.reset",
      entityType: "Setting",
      entityId: "templates.invoice",
      afterJson: { resetSlot: slot },
      reason,
      ip,
      userAgent,
    });
    return NextResponse.json({ data: { reset: true, target: "invoice", slot }, meta: { source: "database" } });
  }

  if (body.target === "email") {
    const key = body.key as EmailTemplateKey;
    const locale = body.locale as "bn" | "en";
    const field = body.field as "subject" | "intro";
    if (!OVERRIDABLE_EMAIL_KEYS.includes(key)) {
      return err("INVALID_INPUT", `Unknown or non-overridable email template: ${String(body.key)}`, 400);
    }
    if (locale !== "bn" && locale !== "en") return err("INVALID_INPUT", "locale must be \"bn\" or \"en\".", 400);
    if (field !== "subject" && field !== "intro") return err("INVALID_INPUT", "field must be \"subject\" or \"intro\".", 400);
    await resetEmailField(key, locale, field, actorId);
    await writeAudit({
      actorId,
      action: "templates.reset",
      entityType: "Setting",
      entityId: `templates.email.${key}`,
      afterJson: { resetLocale: locale, resetField: field },
      reason,
      ip,
      userAgent,
    });
    return NextResponse.json({ data: { reset: true, target: "email", key, locale, field }, meta: { source: "database" } });
  }

  return err("INVALID_INPUT", "Body target must be \"invoice\" or \"email\".", 400);
}
