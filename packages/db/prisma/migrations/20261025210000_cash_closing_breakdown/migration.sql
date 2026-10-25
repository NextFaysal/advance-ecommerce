-- Wave 26 (doc 17 O8) parent fix: persist the derived cash-closing
-- breakdown alongside the closing so the signed-off expectation stays
-- auditable later (the derive service recomputes it live for display,
-- but a stored closing must carry the breakdown it was signed against).
ALTER TABLE "DailyCashClosing" ADD COLUMN "breakdownJson" JSONB;
