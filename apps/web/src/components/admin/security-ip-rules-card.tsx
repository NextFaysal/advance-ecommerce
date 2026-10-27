"use client";

/**
 * Staff-login IP rules card — /admin/security (ADV-28 core).
 *
 * Self-fetching editor for the `security.ip_rules` Setting doc via
 *   GET /api/v1/admin/security/ip-rules  -> { allow, block }
 *   PUT /api/v1/admin/security/ip-rules  -> { allow, block, reason }
 * One IP or CIDR per line in each textarea. The API validates every
 * entry and rejects the WHOLE save (400 + the invalid entries) when
 * any line is malformed — those entries are shown back to the admin,
 * nothing is partially applied. Saving requires a reason (the change
 * is audited as settings.update).
 *
 * Honest scope: these rules apply to STAFF (admin) LOGIN only for
 * now — not to customer sign-in, the storefront, or other API routes.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { ADMIN_STRINGS } from "@/admin/strings";

interface IpRulesData {
  allow: string[];
  block: string[];
}

interface IpRulesResponse {
  data?: IpRulesData;
  error?: { code?: string; message?: string; details?: unknown };
}

function linesToEntries(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function SecurityIpRulesCard() {
  const { locale } = useLocale();
  const s = pick(locale, ADMIN_STRINGS);
  const [allowText, setAllowText] = useState("");
  const [blockText, setBlockText] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/admin/security/ip-rules");
        const body = (await res.json().catch(() => ({}))) as IpRulesResponse;
        if (cancelled) return;
        if (!res.ok || !body.data) {
          setError(body.error?.message ?? s.secIpLoadFailed);
          return;
        }
        setAllowText(body.data.allow.join("\n"));
        setBlockText(body.data.block.join("\n"));
      } catch {
        if (!cancelled) setError(s.secSessNetworkError);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setErrorDetails([]);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/admin/security/ip-rules", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          allow: linesToEntries(allowText),
          block: linesToEntries(blockText),
          reason: reason.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as IpRulesResponse;
      if (!res.ok || !body.data) {
        setError(body.error?.message ?? s.secIpSaveFailed);
        if (Array.isArray(body.error?.details)) {
          setErrorDetails(body.error.details.filter((d): d is string => typeof d === "string"));
        }
        return;
      }
      // Echo the server's canonical (trimmed, de-duplicated) lists so
      // what the admin sees is exactly what is now enforced.
      setAllowText(body.data.allow.join("\n"));
      setBlockText(body.data.block.join("\n"));
      setReason("");
      setMessage(s.secIpSaved);
    } catch {
      setError(s.secSessNetworkError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="text-base font-semibold text-text-main">{s.secIpTitle}</h3>
      <p className="mt-1 text-sm leading-6 text-text-muted">
        {s.secIpDesc}
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-text-muted">{s.subsLoading}</p>
      ) : (
        <div className="mt-4 space-y-4">
          <Textarea
            id="ip-rules-allow"
            name="ip-rules-allow"
            label={s.secIpAllowLabel}
            helper={s.secIpAllowHelper}
            rows={5}
            value={allowText}
            onChange={(e) => setAllowText(e.target.value)}
            placeholder={"203.0.113.10\n198.51.100.0/24"}
            disabled={busy}
          />
          <Textarea
            id="ip-rules-block"
            name="ip-rules-block"
            label={s.secIpBlockLabel}
            helper={s.secIpBlockHelper}
            rows={5}
            value={blockText}
            onChange={(e) => setBlockText(e.target.value)}
            placeholder={"192.0.2.55\n2001:db8:bad::/48"}
            disabled={busy}
          />
          <Input
            id="ip-rules-reason"
            name="ip-rules-reason"
            label={s.secIpReasonLabel}
            helper={s.secIpReasonHelper}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={s.secIpReasonPlaceholder}
            required
            disabled={busy}
          />

          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <p>{error}</p>
              {errorDetails.length > 0 ? (
                <ul className="mt-1 list-disc pl-5">
                  {errorDetails.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {message ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {message}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button onClick={save} disabled={busy || reason.trim() === ""}>
              {busy ? s.secIpSaving : s.secIpSave}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
