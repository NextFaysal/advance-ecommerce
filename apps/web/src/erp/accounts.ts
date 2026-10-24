/**
 * Default chart of accounts (Bangladesh SME) — Agent 17, Step 49 (A16).
 * Merchants may rename/extend accounts; codes are the stable keys that
 * journal lines reference. VAT payable is its own liability account so
 * the VAT report (vat.ts) reconciles against the ledger.
 */
import type { Account } from "./types";

export const DEFAULT_CHART_OF_ACCOUNTS: Account[] = [
  { code: "1000", nameEn: "Cash in hand", nameBn: "নগদ", type: "asset", parentCode: null, isActive: true },
  { code: "1010", nameEn: "Bank account", nameBn: "ব্যাংক হিসাব", type: "asset", parentCode: null, isActive: true },
  { code: "1020", nameEn: "bKash merchant wallet", nameBn: "বিকাশ মার্চেন্ট", type: "asset", parentCode: null, isActive: true },
  { code: "1030", nameEn: "Nagad merchant wallet", nameBn: "নগদ মার্চেন্ট", type: "asset", parentCode: null, isActive: true },
  { code: "1100", nameEn: "Accounts receivable", nameBn: "পাওনা", type: "asset", parentCode: null, isActive: true },
  { code: "1200", nameEn: "Inventory", nameBn: "মজুদ পণ্য", type: "asset", parentCode: null, isActive: true },
  { code: "2000", nameEn: "Accounts payable (suppliers)", nameBn: "সরবরাহকারী দেনা", type: "liability", parentCode: null, isActive: true },
  { code: "2100", nameEn: "VAT payable", nameBn: "ভ্যাট দেনা", type: "liability", parentCode: null, isActive: true },
  { code: "2200", nameEn: "Courier COD payable", nameBn: "কুরিয়ার COD দেনা", type: "liability", parentCode: null, isActive: true },
  { code: "3000", nameEn: "Owner capital", nameBn: "মালিকের মূলধন", type: "equity", parentCode: null, isActive: true },
  { code: "4000", nameEn: "Sales revenue", nameBn: "বিক্রয় আয়", type: "income", parentCode: null, isActive: true },
  { code: "4100", nameEn: "Delivery income", nameBn: "ডেলিভারি আয়", type: "income", parentCode: null, isActive: true },
  { code: "5000", nameEn: "Cost of goods sold", nameBn: "পণ্যের খরচ", type: "expense", parentCode: null, isActive: true },
  { code: "5100", nameEn: "Delivery / courier expense", nameBn: "কুরিয়ার খরচ", type: "expense", parentCode: null, isActive: true },
  { code: "5200", nameEn: "Rent", nameBn: "ভাড়া", type: "expense", parentCode: null, isActive: true },
  { code: "5300", nameEn: "Salary", nameBn: "বেতন", type: "expense", parentCode: null, isActive: true },
  { code: "5400", nameEn: "Marketing expense", nameBn: "মার্কেটিং খরচ", type: "expense", parentCode: null, isActive: true },
  { code: "5500", nameEn: "Packaging expense", nameBn: "প্যাকেজিং খরচ", type: "expense", parentCode: null, isActive: true },
  { code: "5600", nameEn: "Other expense", nameBn: "অন্যান্য খরচ", type: "expense", parentCode: null, isActive: true },
];

export function accountByCode(accounts: Account[], code: string): Account | null {
  return accounts.find((a) => a.code === code) ?? null;
}
