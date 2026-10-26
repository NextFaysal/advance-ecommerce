"use client";

/**
 * Team client (ADV-27 remainder) — attendance month grid + shifts CRUD.
 *
 * Grid: staff × day-of-month. A cell shows the day's worked hours
 * (sum of closed check-in/out pairs), "●" for a still-open session,
 * blank for absent. Summary columns show present days + total hours.
 * Hours come only from recorded pairs — an open session adds 0 until
 * it is closed (server computes; this panel renders verbatim).
 *
 * Shifts: simple forms (name, start, end, roster checkboxes). Shifts
 * are informational — a matching check-in records the shift name;
 * there is no payroll/late math anywhere.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
}

interface DaySummary {
  sessions: number;
  minutes: number;
  open: boolean;
  shiftNames: string[];
}

interface UserSummary {
  userId: string;
  presentDays: number;
  totalMinutes: number;
  openSessions: number;
  days: Record<string, DaySummary>;
}

interface AttendanceData {
  month: string;
  daysInMonth: number;
  staff: StaffMember[];
  summaries: UserSummary[];
}

interface Shift {
  id: string;
  name: string;
  startHHMM: string;
  endHHMM: string;
  userIds: string[];
}

function currentMonth(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit" }).format(new Date());
}

function hoursShort(minutes: number): string {
  if (minutes <= 0) return "0";
  const h = minutes / 60;
  return h >= 10 ? String(Math.round(h)) : h.toFixed(1).replace(/\.0$/, "");
}

function hoursLong(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} মিনিট`;
  return m > 0 ? `${h}ঘ ${m}মি` : `${h} ঘণ্টা`;
}

export function TeamClient() {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<AttendanceData | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [error, setError] = useState("");
  const [shiftError, setShiftError] = useState("");
  const [busy, setBusy] = useState(false);

  // shift form
  const [form, setForm] = useState({ name: "", startHHMM: "09:00", endHHMM: "18:00" });
  const [formRoster, setFormRoster] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);

  const loadAttendance = useCallback(async (m: string) => {
    try {
      const res = await fetch(`/api/v1/admin/team/attendance?month=${m}`, { cache: "no-store" });
      const json = (await res.json()) as { data?: AttendanceData; error?: { message: string } };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? "তথ্য আনা যায়নি।");
        return;
      }
      setData(json.data);
      setError("");
    } catch {
      setError("নেটওয়ার্ক ত্রুটি।");
    }
  }, []);

  const loadShifts = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/team/shifts", { cache: "no-store" });
      const json = (await res.json()) as {
        data?: { shifts: Shift[]; staff: StaffMember[] };
        error?: { message: string };
      };
      if (res.ok && json.data) {
        setShifts(json.data.shifts);
        setStaff(json.data.staff);
      }
    } catch {
      /* shifts section shows its own empty state */
    }
  }, []);

  useEffect(() => {
    void loadAttendance(month);
  }, [loadAttendance, month]);

  useEffect(() => {
    void loadShifts();
  }, [loadShifts]);

  const summaryByUser = useMemo(
    () => new Map((data?.summaries ?? []).map((s) => [s.userId, s])),
    [data],
  );
  const dayNumbers = useMemo(
    () => Array.from({ length: data?.daysInMonth ?? 0 }, (_, i) => i + 1),
    [data],
  );

  const toggleRoster = (id: string) => {
    setFormRoster((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveShift = async () => {
    setBusy(true);
    setShiftError("");
    try {
      const body = { ...form, userIds: [...formRoster] };
      const res = await fetch(
        editingId ? `/api/v1/admin/team/shifts/${editingId}` : "/api/v1/admin/team/shifts",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = (await res.json()) as { error?: { message: string } };
      if (!res.ok) {
        setShiftError(json.error?.message ?? "শিফট সংরক্ষণ হয়নি।");
        return;
      }
      setForm({ name: "", startHHMM: "09:00", endHHMM: "18:00" });
      setFormRoster(new Set());
      setEditingId(null);
      void loadShifts();
    } catch {
      setShiftError("নেটওয়ার্ক ত্রুটি।");
    } finally {
      setBusy(false);
    }
  };

  const removeShift = async (id: string) => {
    setBusy(true);
    try {
      await fetch(`/api/v1/admin/team/shifts/${id}`, { method: "DELETE" });
      void loadShifts();
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (shift: Shift) => {
    setEditingId(shift.id);
    setForm({ name: shift.name, startHHMM: shift.startHHMM, endHHMM: shift.endHHMM });
    setFormRoster(new Set(shift.userIds));
  };

  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-h3">উপস্থিতি — মাসের সারসংক্ষেপ</h2>
          <label className="flex items-center gap-2 text-small">
            মাস
            <Input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-44"
            />
          </label>
        </div>
        {error !== "" && <p className="text-small font-medium text-rose-600">{error}</p>}
        {data !== null && error === "" && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-caption">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="sticky left-0 bg-white px-2 py-2 font-semibold">স্টাফ</th>
                  {dayNumbers.map((d) => (
                    <th key={d} className="px-1 py-2 text-center font-medium text-text-subtle">
                      {d}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right font-semibold">দিন</th>
                  <th className="px-2 py-2 text-right font-semibold">মোট সময়</th>
                </tr>
              </thead>
              <tbody>
                {data.staff.map((member) => {
                  const summary = summaryByUser.get(member.id);
                  return (
                    <tr key={member.id} className="border-b border-border/60">
                      <td className="sticky left-0 whitespace-nowrap bg-white px-2 py-1.5">
                        <span className="font-medium">{member.name || member.email || "—"}</span>
                        <span className="block text-[11px] text-text-subtle">{member.role}</span>
                      </td>
                      {dayNumbers.map((d) => {
                        const ymd = `${month}-${String(d).padStart(2, "0")}`;
                        const day = summary?.days[ymd];
                        return (
                          <td
                            key={d}
                            className="px-1 py-1.5 text-center tabular-nums"
                            title={
                              day
                                ? `${day.sessions}টি সেশন · ${hoursLong(day.minutes)}${day.open ? " · এখনো খোলা" : ""}${day.shiftNames.length ? ` · ${day.shiftNames.join(", ")}` : ""}`
                                : "অনুপস্থিত"
                            }
                          >
                            {day === undefined ? (
                              <span className="text-text-subtle/50">·</span>
                            ) : day.open ? (
                              <span className="font-bold text-amber-600">●</span>
                            ) : (
                              <span className="font-medium">{hoursShort(day.minutes)}</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                        {summary?.presentDays ?? 0}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {hoursLong(summary?.totalMinutes ?? 0)}
                        {(summary?.openSessions ?? 0) > 0 && (
                          <span className="ml-1">
                            <Badge tone="warning">খোলা {summary?.openSessions}</Badge>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-caption text-text-subtle">
              ঘরের সংখ্যা = ঐ দিনের কাজের ঘণ্টা (বন্ধ হওয়া চেক-ইন/চেক-আউট জোড়া থেকে)। ● = সেশন এখনো খোলা
              (বন্ধ না হওয়া পর্যন্ত সময় ০ ধরা হয়)। ফাঁকা = কোনো এন্ট্রি নেই।
            </p>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 text-h3">শিফট</h2>
        <p className="mb-4 text-small text-text-subtle">
          শিফট শুধু তথ্যের জন্য — কারো চেক-ইন তার শিফটের সময়ের মধ্যে পড়লে এন্ট্রিতে শিফটের নাম recorded
          থাকে। বেতন/লেট-জরিমানার কোনো হিসাব এখানে করা হয় না।
        </p>
        {shifts.length > 0 && (
          <ul className="mb-5 space-y-2">
            {shifts.map((shift) => (
              <li
                key={shift.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2"
              >
                <span className="text-small">
                  <span className="font-semibold">{shift.name}</span>{" "}
                  <span className="tabular-nums text-text-subtle">
                    {shift.startHHMM} – {shift.endHHMM}
                  </span>{" "}
                  <span className="text-text-subtle">· {shift.userIds.length} জন স্টাফ</span>
                </span>
                <span className="flex gap-2">
                  <Button variant="secondary" onClick={() => startEdit(shift)} disabled={busy}>
                    সম্পাদনা
                  </Button>
                  <Button variant="destructive" onClick={() => void removeShift(shift.id)} disabled={busy}>
                    মুছুন
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <label className="text-small">
            শিফটের নাম
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="সকালের শিফট"
            />
          </label>
          <label className="text-small">
            শুরু
            <Input
              type="time"
              value={form.startHHMM}
              onChange={(e) => setForm({ ...form, startHHMM: e.target.value })}
            />
          </label>
          <label className="text-small">
            শেষ
            <Input
              type="time"
              value={form.endHHMM}
              onChange={(e) => setForm({ ...form, endHHMM: e.target.value })}
            />
          </label>
          <div className="flex items-end">
            <Button onClick={() => void saveShift()} disabled={busy || form.name.trim() === ""} className="min-h-[44px]">
              {editingId ? "শিফট আপডেট করুন" : "শিফট যোগ করুন"}
            </Button>
          </div>
        </div>
        <fieldset className="mt-3">
          <legend className="text-small font-medium">এই শিফটে যারা আছেন</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {staff.map((member) => (
              <label
                key={member.id}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-small"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={formRoster.has(member.id)}
                  onChange={() => toggleRoster(member.id)}
                />
                {member.name || member.email || member.id}
              </label>
            ))}
          </div>
        </fieldset>
        {shiftError !== "" && <p className="mt-3 text-small font-medium text-rose-600">{shiftError}</p>}
      </Card>
    </div>
  );
}
