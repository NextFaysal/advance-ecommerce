-- Call Center R2.2 completion: persist when the current call was
-- claimed, so the workbench timer survives reloads on any browser
-- (previously stamped only on the claim response).
ALTER TABLE "CallTask" ADD COLUMN "assignedAt" TIMESTAMP(3);
