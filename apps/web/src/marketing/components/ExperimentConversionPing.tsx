"use client";

// A/B conversion ping (ADV-18B): mounted on the checkout
// confirmation once an order exists. The server derives the
// visitor's variant from the ae_vid cookie itself and verifies the
// order — this component only says "this order happened". Fires at
// most once per mount; the server additionally dedupes per order.
import { useEffect, useRef } from "react";

export function ExperimentConversionPing({ orderId }: { orderId: string }) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current || orderId === "") return;
    fired.current = true;
    void fetch("/api/v1/public/marketing/ab-conversion", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderId }),
      keepalive: true,
    }).catch(() => {
      // Counting is best-effort; never disturb the confirmation.
    });
  }, [orderId]);
  return null;
}
