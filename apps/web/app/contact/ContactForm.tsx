"use client";

/**
 * Contact form — Agent 29 outline, wired by Agent 47.
 *
 * Submits to POST /api/v1/public/contact. Submissions land in the
 * support inbox (in-memory demo store in this build) — the success
 * state says exactly that ("আপনার বার্তা পৌঁছেছে" + the reference id);
 * no email/SMS is claimed. API errors are shown as returned: 400 field
 * messages render under their fields, 429 shows the rate-limit
 * message, and an unreachable API shows a failure notice — never a
 * fake success.
 *
 * The off-screen "website" input is a honeypot: real users never see
 * or fill it. Do not remove it, label it visibly, or mention it in
 * any user-facing text.
 */
import { useState } from "react";
import { CONTACT_CONTENT } from "@/legal/content";
import { CONTACT_FORM_LABELS } from "@/contact/labels";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";

type FieldName = "name" | "phone" | "email" | "subject" | "message";
type FieldErrors = Partial<Record<FieldName, string>>;

const FIELD_NAMES: readonly FieldName[] = ["name", "phone", "email", "subject", "message"];

interface ApiIssue {
  path?: unknown;
  message?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Pull per-field messages out of the API's Zod `details` array. */
function fieldErrorsFromDetails(details: unknown): FieldErrors {
  const errors: FieldErrors = {};
  if (!Array.isArray(details)) return errors;
  for (const raw of details as ApiIssue[]) {
    if (!isRecord(raw) || !Array.isArray(raw.path) || typeof raw.message !== "string") continue;
    const field = raw.path[0];
    if (typeof field === "string" && (FIELD_NAMES as readonly string[]).includes(field)) {
      const key = field as FieldName;
      if (!errors[key]) errors[key] = raw.message;
    }
  }
  return errors;
}

const inputClass =
  "mt-1 h-11 w-full rounded-xl border border-border bg-card px-3 text-sm text-text-main shadow-xs outline-none transition duration-200 placeholder:text-text-subtle focus:border-brand-400 focus:ring-2 focus:ring-brand-ink/15";
const errorText = "mt-1 text-xs font-medium text-danger";

export default function ContactForm() {
  // Doc 30: labels follow the ACTIVE locale (visitor override → store
  // default) and switch live with it — the {bn, en} records are selected
  // by the resolved locale, never pinned to bn.
  const { locale } = useLocale();
  const content = pick(locale, CONTACT_CONTENT);
  const labels = CONTACT_FORM_LABELS[locale];
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — see header
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFieldErrors({});
    setFormError(null);
    setSuccessId(null);
    try {
      const res = await fetch("/api/v1/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, email, subject, message, website }),
      });
      const payload: unknown = await res.json().catch(() => null);

      if (res.status === 201 && isRecord(payload) && isRecord(payload.data) && typeof payload.data.id === "string") {
        setSuccessId(payload.data.id);
        setName("");
        setPhone("");
        setEmail("");
        setSubject("");
        setMessage("");
        setWebsite("");
        return;
      }

      const apiError = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
      const apiMessage = apiError && typeof apiError.message === "string" ? apiError.message : null;
      if (res.status === 400) {
        setFieldErrors(fieldErrorsFromDetails(apiError?.details));
        setFormError(apiMessage ?? labels.genericError);
      } else if (res.status === 429) {
        setFormError(apiMessage ?? labels.genericError);
      } else {
        setFormError(labels.unreachableError);
      }
    } catch {
      setFormError(labels.unreachableError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="mt-4 space-y-3" onSubmit={onSubmit} noValidate>
      {successId ? (
        <p role="status" className="rounded-xl bg-success-soft p-3 text-sm text-success-solid">
          <span className="font-semibold">{labels.successTitle}</span>
          <br />
          {labels.successBody.replace("{id}", successId)}
        </p>
      ) : null}
      {formError ? (
        <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">
          {formError}
        </p>
      ) : null}

      <div>
        <label htmlFor="contact-name" className="text-sm font-medium">
          {content.nameLabel}
        </label>
        <input
          id="contact-name"
          name="name"
          type="text"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={fieldErrors.name ? true : undefined}
          className={inputClass}
        />
        {fieldErrors.name ? <p className={errorText}>{fieldErrors.name}</p> : null}
      </div>
      <div>
        <label htmlFor="contact-phone" className="text-sm font-medium">
          {content.phoneFieldLabel}
        </label>
        <input
          id="contact-phone"
          name="phone"
          type="tel"
          autoComplete="tel"
          placeholder="01XXXXXXXXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          aria-invalid={fieldErrors.phone ? true : undefined}
          className={inputClass}
        />
        {fieldErrors.phone ? <p className={errorText}>{fieldErrors.phone}</p> : null}
      </div>
      <div>
        <label htmlFor="contact-email" className="text-sm font-medium">
          {labels.emailLabel}
        </label>
        <input
          id="contact-email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={fieldErrors.email ? true : undefined}
          className={inputClass}
        />
        <p className="mt-1 text-xs text-text-subtle">{labels.emailOptionalNote}</p>
        {fieldErrors.email ? <p className={errorText}>{fieldErrors.email}</p> : null}
      </div>
      <div>
        <label htmlFor="contact-subject" className="text-sm font-medium">
          {labels.subjectLabel}
        </label>
        <input
          id="contact-subject"
          name="subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          aria-invalid={fieldErrors.subject ? true : undefined}
          className={inputClass}
        />
        {fieldErrors.subject ? <p className={errorText}>{fieldErrors.subject}</p> : null}
      </div>
      <div>
        <label htmlFor="contact-message" className="text-sm font-medium">
          {content.messageLabel}
        </label>
        <textarea
          id="contact-message"
          name="message"
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          aria-invalid={fieldErrors.message ? true : undefined}
          className="mt-1 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-text-main shadow-xs outline-none transition duration-200 placeholder:text-text-subtle focus:border-brand-400 focus:ring-2 focus:ring-brand-ink/15"
        />
        {fieldErrors.message ? <p className={errorText}>{fieldErrors.message}</p> : null}
      </div>

      {/* Honeypot — off-screen, not announced, never filled by real users. */}
      <div aria-hidden="true" className="absolute -left-[9999px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="contact-website">Website</label>
        <input
          id="contact-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="brand-gradient focus-ring min-h-[44px] w-full rounded-xl px-4 text-sm font-semibold text-white shadow-md transition hover:opacity-90 disabled:opacity-60"
      >
        {submitting ? labels.submittingLabel : content.submitLabel}
      </button>
      <p className="text-xs text-text-subtle">{labels.formNote}</p>
      <p className="text-xs text-text-subtle">{labels.storageNote}</p>
    </form>
  );
}
