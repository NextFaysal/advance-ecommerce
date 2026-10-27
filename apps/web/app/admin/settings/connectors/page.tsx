import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { getSetting } from "@/lib/settings";
import { listConnectorAttempts } from "@/connectors/ledger";
import { parseServiceAccount } from "@/connectors/sheets";
import {
  ConnectorsCard,
  type ConnectorChannelInitial,
  type ConnectorsInitial,
} from "./connectors-card";
import { getRequestLocale } from "@/i18n/server";
import { pick } from "@/i18n/locale";
import { SETTINGS_B_STRINGS } from "../strings-b";

// Admin > Settings > Connectors — outbound connectors (ADV-25 part 2,
// doc 22): Slack, Telegram and Google Sheets fan-out on order / stock
// lifecycle events (src/connectors/*). This page edits the keys the
// fan-out reads at send time:
//   connectors.slack.enabled / webhook_url (secret) / events
//   connectors.telegram.enabled / bot_token (secret) / chat_id /
//     api_base / events
//   connectors.sheets.enabled / service_account_json (secret) /
//     spreadsheet_id / sheet_name
// Secret VALUES never reach this page's props — only presence
// booleans (plus the service account's client_email, which is an
// identifier, not the key). Credential inputs in the card are
// write-only: blank = keep the stored value. Saves go through the
// standard Settings API (reason required, audited, secrets encrypted
// at rest). A channel sends for real only when enabled AND fully
// credentialed; otherwise the fan-out records NOT_CONFIGURED with the
// missing keys named — the attempts ledger below shows exactly what
// happened, attempt by attempt.
export const dynamic = "force-dynamic";

async function presence(key: string): Promise<boolean> {
  return ((await getSetting(key)) ?? "").trim() !== "";
}

async function value(key: string): Promise<string> {
  return ((await getSetting(key)) ?? "").trim();
}

async function channelInitial(
  build: () => Promise<ConnectorChannelInitial>,
  fallback: ConnectorChannelInitial,
  onError: () => void,
): Promise<ConnectorChannelInitial> {
  try {
    return await build();
  } catch {
    onError();
    return fallback;
  }
}

export default async function ConnectorsSettingsPage() {
  const locale = await getRequestLocale();
  const s = pick(locale, SETTINGS_B_STRINGS);
  let dbReady = true;
  const markDbError = () => {
    dbReady = false;
  };
  let attempts: Awaited<ReturnType<typeof listConnectorAttempts>> = [];
  try {
    attempts = await listConnectorAttempts(15);
  } catch {
    dbReady = false;
  }

  const slack = await channelInitial(
    async () => ({
      enabled: (await value("connectors.slack.enabled")) === "true",
      events: await value("connectors.slack.events"),
      present: { webhook_url: await presence("connectors.slack.webhook_url") },
      values: {},
    }),
    { enabled: false, events: "", present: {}, values: {} },
    markDbError,
  );
  const telegram = await channelInitial(
    async () => ({
      enabled: (await value("connectors.telegram.enabled")) === "true",
      events: await value("connectors.telegram.events"),
      present: { bot_token: await presence("connectors.telegram.bot_token") },
      values: {
        chat_id: await value("connectors.telegram.chat_id"),
        api_base: await value("connectors.telegram.api_base"),
      },
    }),
    { enabled: false, events: "", present: {}, values: {} },
    markDbError,
  );
  const sheets = await channelInitial(
    async () => {
      const json = await value("connectors.sheets.service_account_json");
      const account = json === "" ? null : parseServiceAccount(json);
      return {
        enabled: (await value("connectors.sheets.enabled")) === "true",
        events: "",
        present: { service_account_json: json !== "" },
        values: {
          spreadsheet_id: await value("connectors.sheets.spreadsheet_id"),
          sheet_name: await value("connectors.sheets.sheet_name"),
        },
        serviceAccountEmail: account?.clientEmail ?? "",
        serviceAccountValid: account !== null,
      };
    },
    { enabled: false, events: "", present: {}, values: {} },
    markDbError,
  );

  const initial: ConnectorsInitial = { slack, telegram, sheets, attempts };

  return (
    <main className="min-w-0">
      <PageHeader
        title={s.connPageTitle}
        description={s.connPageDesc}
        breadcrumb={s.connBreadcrumb}
        actions={
          <Link
            href="/admin/settings"
            className="inline-flex min-h-[44px] items-center rounded-md border border-border bg-card px-4 text-sm font-medium transition motion-fast hover:border-brand-300"
          >
            {s.allSettings}
          </Link>
        }
      />

      <div className="mt-4">
        <ConnectorsCard initial={initial} dbReady={dbReady} />
      </div>
    </main>
  );
}
