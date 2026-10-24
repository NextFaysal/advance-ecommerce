"use client";

// One-Click Flow panel — Confirm → Print label → Book courier → Send SMS.
// Runs the steps in order using src/orders/one-click-flow.ts state:
//  - Confirm: PATCH /api/v1/admin/orders/[id] { to: "CONFIRMED" } — the
//    server runs the state machine and PERSISTS (invalid transitions
//    come back 422). From PENDING it confirms; an already-confirmed
//    order counts as done; a rejected confirm fails the step and stops
//    the flow.
//  - Print label: builds the label data (print.ts) — the preview/print UI
//    is the PrintPanel next to this panel.
//  - Book courier: SANDBOX booking via POST /api/v1/admin/shipments
//    (Agent 9 sandbox adapter, SBX- tracking ids, no real courier is
//    contacted). Any API failure (401/503/network) follows the module's
//    failure policy: the step is QUEUED for retry and the API's own
//    message is shown — completed steps are never rolled back.
//  - Send SMS: no SMS-send endpoint is wired yet, so the step is QUEUED
//    (BullMQ) exactly as one-click-flow.ts prescribes. It is never shown
//    as "sent".
// The operator can re-run the whole flow (it resumes at the first step
// that is not done) or retry a single failed/queued step.
import { useState } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { displayPhone } from "../customer";
import { initialOneClickFlow, ONE_CLICK_STEPS, setFlowStep } from "../one-click-flow";
import type { FlowStepId, FlowStepStatus, OneClickFlowState } from "../one-click-flow";
import { buildPrintData } from "../print";
import type { Order } from "../types";

const STEP_LABEL_BN: Record<FlowStepId, string> = {
  confirm: "অর্ডার কনফার্ম",
  print_label: "লেবেল তৈরি",
  book_courier: "কুরিয়ার বুকিং",
  send_sms: "SMS পাঠানো",
};

const STATUS_UI: Record<FlowStepStatus, { label: string; tone: "success" | "warning" | "danger" | "info" | "neutral" }> = {
  pending: { label: "অপেক্ষমাণ", tone: "neutral" },
  running: { label: "চলছে…", tone: "info" },
  done: { label: "✓ সম্পন্ন", tone: "success" },
  failed: { label: "✕ ব্যর্থ", tone: "danger" },
  queued: { label: "◷ কিউতে (রিট্রাই হবে)", tone: "warning" },
};

const SANDBOX_PROVIDERS = ["steadfast", "pathao", "redx"] as const;
type SandboxProvider = (typeof SANDBOX_PROVIDERS)[number];

function sandboxProviderFor(courier: string | undefined): SandboxProvider {
  const name = (courier ?? "").toLowerCase();
  return (SANDBOX_PROVIDERS as readonly string[]).includes(name) ? (name as SandboxProvider) : "steadfast";
}

type BookResponse =
  | { data: { trackingId: string; shipmentId: string; status: string }; meta?: { sandbox?: boolean } }
  | { error: { code: string; message: string } };

