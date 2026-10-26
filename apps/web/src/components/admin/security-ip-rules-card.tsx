"use client";

/**
 * Staff-login IP rules card — /admin/security (ADV-28 core).
 *
 * Self-fetching editor for the `security.ip_rules` Setting doc via
 *   GET /api/v1/admin/security/ip-rules  -> { allow, block }
 *   PUT /api/v1/admin/security/ip-rules  -> { allow, block, reason }
 * One IP or CIDR per line in each textarea. The API validates every
 * entry and rejects the WHOLE save (400 + the invalid entries) when
 * any line is malformed — those entries are shown back to the admin,
 * nothing is partially applied. Saving requires a reason (the change
 * is audited as settings.update).
 *
 * Honest scope: these rules apply to STAFF (admin) LOGIN only for
 * now — not to customer sign-in, the storefront, or other API routes.
 */
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface IpRulesData {
  allow: string[];
  block: string[];
}

interface IpRulesResponse {
  data?: IpRulesData;
  error?: { code?: string; message?: string; details?: unknown };
}

function linesToEntries(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

export function SecurityIpRulesCard() {
  const [allowText, setAllowText] = useState("");
  const [blockText, setBlockText] = useState("");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetails, setErrorDetails] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/v1/admin/security/ip-rules");
        const body = (await res.json().catch(() => ({}))) as IpRulesResponse;
        if (cancelled) return;
        if (!res.ok || !body.data) {
          setError(body.error?.message ?? "IP নিয়ম লোড করা যায়নি — আবার চেষ্টা করুন।");
          return;
        }
        setAllowText(body.data.allow.join("\n"));
        setBlockText(body.data.block.join("\n"));
      } catch {
        if (!cancelled) setError("সার্ভারে পৌঁছানো যাচ্ছে না — নেটওয়ার্ক দেখে আবার চেষ্টা করুন।");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setErrorDetails([]);
    setMessage(null);
    try {
      const res = await fetch("/api/v1/admin/security/ip-rules", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          allow: linesToEntries(allowText),
          block: linesToEntries(blockText),
          reason: reason.trim(),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as IpRulesResponse;
      if (!res.ok || !body.data) {
        setError(body.error?.message ?? "IP নিয়ম সংরক্ষণ করা যায়নি — আবার চেষ্টা করুন।");
        if (Array.isArray(body.error?.details)) {
          setErrorDetails(body.error.details.filter((d): d is string => typeof d === "string"));
        }
        return;
      }
      // Echo the server's canonical (trimmed, de-duplicated) lists so
      // what the admin sees is exactly what is now enforced.
      setAllowText(body.data.allow.join("\n"));
      setBlockText(body.data.block.join("\n"));
      setReason("");
      setMessage("IP নিয়ম সংরক্ষিত হয়েছে — এখন থেকে স্টাফ লগইনে এগুলোই প্রযোজ্য।");
    } catch {
      setError("সার্ভারে পৌঁছানো যাচ্ছে না — নেটওয়ার্ক দেখে আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <h3 className="text-base font-semibold text-text-main">স্টাফ লগইন IP নিয়ম</h3>
      <p className="mt-1 text-sm leading-6 text-text-muted">
        এই নিয়মগুলো আপাতত <strong>শুধু স্টাফ (অ্যাডমিন) লগইনে</strong> প্রযোজ্য — গ্রাহক লগইন বা
        স্টোরফ্রন্টে নয়। Block তালিকার IP/CIDR থেকে লগইন সবসময় বন্ধ থাকবে। Allow তালিকা খালি
        রাখলে সব IP-ই অনুমোদিত (Block তালিকা বাদে); Allow তালিকায় কিছু থাকলে শুধু সেই IP/CIDR
        থেকেই লগইন করা যাবে।
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-text-muted">লোড হচ্ছে…</p>
      ) : (
        <div className="mt-4 space-y-4">
          <Textarea
            id="ip-rules-allow"
            name="ip-rules-allow"
            label="Allow তালিকা (অনুমোদিত IP / CIDR)"
            helper="এক লাইনে একটি করে IP বা CIDR — যেমন 203.0.113.10 অথবা 203.0.113.0/24। খালি রাখলে সবাই অনুমোদিত (Block তালিকা বাদে)।"
            rows={5}
            value={allowText}
            onChange={(e) => setAllowText(e.target.value)}
            placeholder={"203.0.113.10\n198.51.100.0/24"}
            disabled={busy}
          />
          <Textarea
            id="ip-rules-block"
            name="ip-rules-block"
            label="Block তালিকা (নিষিদ্ধ IP / CIDR)"
            helper="এক লাইনে একটি করে IP বা CIDR। Block সবসময় Allow-এর ওপরে প্রাধান্য পায়।"
            rows={5}
            value={blockText}
            onChange={(e) => setBlockText(e.target.value)}
            placeholder={"192.0.2.55\n2001:db8:bad::/48"}
            disabled={busy}
          />
          <Input
            id="ip-rules-reason"
            name="ip-rules-reason"
            label="পরিবর্তনের কারণ"
            helper="নিরাপত্তা নিয়ম বদলের কারণ অডিট লগে রাখা বাধ্যতামূলক।"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="যেমন: অফিসের নতুন static IP যোগ"
            required
            disabled={busy}
          />

          {error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              <p>{error}</p>
              {errorDetails.length > 0 ? (
                <ul className="mt-1 list-disc pl-5">
                  {errorDetails.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {message ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              {message}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button onClick={save} disabled={busy || reason.trim() === ""}>
              {busy ? "সংরক্ষণ হচ্ছে…" : "IP নিয়ম সংরক্ষণ করুন"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
