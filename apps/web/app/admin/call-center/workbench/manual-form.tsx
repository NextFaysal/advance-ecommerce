"use client";

/**
 * Manual task form (CD1 split) — markup and behaviour verbatim from
 * the monolith; the shell owns the field state and the submit handler
 * (createManual) and passes them down.
 */
import type { FormEvent } from "react";

export function ManualTaskForm({
  mName,
  mPhone,
  mNote,
  mBusy,
  mError,
  mNotice,
  onNameChange,
  onPhoneChange,
  onNoteChange,
  onSubmit,
}: {
  mName: string;
  mPhone: string;
  mNote: string;
  mBusy: boolean;
  mError: string | null;
  mNotice: string | null;
  onNameChange: (v: string) => void;
  onPhoneChange: (v: string) => void;
  onNoteChange: (v: string) => void;
  onSubmit: (e: FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold">ম্যানুয়াল টাস্ক যোগ করুন</h3>
      <p className="mt-1 text-xs text-slate-500">
        যেমন ফেসবুক কমেন্ট থেকে পাওয়া নম্বর। ম্যানুয়াল টাস্কে নাম, নোট ও নম্বরটি সংরক্ষণ করা
        হয় যাতে এজেন্ট কল করতে পারে — সম্পূর্ণ নম্বর শুধু অনুমতিপ্রাপ্ত
        (customers.view_full_phone) ব্যবহারকারীরাই দেখতে পান; বাকি সব জায়গায় মাস্ক করা থাকে।
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3">
        <label className="block text-sm">
          <span className="text-slate-600">গ্রাহকের নাম *</span>
          <input
            type="text"
            required
            minLength={2}
            value={mName}
            onChange={(e) => onNameChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">মোবাইল নম্বর *</span>
          <input
            type="tel"
            required
            value={mPhone}
            onChange={(e) => onPhoneChange(e.target.value)}
            placeholder="01XXXXXXXXX"
            className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5"
          />
        </label>
        <label className="block text-sm">
          <span className="text-slate-600">নোট (ঐচ্ছিক)</span>
          <input
            type="text"
            maxLength={500}
            value={mNote}
            onChange={(e) => onNoteChange(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5"
          />
        </label>
      </div>
      {mError ? (
        <p role="alert" className="mt-2 text-sm text-rose-700">
          {mError}
        </p>
      ) : null}
      {mNotice ? (
        <p role="status" className="mt-2 text-sm text-emerald-700">
          {mNotice}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={mBusy}
        className="mt-3 w-full rounded-md bg-slate-700 px-3.5 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        টাস্ক যোগ করুন
      </button>
    </form>
  );
}
