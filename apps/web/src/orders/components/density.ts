// OD0 (doc 19 §2.3) — density tokens for order surfaces.
//
// The orders list already owns the toggle state as
// useState<"comfortable" | "compact">("comfortable") — OrderDensity is
// deliberately THAT union, so OD1 can adopt these tokens by indexing
// ORDER_DENSITY[density] without touching the state shape, saved views
// or the toggle UI. Values mirror the list's current rendering:
// comfortable = the px-4 py-3 cell default; compact = the py-1.5/py-2
// squeeze the table applies today via arbitrary variants.

export type OrderDensity = "comfortable" | "compact";

export interface OrderDensityTokens {
  /** Data cell padding for order tables. */
  cell: string;
  /** Header cell padding for order tables. */
  headerCell: string;
  /** Padding for order panels/cards (detail workspace, queues). */
  panel: string;
  /** Vertical rhythm between stacked order sections. */
  stack: string;
}

export const ORDER_DENSITY: Record<OrderDensity, OrderDensityTokens> = {
  comfortable: {
    cell: "px-4 py-3",
    headerCell: "px-4 py-3",
    panel: "p-5",
    stack: "space-y-5",
  },
  compact: {
    cell: "px-4 py-1.5",
    headerCell: "px-4 py-2",
    panel: "p-4",
    stack: "space-y-3",
  },
} as const;
