"use client";

// Convert-to-order button for ACCEPTED B2B quotations — doc 17 O9-1.
// Posts to /api/v1/admin/b2b/quotations/[id]/convert. When the service
// answers ADDRESS_REQUIRED (the B2B record carries no delivery
// address), staff are prompted for one and the call is retried with
// it — the address is never invented server-side. Credit refusals
// surface the server's bilingual message (it carries the numbers).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { B2B_STRINGS } from "./strings";

type ConvertResponse = {
  data?: { orderNo?: string };
  error?: { code?: string; message?: string };
};

async function postConvert(id: string, body: Record<string, unknown>): Promise<ConvertResponse> {
  const res = await fetch(`/api/v1/admin/b2b/quotations/${id}/convert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json().catch(() => ({}))) as ConvertResponse;
}

export function ConvertQuotationButton({ quotationId }: { quotationId: string }) {
  const { locale } = useLocale();
  const s = pick(locale, B2B_STRINGS);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const convert = async () => {
    setBusy(true);
    setMessage(null);
    try {
      let result = await postConvert(quotationId, {});
      if (result.error?.code === "ADDRESS_REQUIRED") {
        const division = window.prompt(s.promptDivision, "Dhaka");
        const district = window.prompt(s.promptDistrict, "Dhaka");
        const upazila = window.prompt(s.promptUpazila, "");
        const addressLine = window.prompt(s.promptAddress, "");
        if (!division || !district || !upazila || !addressLine) {
          setMessage({ ok: false, text: s.cancelledNoAddress });
          return;
        }
        result = await postConvert(quotationId, {
          address: { division, district, upazila, addressLine },
        });
      }
      if (result.error) {
        setMessage({ ok: false, text: result.error.message ?? result.error.code ?? s.conversionFailed });
        return;
      }
      setMessage({ ok: true, text: interpolate(s.orderCreated, { orderNo: result.data?.orderNo ?? "" }) });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: s.networkError });
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={convert}>
        {busy ? s.converting : s.convertBtn}
      </Button>
      {message ? (
        <span role="status" className={message.ok ? "text-xs text-emerald-700" : "text-xs text-rose-700"}>
          {message.text}
        </span>
      ) : null}
    </span>
  );
}
