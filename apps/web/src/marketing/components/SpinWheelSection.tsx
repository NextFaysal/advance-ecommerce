// Spin-wheel homepage section (ADV-18B) — server wrapper in the
// FlashSaleCountdownSection pattern: renders nothing unless the
// marketing-mechanics flag is on AND the wheel is enabled AND at
// least one segment is drawable. Only serializable props cross to
// the client widget.
import { marketingMechanicsEnabled } from "@/marketing/docs";
import { getSpinDisplayConfig } from "@/marketing/spin";
import { requireCustomer } from "@/customer-auth/http";
import { cached } from "@/lib/ttl-cache";
import { SpinWheelWidget } from "./SpinWheelWidget";

export async function SpinWheelSection() {
  if (!marketingMechanicsEnabled()) return null;
  // Speed wave batch 2: the config read (Setting doc + per-segment
  // coupon drawable state, resolved inside getSpinDisplayConfig)
  // and the customer-session read are independent — run them in
  // parallel instead of serially. The config is TTL-cached for
  // 30s; the spin endpoint still re-validates the drawn coupon
  // live, so a stale drawable flag here is display-only.
  const [display, customer] = await Promise.all([
    cached("spin-config", 30_000, () => getSpinDisplayConfig()).catch(() => null),
    requireCustomer().catch(() => null),
  ]);
  if (display === null || !display.enabled || display.segments.length === 0) return null;
  return (
    <SpinWheelWidget
      segments={display.segments.map((s) => ({
        id: s.id,
        labelBn: s.labelBn,
        couponCode: s.couponCode,
        weightBps: s.weightBps,
        oddsPercent: s.oddsPercent,
      }))}
      dailyLimit={display.dailyLimit}
      signedIn={customer !== null}
    />
  );
}
