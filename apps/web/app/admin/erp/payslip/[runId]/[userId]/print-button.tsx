"use client";

/** Print trigger for the payslip page — fires window.print() once on
 *  mount (the Mushak / orders print-centre pattern) and on click. */
import { useEffect, useRef } from "react";

export default function PayslipPrintButton() {
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
      প্রিন্ট করুন (Print)
    </button>
  );
}
