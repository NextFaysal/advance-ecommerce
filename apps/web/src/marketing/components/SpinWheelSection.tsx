// Spin-wheel homepage section (ADV-18B) — server wrapper in the
// FlashSaleCountdownSection pattern: renders nothing unless the
// marketing-mechanics flag is on AND the wheel is enabled AND at
// least one segment is drawable. Only serializable props cross to
// the client widget.
//
// Wave 46: the customer-session read that used to run here is
// gone — the widget now resolves its signed-in state client-side
// (GET /api/v1/public/account/me on mount) so the homepage can
// render statically. The section passes no signedIn prop; the
// widget treats that as "unknown, resolve on mount".
import { marketingMechanicsEnabled } from "@/marketing/docs";
import { getSpinDisplayConfig } from "@/marketing/spin";
import { cached } from "@/lib/ttl-cache";
import { SpinWheelWidget } from "./SpinWheelWidget";

export async function SpinWheelSection() {
  if (!marketingMechanicsEnabled()) return null;
  // The config read (Setting doc + per-segment coupon drawable
  // state, resolved inside getSpinDisplayConfig) is TTL-cached for
  // 30s; the spin endpoint still re-validates the drawn coupon
  // live, so a stale drawable flag here is display-only.
  const display = await cached("spin-config", 30_000, () => getSpinDisplayConfig()).catch(() => null);
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
    />
  );
}
