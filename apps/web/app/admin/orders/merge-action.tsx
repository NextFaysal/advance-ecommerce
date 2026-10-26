"use client";

// Order merge action — ADV-19 (doc 22). Mounted beside the bulk bar on
// /admin/orders; renders only when EXACTLY two orders are selected.
// The dialog asks the API for a dry-run preflight (POST
// /api/v1/admin/orders/merge { dryRun: true }) and shows every guard's
// verdict before staff can commit — the merge itself never deletes an
// order: the source's lines move into the target through the order-edit
// machinery and the source is cancelled with the reason
// "অর্ডার মার্জ: <targetOrderNo>", fully traceable in both timelines.
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Icon } from "@/components/ui/icon";
import { formatBdt } from "../../../src/checkout/pricing";

interface MergeVerdict {
  code: string;
  ok: boolean;
  message: string;
}

interface Preflight {
  ok: boolean;
  verdicts: MergeVerdict[];
  source: { id: string; orderNo: string; status: string } | null;
  target: { id: string; orderNo: string; status: string } | null;
}

interface MergeActionProps {
  /** The current cross-page selection (ids only). */
  selectedIds: string[];
  /** Rows for the selected ids that are loaded on this page — used for
   *  labels and to default the target to the EARLIER order. */
  knownOrders: { id: string; orderNo: string; createdAt: string }[];
  onClear: () => void;
  onDone: () => void;
}

