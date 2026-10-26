// Spin-wheel homepage section (ADV-18B) — server wrapper in the
// FlashSaleCountdownSection pattern: renders nothing unless the
// marketing-mechanics flag is on AND the wheel is enabled AND at
// least one segment is drawable. Only serializable props cross to
// the client widget.
import { marketingMechanicsEnabled } from "@/marketing/docs";
import { getSpinDisplayConfig } from "@/marketing/spin";
import { requireCustomer } from "@/customer-auth/http";
import { SpinWheelWidget } from "./SpinWheelWidget";

export async function SpinWheelSection() {
  if (!marketingMechanicsEnabled()) return null;
  const display = await getSpinDisplayConfig().catch(() => null);
  if (display === null || !display.enabled || display.segments.length === 0) return null;
  const customer = await requireCustomer().catch(() => null);
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
