"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/select";
import { Button } from "@/components/ui/button";

/**
 * Staff invite form — Agent 27. OUTLINE ONLY (demo).
 * Submitting this form sends NOTHING: there is no staff-invite API wired
 * yet, and the submit handler only shows the outline notice below.
 * Real wiring (later): POST /api/v1/admin/staff/invite guarded by
 * `staff.manage`, audited as `staff.manage` (a sensitive action — reason
 * required, see src/lib/audit.ts), sending an invite email via the
 * admin-configured email provider. The invitee sets their own password
 * and TOTP — a password is never created or shown here.
 */
const ROLE_OPTIONS = [
  { value: "Manager", label: "Manager — ম্যানেজার" },
  { value: "Order Processor", label: "Order Processor — অর্ডার প্রসেসর" },
  { value: "Inventory", label: "Inventory — ইনভেন্টরি" },
  { value: "Support", label: "Support — সাপোর্ট" },
  { value: "Accountant", label: "Accountant — হিসাবরক্ষক" },
  { value: "Content Editor", label: "Content Editor — কন্টেন্ট এডিটর" },
];

export function InviteForm() {
  const [role, setRole] = useState("Support");
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setNotice(
          "এটি শুধু ফর্মের আউটলাইন (TEMPORARY DEMO) — আমন্ত্রণ পাঠানো হয়নি। স্টাফ ইনভাইট API যুক্ত হলে এই ফর্ম সেখানেই পাঠাবে।",
        );
      }}
      className="grid gap-4 sm:grid-cols-3"
    >
      <Input name="invite-name" label="নাম (Name)" placeholder="নতুন স্টাফের নাম" autoComplete="off" />
      <Input name="invite-email" label="ইমেইল (Email)" placeholder="staff@your-shop.com" type="email" autoComplete="off" />
      <Combobox label="ভূমিকা (Role)" options={ROLE_OPTIONS} value={role} onChange={setRole} placeholder="ভূমিকা খুঁজুন…" />
      <div className="sm:col-span-3">
        <Button type="submit" variant="secondary">আমন্ত্রণ পাঠান (আউটলাইন)</Button>
        {notice ? (
          <p role="status" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {notice}
          </p>
        ) : null}
        <p className="mt-2 text-xs text-text-muted">
          আমন্ত্রিত স্টাফ নিজে পাসওয়ার্ড ও 2FA (TOTP) সেট করবেন — এখানে কোনো পাসওয়ার্ড তৈরি বা দেখানো হয় না।
        </p>
      </div>
    </form>
  );
}
