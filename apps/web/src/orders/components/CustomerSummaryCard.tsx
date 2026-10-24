// Customer summary for the Order Workspace — success rate, AOV, lifetime
// value and this order's risk, computed with the pure helpers in
// src/orders/customer.ts. Phone is ALWAYS masked here: this card never
// receives a full-phone permission flag, so it can never render one.
import { Card } from "../../components/ui/card";
import { Money } from "../../components/ui/money";
import { Phone } from "../../components/ui/phone";
import { Badge } from "../../components/ui/badge";
import { RiskBadge } from "../../components/ui/status-badge";
import type { RiskLevel as RiskBadgeLevel } from "../../components/ui/status-badge";
import { customerAovPoisha, customerSuccessRate, riskLevel } from "../customer";
import type { Customer, Order } from "../types";

function toRiskBadgeLevel(score: number): RiskBadgeLevel {
  const level = riskLevel(score);
  return level === "Low" ? "LOW" : level === "Medium" ? "MEDIUM" : "HIGH";
}

export function CustomerSummaryCard({
  order,
  customer,
}: {
  order: Order;
  customer?: Customer;
}) {
  const level = riskLevel(order.riskScore);
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">কাস্টমার সারাংশ</h2>
        <RiskBadge level={toRiskBadgeLevel(order.riskScore)} />
      </div>
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-text-muted">নাম</dt>
          <dd className="font-medium">{order.customerName}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-muted">ফোন (মাস্ক করা)</dt>
          <dd>
            <Phone phone={order.customerPhone} />
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-text-muted">এই অর্ডারের রিস্ক</dt>
          <dd className="font-medium">
            {level} ({order.riskScore}/100)
          </dd>
        </div>
        {customer ? (
          <>
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">ডেলিভারি সাফল্যের হার</dt>
              <dd className="font-medium">{customerSuccessRate(customer)}%</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">মোট অর্ডার</dt>
              <dd className="font-medium">{customer.totalOrders}টি</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">ডেলিভারি / বাতিল / রিটার্ন</dt>
              <dd className="font-medium">
                {customer.deliveredOrders} / {customer.cancelledOrders} / {customer.returnedOrders}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">গড় অর্ডার মূল্য (AOV)</dt>
              <dd>
                <Money poisha={customerAovPoisha(customer)} />
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-text-muted">লাইফটাইম মূল্য</dt>
              <dd>
                <Money poisha={customer.lifetimeValuePoisha} />
              </dd>
            </div>
            {customer.tags.length > 0 && (
              <div className="flex justify-between gap-4">
                <dt className="text-text-muted">ট্যাগ</dt>
                <dd className="flex flex-wrap gap-1">
                  {customer.tags.map((t) => (
                    <Badge key={t} tone="neutral">
                      {t}
                    </Badge>
                  ))}
                </dd>
              </div>
            )}
            {customer.blocked && (
              <p role="alert" className="text-rose-600">
                ⚠ এই কাস্টমার ব্লক করা আছে।
              </p>
            )}
          </>
        ) : (
          <p className="text-text-muted">
            কাস্টমার রেকর্ড পাওয়া যায়নি — শুধু এই অর্ডারের তথ্য দেখানো হচ্ছে।
          </p>
        )}
      </dl>
    </Card>
  );
}
