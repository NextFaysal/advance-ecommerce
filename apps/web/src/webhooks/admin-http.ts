/**
 * Shared error mapping for the /api/v1/admin/webhooks routes —
 * ADV-26 (doc 22). Service-layer errors carry machine codes
 * (UNKNOWN_EVENT:x, NO_EVENTS, UNKNOWN_SCOPE:x, NO_SCOPES) and the
 * SSRF guard throws WebhookUrlError; both become 400s with honest
 * messages. Secrets never appear in any error path.
 */
import { NextResponse } from "next/server";
import { WebhookUrlError } from "./ssrf";

export function webhookAdminError(error: unknown): NextResponse {
  if (error instanceof WebhookUrlError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      { status: 400 },
    );
  }
  if (error instanceof Error) {
    if (error.message.startsWith("UNKNOWN_EVENT:")) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: `Unknown webhook event: ${error.message.slice("UNKNOWN_EVENT:".length)}`,
          },
        },
        { status: 400 },
      );
    }
    if (error.message === "NO_EVENTS") {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "At least one event is required." } },
        { status: 400 },
      );
    }
    if (error.message.startsWith("UNKNOWN_SCOPE:")) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: `Unknown API key scope: ${error.message.slice("UNKNOWN_SCOPE:".length)}`,
          },
        },
        { status: 400 },
      );
    }
    if (error.message === "NO_SCOPES") {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "At least one scope is required." } },
        { status: 400 },
      );
    }
  }
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Unexpected error." } },
    { status: 500 },
  );
}

export function validationError(details: string[]): NextResponse {
  return NextResponse.json(
    { error: { code: "VALIDATION_ERROR", message: "Input invalid.", details } },
    { status: 400 },
  );
}

export function notFound(what: string): NextResponse {
  return NextResponse.json(
    { error: { code: "NOT_FOUND", message: `${what} not found.` } },
    { status: 404 },
  );
}
