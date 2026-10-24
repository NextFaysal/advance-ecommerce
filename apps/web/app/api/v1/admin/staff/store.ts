/**
 * Demo staff store — Agent 39.
 *
 * In-memory stand-in for the User/Role tables behind the staff API. ALL
 * ROWS ARE FICTIONAL (demo-labelled, @sample.invalid emails, no real
 * person, no credential material of any kind — passwords/TOTP secrets are
 * never part of this shape). Real wiring (later): User + Role tables via
 * Prisma, invites sent by the configured email provider; this store is
 * deleted, the route contract stays.
 */

export type DemoStaffStatus = "ACTIVE" | "INVITED" | "SUSPENDED";

export interface DemoStaffMember {
  id: string;
  name: string;
  email: string;
  role: string;
  status: DemoStaffStatus;
  totpEnabled: boolean;
  lastLoginAt: string | null; // ISO 8601
  invitedBy: string | null;
  invitedAt: string | null; // ISO 8601
}

export const demoStaffStore: DemoStaffMember[] = [
  {
    id: "staff_sample_owner",
    name: "SAMPLE মালিক (Demo Owner)",
    email: "owner@sample.invalid",
    role: "Owner",
    status: "ACTIVE",
    totpEnabled: true,
    lastLoginAt: "2026-10-24T03:15:00.000Z",
    invitedBy: null,
    invitedAt: null,
  },
  {
    id: "staff_sample_manager",
    name: "SAMPLE ম্যানেজার (Demo Manager)",
    email: "manager@sample.invalid",
    role: "Manager",
    status: "ACTIVE",
    totpEnabled: true,
    lastLoginAt: "2026-10-24T04:02:00.000Z",
    invitedBy: "staff_sample_owner",
    invitedAt: "2026-10-20T04:00:00.000Z",
  },
  {
    id: "staff_sample_processor",
    name: "SAMPLE অর্ডার প্রসেসর (Demo Processor)",
    email: "processor@sample.invalid",
    role: "Order Processor",
    status: "ACTIVE",
    totpEnabled: false,
    lastLoginAt: "2026-10-24T05:40:00.000Z",
    invitedBy: "staff_sample_owner",
    invitedAt: "2026-10-21T04:00:00.000Z",
  },
  {
    id: "staff_sample_inventory",
    name: "SAMPLE ইনভেন্টরি (Demo Inventory)",
    email: "inventory@sample.invalid",
    role: "Inventory",
    status: "ACTIVE",
    totpEnabled: false,
    lastLoginAt: "2026-10-23T10:11:00.000Z",
    invitedBy: "staff_sample_manager",
    invitedAt: "2026-10-21T06:30:00.000Z",
  },
  {
    id: "staff_sample_support",
    name: "SAMPLE সাপোর্ট (Demo Support)",
    email: "support@sample.invalid",
    role: "Support",
    status: "INVITED",
    totpEnabled: false,
    lastLoginAt: null,
    invitedBy: "staff_sample_manager",
    invitedAt: "2026-10-24T02:00:00.000Z",
  },
  {
    id: "staff_sample_accountant",
    name: "SAMPLE হিসাবরক্ষক (Demo Accountant)",
    email: "accountant@sample.invalid",
    role: "Accountant",
    status: "SUSPENDED",
    totpEnabled: true,
    lastLoginAt: "2026-10-18T07:45:00.000Z",
    invitedBy: "staff_sample_owner",
    invitedAt: "2026-10-15T04:00:00.000Z",
  },
];
