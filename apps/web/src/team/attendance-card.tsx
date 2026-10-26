"use client";

/**
 * "আমার উপস্থিতি" card (ADV-27 remainder) — mounted on the admin
 * dashboard home. Self-fetching over /api/v1/admin/team/attendance/me
 * (+ check-in / check-out POSTs). Any signed-in staff member sees
 * their OWN state only; the team-wide grid lives on /admin/team.
 *
 * The buttons perform the real state transition server-side; the card
 * re-fetches after every action and shows exactly what the API
 * returned (including the already-checked-in note).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface MyAttendanceData {
  user: { id: string; name: string };
  today: string;
  state: "not_checked_in" | "checked_in" | "done";
  todayMinutes: number;
  openEntry: { checkInAt: string; date: string; shiftName?: string } | null;
  monthSummary: { presentDays: number; totalMinutes: number } | null;
}

const timeFmt = new Intl.DateTimeFormat("bn-BD", {
  timeZone: "Asia/Dhaka",
  hour: "2-digit",
  minute: "2-digit",
});

function hoursText(minutes: number): string {
  if (minutes <= 0) return "০ ঘণ্টা";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} ঘণ্টা ${m} মিনিট` : `${h} ঘণ্টা`;
}

export function AttendanceCard() {
  const [data, setData] = useState<MyAttendanceData | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/team/attendance/me", { cache: "no-store" });
      const json = (await res.json()) as { data?: MyAttendanceData; error?: { message: string } };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? "উপস্থিতির তথ্য আনা যায়নি।");
        return;
      }
      setData(json.data);
      setError("");
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (kind: "check-in" | "check-out") => {
      setBusy(true);
      setNote("");
      try {
        const res = await fetch(`/api/v1/admin/team/attendance/${kind}`, { method: "POST" });
        const json = (await res.json()) as {
          meta?: { note?: string };
          error?: { message: string };
        };
        if (!res.ok) {
          setNote(json.error?.message ?? "কাজটি সম্পন্ন হয়নি।");
        } else if (json.meta?.note) {
          setNote(json.meta.note);
        }
      } catch {
        setNote("নেটওয়ার্ক ত্রুটি — আবার চেষ্টা করুন।");
      } finally {
        setBusy(false);
        void load();
      }
    },
    [load],
  );

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-h3">আমার উপস্থিতি</h2>
          <p className="mt-1 text-small text-text-subtle">
            {data === null && error === "" && "লোড হচ্ছে…"}
            {error !== "" && error}
            {data !== null &&
              (data.state === "not_checked_in" && "আজ এখনো চেক-ইন করেননি।")}
            {data !== null &&
              data.state === "checked_in" &&
              data.openEntry !== null &&
              `চেক-ইন: ${timeFmt.format(new Date(data.openEntry.checkInAt))} থেকে কাজ চলছে${
                data.openEntry.shiftName ? ` · শিফট: ${data.openEntry.shiftName}` : ""
              }${data.openEntry.date !== data.today ? ` (${data.openEntry.date} — রাতের শিফট)` : ""}`}
            {data !== null &&
              data.state === "done" &&
              `আজকের কাজ শেষ — মোট ${hoursText(data.todayMinutes)}। আবার চেক-ইন করলে নতুন সেশন শুরু হবে।`}
          </p>
          {data?.monthSummary && (
            <p className="mt-1 text-small text-text-subtle">
              এই মাসে উপস্থিতি: {data.monthSummary.presentDays} দিন · মোট {hoursText(data.monthSummary.totalMinutes)}
            </p>
          )}
          {note !== "" && <p className="mt-2 text-small font-medium text-amber-600">{note}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data?.state === "checked_in" ? (
            <Button onClick={() => void act("check-out")} disabled={busy} className="min-h-[44px]">
              চেক-আউট করুন
            </Button>
          ) : (
            <Button onClick={() => void act("check-in")} disabled={busy || data === null} className="min-h-[44px]">
              চেক-ইন করুন
            </Button>
          )}
          <Link
            href="/admin/team"
            className="flex min-h-[44px] items-center rounded-md px-3 text-sm font-medium text-brand-700 ring-1 ring-border transition motion-fast hover:bg-brand-50"
          >
            টিম পেজ →
          </Link>
        </div>
      </div>
    </Card>
  );
}
