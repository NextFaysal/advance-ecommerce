// Admin > Settings > Integrations — UI shell only (Agent 5, base).
// Default storage: Cloudflare R2 (S3-compatible). All cards show Connected / Not connected
// status only — no credential values are ever displayed here.
const CARDS = [
  { name: "Storage — Cloudflare R2 (default, S3-compatible)", note: "Endpoint, region, bucket, CDN URL — admin-configurable." },
  { name: "Search — Meilisearch", note: "Host and key reference — admin-configurable; Postgres fallback when not running." },
  { name: "Tracking — Facebook Pixel + CAPI, TikTok Pixel, GA4, GTM", note: "Public IDs here; the CAPI token is an encrypted credential reference only." },
  { name: "Payments — see Settings > Payments", note: "All payment methods are configured per-method, not here." },
  { name: "Courier — see Settings > Shipping", note: "All couriers are configured per-provider, not here." },
  { name: "SMS / Email — see Settings > Notifications", note: "Providers, sender ID and from address are configured there." },
] as const;

export default function IntegrationsSettingsPage() {
  return (
    <main>
      <h1>Settings — Integrations</h1>
      <p>
        Rule for every card: env is only a default/fallback. What admin sets here
        (encrypted in the settings table) overrides it.
      </p>
      {CARDS.map((card) => (
        <section key={card.name} style={{ border: "1px solid #E6E8F2", padding: 16, marginBottom: 12 }}>
          <h2>{card.name}</h2>
          <p>{card.note}</p>
          <p>Status: Not connected</p>
          <button type="button" disabled>
            Configure (outline)
          </button>{" "}
          <button type="button" disabled>
            Test connection (outline)
          </button>
        </section>
      ))}
      <p>Note: this page is a shell. Configure/test wiring lands with each provider in Steps 20/22/26.</p>
    </main>
  );
}
