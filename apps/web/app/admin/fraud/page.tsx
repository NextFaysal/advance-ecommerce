// Admin > Fraud — Step 43 (A2).
// Thin server wrapper: all data + interaction live in FraudClient, which
// talks to the real DB-backed fraud-rules APIs (lists CRUD + score
// endpoint scored against the current DB lists). The module is a paid
// add-on — when the API answers 403 FEATURE_LOCKED the client renders
// the lock panel.
import { FraudClient } from "./fraud-client";

export default function AdminFraudPage() {
  return <FraudClient />;
}
