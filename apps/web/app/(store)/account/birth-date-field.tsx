"use client";

/**
 * Birth-date field for the account profile (schema wave 2) — feeds
 * the birthday-offer job (src/marketing/birthday.ts). The current
 * value loads from GET /api/v1/public/account/me; saving PATCHes the
 * same route. Optional by design: unset = no birthday coupon, which
 * the copy says plainly.
 */
import { useEffect, useState } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { ACCOUNT_STRINGS } from "./strings";

export default function BirthDateField() {
  const { locale } = useLocale();
  const s = pick(locale, ACCOUNT_STRINGS);
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/public/account/me");
        const body = (await res.json().catch(() => ({}))) as {
          data?: { birthDate?: string | null };
        };
        if (!cancelled) {
          setValue(body.data?.birthDate ?? "");
          setLoaded(true);
        }
      } catch {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(next: string | null) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/public/account/me", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ birthDate: next }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
        data?: { birthDate?: string | null };
      };
      if (!res.ok) {
        setError(body.error?.message ?? s.birthDateSaveFailed);
        return;
      }
      setValue(body.data?.birthDate ?? "");
      setMessage(next === null ? s.birthDateCleared : s.birthDateSaved);
    } catch {
      setError(s.birthDateSaveFailedConn);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <dt className="text-text-muted">{s.birthDateLabel}</dt>
      <dd className="mt-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={value}
            disabled={!loaded || busy}
            onChange={(e) => setValue(e.target.value)}
            className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-text-main"
            aria-label={s.birthDateAria}
          />
          <button
            type="button"
            disabled={!loaded || busy || value === ""}
            onClick={() => void save(value === "" ? null : value)}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {s.saveShort}
          </button>
          {value !== "" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(null)}
              className="rounded-md border border-border px-3 py-1.5 text-sm text-text-muted disabled:opacity-50"
            >
              {s.deleteShort}
            </button>
          ) : null}
        </div>
        <p className="mt-1 text-xs leading-5 text-text-subtle">
          {s.birthDateHint}
        </p>
        {message ? <p className="mt-1 text-xs text-success-solid">{message}</p> : null}
        {error ? <p className="mt-1 text-xs text-danger">{error}</p> : null}
      </dd>
    </div>
  );
}
