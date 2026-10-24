// Admin > Automation — Step 43 (A1).
// Thin server wrapper: all data + interaction live in AutomationClient,
// which talks to the real DB-backed automation APIs (rules CRUD, toggle,
// dry-run, persisted run logs). The module is a paid add-on — when the
// API answers 403 FEATURE_LOCKED the client renders the lock panel.
import { AutomationClient } from "./automation-client";

export default function AdminAutomationPage() {
  return <AutomationClient />;
}
