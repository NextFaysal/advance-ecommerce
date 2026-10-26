/**
 * Cohort / retention table — Agent 15, Step 47 (A8). Pure.
 * A cohort is the YYYY-MM month of a customer's first order. Cell (c, n)
 * = how many of that cohort ordered again in month offset n, and the
 * retention in basis points (10000 = 100%) so no float money/percent is
 * stored. Test: cohort 2026-01 size 2, both active month 0, one active
 * month 1 -> row [ {offset:0, active:2, retentionBps:10000},
 * {offset:1, active:1, retentionBps:5000} ].
 */

export interface CustomerActivity {
  customerId: string;
  /** "YYYY-MM" of first-ever order. */
  firstOrderMonth: string;
  /** Distinct "YYYY-MM" months the customer ordered in. */
  activeMonths: string[];
}

export interface CohortCell {
  offsetMonths: number;
  activeCustomers: number;
  retentionBps: number;
}

export interface CohortRow {
  cohortMonth: string;
  size: number;
  cells: CohortCell[];
}

function monthIndex(ym: string): number {
  const [y, m] = ym.split("-").map((s) => Number(s));
  return (y ?? 0) * 12 + ((m ?? 1) - 1);
}

/**
 * Derive CustomerActivity[] from sales rows (ADV-8 wiring). A customer
 * is "active" in a month when they placed at least one non-CANCELLED
 * order that month; their cohort is the month of their FIRST such
 * order. Rows are item-level (one per order item), so activity is
 * deduped by orderId. Dates are Asia/Dhaka YYYY-MM-DD (SalesRow.date),
 * so the month is a plain slice — no timezone math.
 */
export function buildCustomerActivity(
  rows: readonly { customerId: string; orderId: string; date: string; status: string }[],
): CustomerActivity[] {
  const byCustomer = new Map<string, { orders: Map<string, string>; months: Set<string> }>();
  for (const r of rows) {
    if (r.status === "CANCELLED") continue;
    const entry = byCustomer.get(r.customerId) ?? { orders: new Map<string, string>(), months: new Set<string>() };
    entry.orders.set(r.orderId, r.date);
    byCustomer.set(r.customerId, entry);
  }
  return Array.from(byCustomer.entries()).map(([customerId, v]) => {
    const orderDates = Array.from(v.orders.values()).sort();
    const activeMonths = Array.from(new Set(orderDates.map((d) => d.slice(0, 7)))).sort();
    return {
      customerId,
      firstOrderMonth: (orderDates[0] ?? "1970-01-01").slice(0, 7),
      activeMonths,
    };
  });
}

export function buildCohortTable(customers: CustomerActivity[], maxOffset = 11): CohortRow[] {
  const cohorts = new Map<string, CustomerActivity[]>();
  for (const c of customers) {
    const list = cohorts.get(c.firstOrderMonth) ?? [];
    list.push(c);
    cohorts.set(c.firstOrderMonth, list);
  }
  const rows: CohortRow[] = [];
  for (const [month, members] of Array.from(cohorts.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    const base = monthIndex(month);
    const lastActiveOffset = Math.min(
      maxOffset,
      Math.max(0, ...members.flatMap((c) => c.activeMonths.map((am) => monthIndex(am) - base))),
    );
    const cells: CohortCell[] = [];
    for (let offset = 0; offset <= lastActiveOffset; offset += 1) {
      const active = members.filter((c) => c.activeMonths.some((am) => monthIndex(am) - base === offset)).length;
      cells.push({
        offsetMonths: offset,
        activeCustomers: active,
        retentionBps: members.length > 0 ? Math.round((active / members.length) * 10000) : 0,
      });
    }
    rows.push({ cohortMonth: month, size: members.length, cells });
  }
  return rows;
}
