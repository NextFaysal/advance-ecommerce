/**
 * POST /api/v1/admin/connectors/test — ADV-25 part 2.
 *
 * Body: { channel: "slack" | "telegram" | "sheets" }.
 * Performs ONE REAL test attempt through the named channel
 * (src/connectors sendConnectorTest): a real Slack webhook POST, a
 * real Telegram sendMessage, or a real Sheets append of a TEST row.
 * The outcome is recorded in the connectors.attempts ledger and the
 * verbatim result is returned — nothing is faked:
 *   sent           -> 200 { data: { channel, status: "sent", at } }
 *   not configured -> 422 { error: { code: "NOT_CONFIGURED", ... } }
 *   provider refused/unreachable -> 502 { error: { code, message } }
 * Requires settings.integrations (same bar as the settings test
 * route). No credential value is ever returned.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { validateSessionToken } from "@/lib/auth";
import { hasPermission } from "@/lib/rbac";
import { sendConnectorTest } from "@/connectors/notify";
import { CONNECTOR_CHANNELS, type ConnectorChannel } from "@/connectors/types";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  channel: z.enum(CONNECTOR_CHANNELS),
});

export async function POST(req: Request) {
  const token = cookies().get("admin_session")?.value;
  if (!token) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Login required." } },
      { status: 401 },
    );
  }
  const session = await validateSessionToken(token).catch(() => null);
  if (!session) {
    return NextResponse.json(
      { error: { code: "DB_NOT_READY", message: "Session validation unavailable (Prisma pending)." } },
      { status: 503 },
    );
  }
  if (!hasPermission(session.user.permissions, "settings.integrations")) {
    return NextResponse.json(
      { error: { code: "FORBIDDEN", message: "settings.integrations permission required." } },
      { status: 403 },
    );
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Unknown connector channel." } },
      { status: 400 },
    );
  }
  const channel: ConnectorChannel = parsed.data.channel;

  const record = await sendConnectorTest(channel);
  if (record.status === "sent") {
    return NextResponse.json({
      data: { channel, status: "sent", at: record.at, message: "টেস্ট পাঠানো হয়েছে (আসল প্রোভাইডার কল)। / Test sent (real provider call)." },
    });
  }
  if (record.status === "not_configured") {
    return NextResponse.json(
      {
        error: {
          code: "NOT_CONFIGURED",
          message: `${channel} is not configured — ${record.detail ?? "credentials missing."}`,
        },
      },
      { status: 422 },
    );
  }
  return NextResponse.json(
    {
      error: {
        code: (record.errorCode ?? "send_failed").toUpperCase(),
        message: record.detail ?? `${channel} test failed (${record.errorCode ?? "unknown"}).`,
      },
    },
    { status: 502 },
  );
}