export function OneClickPanel({
  order,
  onOrderChange,
}: {
  order: Order;
  onOrderChange: (order: Order) => void;
}) {
  const [flow, setFlow] = useState<OneClickFlowState | null>(null);
  const [notes, setNotes] = useState<Partial<Record<FlowStepId, string>>>({});
  const [running, setRunning] = useState(false);

  function note(step: FlowStepId, text: string) {
    setNotes((prev) => ({ ...prev, [step]: text }));
  }

  /** Execute one step against the current order; returns the order to use for the next step. */
  async function runStep(
    step: FlowStepId,
    current: OneClickFlowState,
    currentOrder: Order,
  ): Promise<{ flow: OneClickFlowState; order: Order; ok: boolean }> {
    let f = setFlowStep(current, step, "running");
    setFlow(f);

    if (step === "confirm") {
      const alreadyConfirmed = ["CONFIRMED", "PROCESSING", "PACKED", "SHIPPED", "DELIVERED"].includes(currentOrder.status);
      if (alreadyConfirmed) {
        note(step, "অর্ডার আগেই কনফার্ম করা ছিল।");
        f = setFlowStep(f, step, "done");
        setFlow(f);
        return { flow: f, order: currentOrder, ok: true };
      }
      try {
        const res = await fetch(`/api/v1/admin/orders/${encodeURIComponent(currentOrder.id)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ to: "CONFIRMED" }),
        });
        const body = (await res.json().catch(() => null)) as
          | { data: Order }
          | { error: { code: string; message: string } }
          | null;
        if (res.ok && body && "data" in body) {
          onOrderChange(body.data);
          note(step, "API দিয়ে কনফার্ম হয়েছে — স্টেট মেশিন যাচাই করে DB-তে সংরক্ষিত হয়েছে।");
          f = setFlowStep(f, step, "done");
          setFlow(f);
          return { flow: f, order: body.data, ok: true };
        }
        const message = body && "error" in body ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`;
        note(step, `কনফার্ম ব্যর্থ: ${message} — কিছুই সেভ হয়নি।`);
        f = setFlowStep(f, step, "failed", message);
        setFlow(f);
        return { flow: f, order: currentOrder, ok: false };
      } catch {
        note(step, "কনফার্ম ব্যর্থ: নেটওয়ার্ক ত্রুটি — API-তে পৌঁছানো যায়নি, কিছুই সেভ হয়নি।");
        f = setFlowStep(f, step, "failed", "network error");
        setFlow(f);
        return { flow: f, order: currentOrder, ok: false };
      }
    }

    if (step === "print_label") {
      const label = buildPrintData(currentOrder, "courier_label", "THERMAL_80", displayPhone(currentOrder.customerPhone, false));
      note(step, `লেবেল ডেটা তৈরি: ${label.orderNo} · বারকোড ${label.barcodeValue} — প্রিন্ট প্যানেলে প্রিভিউ দেখুন।`);
      f = setFlowStep(f, step, "done");
      setFlow(f);
      return { flow: f, order: currentOrder, ok: true };
    }

    if (step === "book_courier") {
      if (currentOrder.trackingId) {
        note(step, `আগেই বুক করা আছে — ট্র্যাকিং: ${currentOrder.trackingId}`);
        f = setFlowStep(f, step, "done");
        setFlow(f);
        return { flow: f, order: currentOrder, ok: true };
      }
      const provider = sandboxProviderFor(currentOrder.courier);
      try {
        const res = await fetch("/api/v1/admin/shipments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orderId: currentOrder.id,
            provider,
            address: {
              recipientName: currentOrder.customerName,
              recipientPhone: currentOrder.customerPhone,
              division: currentOrder.address.division,
              district: currentOrder.address.district,
              upazila: currentOrder.address.upazila,
              union: currentOrder.address.union ?? null,
              addressLine: currentOrder.address.addressLine,
            },
            codAmountPoisha: currentOrder.paymentMethod === "cod" ? currentOrder.totalPoisha : 0,
            weightGrams: Math.max(100, currentOrder.items.reduce((sum, i) => sum + i.quantity, 0) * 500),
            itemCount: Math.max(1, currentOrder.items.reduce((sum, i) => sum + i.quantity, 0)),
            note: null,
            idempotencyKey: `oneclick-${currentOrder.id}`,
          }),
        });
        const body = (await res.json().catch(() => null)) as BookResponse | null;
        if (res.ok && body && "data" in body) {
          const booked: Order = { ...currentOrder, courier: provider, trackingId: body.data.trackingId };
          onOrderChange(booked);
          note(step, `SANDBOX বুকিং হয়েছে (${provider}) — ট্র্যাকিং: ${body.data.trackingId}। আসল কুরিয়ারে কিছু পাঠানো হয়নি।`);
          f = setFlowStep(f, step, "done");
          setFlow(f);
          return { flow: f, order: booked, ok: true };
        }
        const message =
          body && "error" in body
            ? `${body.error.code}: ${body.error.message}`
            : `HTTP ${res.status}`;
        note(step, `বুকিং API উত্তর দিয়েছে: ${message} — ধাপটি কিউতে রাখা হলো, পরে আবার চেষ্টা করা যাবে। আগের ধাপগুলো আগের মতোই থাকবে।`);
        f = setFlowStep(f, step, "queued", message);
        setFlow(f);
        return { flow: f, order: currentOrder, ok: false };
      } catch {
        note(step, "বুকিং API-তে পৌঁছানো যায়নি (নেটওয়ার্ক) — ধাপটি কিউতে রাখা হলো। আগের ধাপগুলো আগের মতোই থাকবে।");
        f = setFlowStep(f, step, "queued", "network error");
        setFlow(f);
        return { flow: f, order: currentOrder, ok: false };
      }
    }

    // send_sms — no SMS send endpoint/queue worker is wired yet.
    note(step, "SMS জব কিউতে রাখা হলো (BullMQ wiring বাকি) — এখনো কোনো SMS পাঠানো হয়নি।");
    f = setFlowStep(f, step, "queued", "SMS queue not wired yet");
    setFlow(f);
    return { flow: f, order: currentOrder, ok: false };
  }

  async function runFrom(startStep: FlowStepId | null) {
    if (running) return;
    const base = flow ?? initialOneClickFlow(order.id);
    if (!flow) setFlow(base);
    setRunning(true);
    let f = base;
    let currentOrder = order;
    const startIdx = startStep ? ONE_CLICK_STEPS.findIndex((s) => s.id === startStep) : 0;
    for (let i = startIdx; i < ONE_CLICK_STEPS.length; i++) {
      const step = ONE_CLICK_STEPS[i];
      if (!step) continue;
      if (step.id !== startStep && f.steps[step.id] === "done") continue;
      const result = await runStep(step.id, f, currentOrder);
      f = result.flow;
      currentOrder = result.order;
      if (!result.ok) break;
    }
    setRunning(false);
  }

  return (
    <Card>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">⚡ One-Click Flow</h2>
        <Button type="button" size="sm" variant="gradient" loading={running} onClick={() => void runFrom(null)}>
          {flow ? "বাকি ধাপগুলো চালান" : "One-Click Flow চালান"}
        </Button>
      </div>
      <p className="mb-4 text-xs text-text-muted">
        Confirm → লেবেল → কুরিয়ার বুকিং → SMS। কুরিয়ার বুকিং SANDBOX (SBX- ট্র্যাকিং, আসল কুরিয়ার নয়)।
        কোনো ধাপ ব্যর্থ হলে সেটি কিউতে থাকে — সম্পন্ন ধাপ কখনো রোলব্যাক হয় না।
      </p>
      <ol className="space-y-3">
        {ONE_CLICK_STEPS.map((step) => {
          const status: FlowStepStatus = flow?.steps[step.id] ?? "pending";
          const ui = STATUS_UI[status];
          return (
            <li key={step.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  {STEP_LABEL_BN[step.id]} <span className="text-text-muted">({step.label})</span>
                </p>
                {notes[step.id] && <p className="mt-0.5 max-w-xl text-xs text-text-muted">{notes[step.id]}</p>}
              </div>
              <span className="flex items-center gap-2">
                <Badge tone={ui.tone}>{ui.label}</Badge>
                {(status === "failed" || status === "queued") && (
                  <Button type="button" size="sm" variant="outline" disabled={running} onClick={() => void runFrom(step.id)}>
                    আবার চেষ্টা
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