export function MergeAction({ selectedIds, knownOrders, onClear, onDone }: MergeActionProps) {
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState<string>("");
  const [preflight, setPreflight] = useState<Preflight | null>(null);
  const [checking, setChecking] = useState(false);
  const [merging, setMerging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ targetOrderNo: string; sourceOrderNo: string; totalPoisha: number } | null>(null);

  const pair = selectedIds.length === 2 ? selectedIds : null;
  const knownById = useMemo(() => new Map(knownOrders.map((o) => [o.id, o])), [knownOrders]);
  const labelFor = (id: string): string => {
    const known = knownById.get(id)?.orderNo;
    if (known) return known;
    if (preflight?.source?.id === id) return preflight.source.orderNo;
    if (preflight?.target?.id === id) return preflight.target.orderNo;
    return id;
  };

  // Default target = the earlier-created of the two (staff usually
  // merge the duplicate INTO the original). Falls back to the first
  // selected id when a row is not loaded on this page.
  useEffect(() => {
    if (!open || !pair) return;
    const [a, b] = pair;
    const ka = a ? knownById.get(a) : undefined;
    const kb = b ? knownById.get(b) : undefined;
    if (ka && kb) setTargetId(ka.createdAt <= kb.createdAt ? ka.id : kb.id);
    else if (!targetId) setTargetId(a ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  const sourceId = pair?.find((id) => id !== targetId) ?? "";

  useEffect(() => {
    if (!open || !pair || !targetId || done) return;
    let cancelled = false;
    setChecking(true);
    setError(null);
    void fetch("/api/v1/admin/orders/merge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourceOrderId: sourceId, targetOrderId: targetId, dryRun: true }),
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as {
          data?: Preflight;
          error?: { message?: string };
        };
        if (cancelled) return;
        if (!res.ok || !json.data) {
          setPreflight(null);
          setError(json.error?.message ?? `যাচাই করা যায়নি (${res.status})।`);
          return;
        }
        setPreflight(json.data);
      })
      .catch(() => {
        if (!cancelled) {
          setPreflight(null);
          setError("সার্ভারের সঙ্গে যোগাযোগ করা যায়নি — আবার চেষ্টা করুন।");
        }
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, pair, targetId, sourceId, done]);

  async function runMerge() {
    if (!pair || !preflight?.ok || merging) return;
    setMerging(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/admin/orders/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceOrderId: sourceId, targetOrderId: targetId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        data?: { targetOrderNo: string; sourceOrderNo: string; edit: { after: { totalPoisha: number } } };
        error?: { message?: string };
      };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? `মার্জ করা যায়নি (${res.status})।`);
        return;
      }
      setDone({
        targetOrderNo: json.data.targetOrderNo,
        sourceOrderNo: json.data.sourceOrderNo,
        totalPoisha: json.data.edit.after.totalPoisha,
      });
      onDone();
    } catch {
      setError("সার্ভারের সঙ্গে যোগাযোগ করা যায়নি — মার্জ সম্পন্ন হয়নি।");
    } finally {
      setMerging(false);
    }
  }

  function close() {
    setOpen(false);
    if (done) {
      setDone(null);
      onClear();
    }
  }

  if (!pair) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="brand-gradient inline-flex min-h-[44px] items-center gap-2 rounded-md px-4 text-sm font-semibold text-white shadow-md transition motion-fast hover:shadow-lift hover:brightness-105"
      >
        <Icon name="package" size={15} /> দুটি অর্ডার মার্জ করুন
      </button>
      <Modal
        open={open}
        onClose={close}
        title="অর্ডার মার্জ"
        onConfirm={done || !preflight?.ok || checking || merging ? undefined : () => void runMerge()}
      >
        {done ? (
          <div className="space-y-3 text-sm leading-relaxed">
            <p className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800">
              <span aria-hidden="true" className="mt-0.5 shrink-0"><Icon name="check" size={15} /></span>
              <span>
                মার্জ সম্পন্ন: <strong>{done.sourceOrderNo}</strong>-এর সব আইটেম{" "}
                <strong>{done.targetOrderNo}</strong> অর্ডারে যোগ হয়েছে — নতুন মোট{" "}
                <strong>{formatBdt(done.totalPoisha)}</strong>। {done.sourceOrderNo} বাতিল করা হয়েছে
                (কারণ: “অর্ডার মার্জ: {done.targetOrderNo}”) — রেকর্ডটি মোছা হয়নি, টাইমলাইনে পুরো
                বিবরণ আছে।
              </span>
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-text-muted">
              সোর্স অর্ডারের সব আইটেম টার্গেট অর্ডারে যোগ হবে, টার্গেটের মোট তার নিজের প্রাইসিং
              পথে আবার হিসাব হবে, তারপর সোর্স অর্ডারটি “অর্ডার মার্জ” কারণে বাতিল হবে। কোনো
              অর্ডারই মোছা হয় না।
            </p>
            <fieldset className="m-0 space-y-2 border-0 p-0">
              <legend className="mb-1 text-sm font-medium text-text-main">কোন অর্ডারটি থাকবে (টার্গেট)?</legend>
              {pair.map((id) => (
                <label
                  key={id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border px-3.5 py-2.5 text-sm transition motion-fast hover:border-brand-300"
                >
                  <input
                    type="radio"
                    name="merge-target"
                    checked={targetId === id}
                    onChange={() => setTargetId(id)}
                    className="h-4 w-4 shrink-0 accent-brand-600"
                  />
                  <span className="font-mono font-semibold">{labelFor(id)}</span>
                  <span className="text-text-muted">
                    {targetId === id ? "— এতে আইটেম যোগ হবে" : "— এর আইটেম সরে যাবে, এটি বাতিল হবে"}
                  </span>
                </label>
              ))}
            </fieldset>

            <div>
              <h3 className="text-sm font-medium text-text-main">শর্ত যাচাই</h3>
              {checking ? (
                <p className="mt-2 text-sm text-text-muted">যাচাই হচ্ছে…</p>
              ) : preflight ? (
                <ul className="mt-2 space-y-1.5">
                  {preflight.verdicts.map((v) => (
                    <li key={v.code} className="flex items-start gap-2 text-sm leading-relaxed">
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                          v.ok ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
                        }`}
                      >
                        <Icon name={v.ok ? "check" : "x"} size={12} />
                      </span>
                      <span className={v.ok ? "text-text-main" : "text-rose-700"}>{v.message}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {!checking && preflight && !preflight.ok && (
                <p className="mt-2 text-sm text-rose-600">
                  উপরের কোনো শর্ত মেলেনি — মার্জ করা যাবে না।
                </p>
              )}
            </div>

            {error && (
              <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                {error}
              </p>
            )}
            {merging && <p className="text-sm text-text-muted">মার্জ হচ্ছে…</p>}
          </div>
        )}
      </Modal>
    </>
  );
}
