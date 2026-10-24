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
