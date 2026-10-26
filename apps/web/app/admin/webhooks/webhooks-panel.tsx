"use client";

/**
 * Webhooks + API keys panel (ADV-26) — self-fetching admin panel over
 * /api/v1/admin/webhooks/**.
 *
 * Three sections:
 *  1. Endpoints — create (signing secret shown ONCE in the success
 *     block), enable/disable, test ping, delete.
 *  2. Delivery log — durable WebhookDelivery rows with a status
 *     filter, response code/attempts, and a redeliver button for
 *     anything not SENT. SENT means the target really answered 2xx.
 *  3. API keys — create (plaintext shown ONCE), list by prefix +
 *     scopes, revoke.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface EndpointView {
  id: string;
  name: string;
  url: string;
  events: string[];
  secretPrefix: string;
  enabled: boolean;
  createdAt: string;
}

interface CreatedEndpoint extends EndpointView {
  secret: string;
}

interface DeliveryView {
  id: string;
  endpointId: string;
  event: string;
  entityId: string | null;
  status: string;
  attempts: number;
  responseCode: number | null;
  responseSnippet: string | null;
  lastError: string | null;
  nextRetryAt: string | null;
  createdAt: string;
}

interface ApiKeyView {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

interface CreatedApiKey extends ApiKeyView {
  key: string;
}

const DELIVERY_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  SENT: "success",
  PENDING: "neutral",
  FAILED: "warning",
  DEAD: "danger",
};

const dateFmt = new Intl.DateTimeFormat("bn-BD", {
  timeZone: "Asia/Dhaka",
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as {
    data?: T;
    error?: { code: string; message: string };
  };
  if (!res.ok || body.error) {
    throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  }
  return body.data as T;
}

export function WebhooksPanel() {
  const [endpoints, setEndpoints] = useState<EndpointView[] | null>(null);
  const [catalogue, setCatalogue] = useState<string[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryView[] | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [apiKeys, setApiKeys] = useState<ApiKeyView[] | null>(null);
  const [scopeCatalogue, setScopeCatalogue] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // create-endpoint form
  const [epName, setEpName] = useState("");
  const [epUrl, setEpUrl] = useState("");
  const [epEvents, setEpEvents] = useState<string[]>(["order.created"]);
  const [createdEndpoint, setCreatedEndpoint] = useState<CreatedEndpoint | null>(null);

  // create-key form
  const [keyName, setKeyName] = useState("");
  const [keyScopes, setKeyScopes] = useState<string[]>(["products:read"]);
  const [createdKey, setCreatedKey] = useState<CreatedApiKey | null>(null);

  const loadEndpoints = useCallback(async () => {
    const data = await api<{ endpoints: EndpointView[]; eventCatalogue: string[] }>(
      "/api/v1/admin/webhooks/endpoints",
    );
    setEndpoints(data.endpoints);
    setCatalogue(data.eventCatalogue);
  }, []);

  const loadDeliveries = useCallback(async () => {
    const q = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
    const data = await api<{ deliveries: DeliveryView[] }>(`/api/v1/admin/webhooks/deliveries${q}`);
    setDeliveries(data.deliveries);
  }, [statusFilter]);

  const loadKeys = useCallback(async () => {
    const data = await api<{ apiKeys: ApiKeyView[]; scopeCatalogue: string[] }>(
      "/api/v1/admin/webhooks/api-keys",
    );
    setApiKeys(data.apiKeys);
    setScopeCatalogue(data.scopeCatalogue);
  }, []);

  const reload = useCallback(async () => {
    try {
      setError("");
      await Promise.all([loadEndpoints(), loadDeliveries(), loadKeys()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "লোড করা যায়নি");
    }
  }, [loadEndpoints, loadDeliveries, loadKeys]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void loadDeliveries().catch(() => undefined);
  }, [loadDeliveries]);

  const toggleEvent = (event: string, list: string[], set: (v: string[]) => void) => {
    set(list.includes(event) ? list.filter((e) => e !== event) : [...list, event]);
  };

  const onCreateEndpoint = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setNotice("");
    try {
      const data = await api<{ endpoint: CreatedEndpoint }>("/api/v1/admin/webhooks/endpoints", {
        method: "POST",
        body: JSON.stringify({ name: epName, url: epUrl, events: epEvents }),
      });
      setCreatedEndpoint(data.endpoint);
      setEpName("");
      setEpUrl("");
      await loadEndpoints();
    } catch (e) {
      setError(e instanceof Error ? e.message : "তৈরি করা যায়নি");
    }
  };

  const onPatchEndpoint = async (id: string, patch: Record<string, unknown>) => {
    try {
      await api(`/api/v1/admin/webhooks/endpoints/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await loadEndpoints();
    } catch (e) {
      setError(e instanceof Error ? e.message : "আপডেট করা যায়নি");
    }
  };

  const onDeleteEndpoint = async (id: string) => {
    if (!window.confirm("এন্ডপয়েন্টটি মুছে ফেলবেন? এর ডেলিভারি লগও মুছে যাবে।")) return;
    try {
      await api(`/api/v1/admin/webhooks/endpoints/${id}`, { method: "DELETE" });
      await Promise.all([loadEndpoints(), loadDeliveries()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "মোছা যায়নি");
    }
  };

  const onTestPing = async (id: string) => {
    setNotice("");
    try {
      const data = await api<{ delivery: DeliveryView | null }>(
        `/api/v1/admin/webhooks/endpoints/${id}/test`,
        { method: "POST", body: "{}" },
      );
      setNotice(
        data.delivery
          ? `টেস্ট পিং: ${data.delivery.status}${data.delivery.responseCode ? ` (HTTP ${data.delivery.responseCode})` : ""}`
          : "টেস্ট পিং তৈরি হয়েছে",
      );
      await loadDeliveries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "টেস্ট পিং পাঠানো যায়নি");
    }
  };

  const onRedeliver = async (id: string) => {
    try {
      await api(`/api/v1/admin/webhooks/deliveries/${id}/redeliver`, { method: "POST", body: "{}" });
      await loadDeliveries();
    } catch (e) {
      setError(e instanceof Error ? e.message : "আবার পাঠানো যায়নি");
    }
  };

  const onCreateKey = async (ev: React.FormEvent) => {
    ev.preventDefault();
    try {
      const data = await api<{ apiKey: CreatedApiKey }>("/api/v1/admin/webhooks/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: keyName, scopes: keyScopes }),
      });
      setCreatedKey(data.apiKey);
      setKeyName("");
      await loadKeys();
    } catch (e) {
      setError(e instanceof Error ? e.message : "কী তৈরি করা যায়নি");
    }
  };

  const onRevokeKey = async (id: string) => {
    if (!window.confirm("কীটি বাতিল করবেন? এটি আর ব্যবহার করা যাবে না।")) return;
    try {
      await api(`/api/v1/admin/webhooks/api-keys/${id}/revoke`, { method: "POST", body: "{}" });
      await loadKeys();
    } catch (e) {
      setError(e instanceof Error ? e.message : "বাতিল করা যায়নি");
    }
  };

  return (
    <div className="space-y-8">
      {error ? (
        <p className="rounded-lg border border-border bg-surface-2/50 px-4 py-3 text-small text-danger">{error}</p>
      ) : null}
      {notice ? (
        <p className="rounded-lg border border-border bg-surface-2/50 px-4 py-3 text-small text-text-main">{notice}</p>
      ) : null}

      {/* ------------------------------------------------ endpoints */}
      <section className="rounded-lg border border-border bg-surface-2/50 px-4 py-4">
        <h2 className="text-body font-semibold text-text-main">নতুন এন্ডপয়েন্ট</h2>
        <form onSubmit={onCreateEndpoint} className="mt-3 space-y-3">
          <div className="flex flex-wrap gap-3">
            <label className="block">
              <span className="mb-1 block text-caption text-text-subtle">নাম</span>
              <Input value={epName} onChange={(e) => setEpName(e.target.value)} required className="w-56" placeholder="যেমন: ERP সিঙ্ক" />
            </label>
            <label className="block grow">
              <span className="mb-1 block text-caption text-text-subtle">URL (https://…)</span>
              <Input value={epUrl} onChange={(e) => setEpUrl(e.target.value)} required className="w-full min-w-64" placeholder="https://example.com/webhooks" />
            </label>
          </div>
          <fieldset>
            <legend className="mb-1 text-caption text-text-subtle">ইভেন্টসমূহ</legend>
            <div className="flex flex-wrap gap-2">
              {catalogue.map((event) => (
                <label key={event} className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-small">
                  <input
                    type="checkbox"
                    checked={epEvents.includes(event)}
                    onChange={() => toggleEvent(event, epEvents, setEpEvents)}
                  />
                  <span className="font-mono text-xs">{event}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit">এন্ডপয়েন্ট তৈরি করুন</Button>
        </form>
        {createdEndpoint ? (
          <div className="mt-4 rounded-md border border-border bg-card px-3 py-3">
            <p className="text-small font-semibold text-text-main">
              সাইনিং সিক্রেট — এখনই কপি করুন, পরে আর দেখা যাবে না:
            </p>
            <code className="mt-1 block break-all rounded bg-surface-2 px-2 py-1.5 font-mono text-xs">{createdEndpoint.secret}</code>
            <p className="mt-1 text-caption text-text-subtle">
              রিসিভার এই সিক্রেট দিয়ে X-AE-Signature (HMAC-SHA256, raw body) যাচাই করবে।
            </p>
          </div>
        ) : null}
      </section>

      <section>
        <h2 className="mb-2 text-body font-semibold text-text-main">এন্ডপয়েন্টসমূহ</h2>
        {endpoints === null ? (
          <p className="text-small text-text-muted">লোড হচ্ছে…</p>
        ) : endpoints.length === 0 ? (
          <p className="text-small text-text-muted">কোনো এন্ডপয়েন্ট নেই।</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-small">
              <thead>
                <tr className="border-b border-border bg-surface-2/60 text-caption text-text-subtle">
                  <th className="px-3 py-2">নাম</th>
                  <th className="px-3 py-2">URL</th>
                  <th className="px-3 py-2">ইভেন্ট</th>
                  <th className="px-3 py-2">সিক্রেট</th>
                  <th className="px-3 py-2">অবস্থা</th>
                  <th className="px-3 py-2">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody>
                {endpoints.map((ep) => (
                  <tr key={ep.id} className="border-b border-border/60 align-top">
                    <td className="px-3 py-2 font-medium">{ep.name}</td>
                    <td className="max-w-64 break-all px-3 py-2 font-mono text-xs">{ep.url}</td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-xs">{ep.events.join(", ")}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{ep.secretPrefix}</td>
                    <td className="px-3 py-2">
                      <Badge tone={ep.enabled ? "success" : "neutral"}>{ep.enabled ? "সক্রিয়" : "বন্ধ"}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => void onTestPing(ep.id)}>টেস্ট পিং</Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void onPatchEndpoint(ep.id, { enabled: !ep.enabled })}
                        >
                          {ep.enabled ? "বন্ধ করুন" : "চালু করুন"}
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => void onDeleteEndpoint(ep.id)}>মুছুন</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------ deliveries */}
      <section>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <h2 className="text-body font-semibold text-text-main">ডেলিভারি লগ</h2>
          <label className="flex items-center gap-2 text-small text-text-muted">
            স্ট্যাটাস
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-border bg-card px-2 py-1 text-small"
            >
              <option value="">সব</option>
              <option value="PENDING">PENDING</option>
              <option value="SENT">SENT</option>
              <option value="FAILED">FAILED</option>
              <option value="DEAD">DEAD</option>
            </select>
          </label>
          <Button size="sm" variant="outline" onClick={() => void loadDeliveries()}>রিফ্রেশ</Button>
        </div>
        {deliveries === null ? (
          <p className="text-small text-text-muted">লোড হচ্ছে…</p>
        ) : deliveries.length === 0 ? (
          <p className="text-small text-text-muted">কোনো ডেলিভারি নেই।</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-small">
              <thead>
                <tr className="border-b border-border bg-surface-2/60 text-caption text-text-subtle">
                  <th className="px-3 py-2">সময়</th>
                  <th className="px-3 py-2">ইভেন্ট</th>
                  <th className="px-3 py-2">স্ট্যাটাস</th>
                  <th className="px-3 py-2">চেষ্টা</th>
                  <th className="px-3 py-2">রেসপন্স</th>
                  <th className="px-3 py-2">ত্রুটি / পরের চেষ্টা</th>
                  <th className="px-3 py-2">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id} className="border-b border-border/60 align-top">
                    <td className="whitespace-nowrap px-3 py-2">{formatDate(d.createdAt)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{d.event}</td>
                    <td className="px-3 py-2">
                      <Badge tone={DELIVERY_TONE[d.status] ?? "neutral"}>{d.status}</Badge>
                    </td>
                    <td className="px-3 py-2">{d.attempts}</td>
                    <td className="px-3 py-2">
                      {d.responseCode ?? "—"}
                      {d.responseSnippet ? (
                        <span className="block max-w-48 truncate font-mono text-xs text-text-subtle" title={d.responseSnippet}>
                          {d.responseSnippet}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-muted">
                      {d.lastError ?? ""}
                      {d.nextRetryAt ? <span className="block">পরের চেষ্টা: {formatDate(d.nextRetryAt)}</span> : null}
                    </td>
                    <td className="px-3 py-2">
                      {d.status !== "SENT" ? (
                        <Button size="sm" variant="outline" onClick={() => void onRedeliver(d.id)}>আবার পাঠান</Button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ------------------------------------------------ api keys */}
      <section className="rounded-lg border border-border bg-surface-2/50 px-4 py-4">
        <h2 className="text-body font-semibold text-text-main">পার্টনার API কী</h2>
        <p className="mt-1 text-small text-text-muted">
          পার্টনাররা <code className="font-mono text-xs">GET /api/v1/partner/products</code> ও{" "}
          <code className="font-mono text-xs">GET /api/v1/partner/orders</code> কল করবে{" "}
          <code className="font-mono text-xs">Authorization: Bearer ae_live_…</code> দিয়ে। প্রোডাক্টে কস্ট প্রাইস ও অর্ডারে ফোন (মাস্ক করা) ছাড়া ব্যক্তিগত তথ্য থাকে না।
        </p>
        <form onSubmit={onCreateKey} className="mt-3 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1 block text-caption text-text-subtle">নাম</span>
              <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} required className="w-56" placeholder="যেমন: হিসাব সফটওয়্যার" />
            </label>
            <fieldset>
              <legend className="mb-1 text-caption text-text-subtle">স্কোপ</legend>
              <div className="flex flex-wrap gap-2">
                {scopeCatalogue.map((scope) => (
                  <label key={scope} className="flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-small">
                    <input
                      type="checkbox"
                      checked={keyScopes.includes(scope)}
                      onChange={() => toggleEvent(scope, keyScopes, setKeyScopes)}
                    />
                    <span className="font-mono text-xs">{scope}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <Button type="submit">কী তৈরি করুন</Button>
          </div>
        </form>
        {createdKey ? (
          <div className="mt-4 rounded-md border border-border bg-card px-3 py-3">
            <p className="text-small font-semibold text-text-main">API কী — এখনই কপি করুন, পরে আর দেখা যাবে না:</p>
            <code className="mt-1 block break-all rounded bg-surface-2 px-2 py-1.5 font-mono text-xs">{createdKey.key}</code>
          </div>
        ) : null}
        {apiKeys === null ? (
          <p className="mt-3 text-small text-text-muted">লোড হচ্ছে…</p>
        ) : apiKeys.length === 0 ? (
          <p className="mt-3 text-small text-text-muted">কোনো কী নেই।</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-left text-small">
              <thead>
                <tr className="border-b border-border bg-surface-2/60 text-caption text-text-subtle">
                  <th className="px-3 py-2">নাম</th>
                  <th className="px-3 py-2">প্রিফিক্স</th>
                  <th className="px-3 py-2">স্কোপ</th>
                  <th className="px-3 py-2">শেষ ব্যবহার</th>
                  <th className="px-3 py-2">অবস্থা</th>
                  <th className="px-3 py-2">অ্যাকশন</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((k) => (
                  <tr key={k.id} className="border-b border-border/60 align-top">
                    <td className="px-3 py-2 font-medium">{k.name}</td>
                    <td className="px-3 py-2 font-mono text-xs">{k.keyPrefix}…</td>
                    <td className="px-3 py-2 font-mono text-xs">{k.scopes.join(", ")}</td>
                    <td className="px-3 py-2">{formatDate(k.lastUsedAt)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={k.revokedAt ? "danger" : "success"}>{k.revokedAt ? "বাতিল" : "সক্রিয়"}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      {k.revokedAt ? (
                        "—"
                      ) : (
                        <Button size="sm" variant="destructive" onClick={() => void onRevokeKey(k.id)}>বাতিল করুন</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
