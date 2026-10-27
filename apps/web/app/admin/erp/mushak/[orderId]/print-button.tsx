"use client";

/** Print trigger for the Mushak 6.3 page — fires window.print() once
 *  on mount (the orders print-centre pattern) and on click. */
import { useEffect, useRef } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { ERP_STRINGS } from "../../strings";

export default function MushakPrintButton() {
  const { locale } = useLocale();
  const s = pick(locale, ERP_STRINGS);
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const t = setTimeout(() => window.print(), 350);
    return () => clearTimeout(t);
  }, []);
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white"
    >
      {s.printBtn}
    </button>
  );
}
