// Admin > Settings > Notifications — UI shell only (Agent 5, Steps 26/31 base).
// No real SMS/email sends, no credential values. SMS: BulkSMSBD / SSL Wireless / Greenweb.
// Email: Resend + SMTP. Templates use variables {customer_name}, {order_no}, {tracking_url}.
const SMS_PROVIDERS = ["BulkSMSBD", "SSL Wireless", "Greenweb"] as const;
const EMAIL_PROVIDERS = ["Resend", "SMTP"] as const;

export default function NotificationsSettingsPage() {
  return (
    <main>
      <h1>Settings — Notifications</h1>
      <section style={{ border: "1px solid #E6E8F2", padding: 16, marginBottom: 12 }}>
        <h2>SMS</h2>
        <label>
          Active provider{" "}
          <select disabled>
            {SMS_PROVIDERS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>{" "}
        <label>
          Fallback provider{" "}
          <select disabled>
            <option>None</option>
            {SMS_PROVIDERS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <div>
          <label>
            Sender ID <input type="text" placeholder="—" disabled />
          </label>{" "}
          <label>
            Credential reference (encrypted, never shown){" "}
            <input type="password" placeholder="••••••••" disabled />
          </label>
        </div>
        <p>Status: Not connected (shell — test-connection wiring lands in Step 26).</p>
      </section>
      <section style={{ border: "1px solid #E6E8F2", padding: 16, marginBottom: 12 }}>
        <h2>Email</h2>
        <label>
          Active provider{" "}
          <select disabled>
            {EMAIL_PROVIDERS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <div>
          <label>
            From email <input type="email" placeholder="—" disabled />
          </label>{" "}
          <label>
            From name <input type="text" placeholder="—" disabled />
          </label>{" "}
          <label>
            Credential reference (encrypted, never shown){" "}
            <input type="password" placeholder="••••••••" disabled />
          </label>
        </div>
        <p>Status: Not connected (shell — test-connection wiring lands in Step 26).</p>
      </section>
      <section style={{ border: "1px solid #E6E8F2", padding: 16 }}>
        <h2>Templates &amp; delivery log</h2>
        <p>
          Per-status templates are edited here in Step 31. Failed sends queue for retry and
          appear in the delivery log — they are never silently dropped.
        </p>
        <button type="button" disabled>
          Test connection (outline)
        </button>
      </section>
    </main>
  );
}
