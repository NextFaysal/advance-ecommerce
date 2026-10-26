-- Fractional quantities (doc 23 wave 59): weighted goods (grocery
-- per-kg packs) may be sold in fractions of a unit — 0.5 of a pack —
-- so the order-path line quantities stop being integers. Only the
-- customer-order-path models move; warehouse/purchase quantities
-- (PurchaseOrderItem, InventoryItem, StockMovement, InventoryBatch)
-- and bundle composition (BundleComponent) stay INTEGER by design.
--
-- ALTER COLUMN TYPE integer -> numeric(12,3) is data-preserving in
-- Postgres (every integer value is exactly representable), so all
-- existing rows keep their exact quantities.
ALTER TABLE "CartItem" ALTER COLUMN "quantity" TYPE DECIMAL(12,3);
ALTER TABLE "OrderItem" ALTER COLUMN "quantity" TYPE DECIMAL(12,3);
ALTER TABLE "ReturnItem" ALTER COLUMN "quantity" TYPE DECIMAL(12,3);
ALTER TABLE "Subscription" ALTER COLUMN "quantity" TYPE DECIMAL(12,3);
