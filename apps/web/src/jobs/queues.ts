// BullMQ queue contracts — Step 17/22/26/31 jobs.
// Slow/external work must go through these queues, never block a request.
// This file defines queue names, job payload types, and retry policy only.
// Workers that call real SMS/email/courier/payment APIs are implemented in
// the jobs worker process ( separate deployment ), using the adapters in
// src/integrations. Payloads must never contain a secret or a full phone
// number in plain text in logs — use masked refs / ids only.

export const QUEUE_NAMES = {
  sms: "sms-send",
  email: "email-send",
  courierBooking: "courier-booking",
  courierSync: "courier-status-sync",
  webhook: "webhook-delivery",
  importExport: "import-export",
  report: "report-generation",
  notificationRetry: "notification-retry",
  abandonedCart: "abandoned-cart-followup",
  automation: "automation-run",
  bulkActions: "bulk-actions",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface JobRetryPolicy {
  attempts: number;
  backoffSeconds: number;
}

export const DEFAULT_RETRY: JobRetryPolicy = { attempts: 3, backoffSeconds: 30 };
export const COURIER_RETRY: JobRetryPolicy = { attempts: 5, backoffSeconds: 60 };

export interface SmsJob { orderId?: string; templateKey: string; recipientRef: string; }
export interface EmailJob { orderId?: string; templateKey: string; recipientRef: string; }
export interface CourierBookingJob { orderId: string; shipmentId: string; provider: string; }
export interface WebhookJob { event: string; payloadId: string; }
