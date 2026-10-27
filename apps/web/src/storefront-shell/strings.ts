/**
 * Storefront shell — slice-local UI dictionary (doc 30, slice L1).
 *
 * Every user-visible string in SiteHeader / SiteFooter that is NOT
 * already in the shared dictionary (src/i18n/dictionaries.ts) lives
 * here, following the mandatory parity pattern: the `bn` object is
 * typed once, `en` is typed as the mapped ShellStrings type, so a
 * key missing (or extra) in either locale fails compilation.
 *
 * Merchant/content data (brand name, CMS menu labels, category and
 * product names) is NOT in this dictionary — those records already
 * carry their own {bn, en} fields and are picked by locale at the
 * render site.
 */
import type { Locale } from "@/i18n/locale";

const bn = {
  // Announcement bar
  announcement: "সারাদেশে ক্যাশ অন ডেলিভারি — পণ্য হাতে পেয়ে টাকা দিন",
  help: "সাহায্য",

  // Search chrome
  searchProducts: "পণ্য খুঁজুন",
  popularSearches: "জনপ্রিয় খোঁজ",
  searching: "খুঁজছি…",
  noProductsForQuery: "“{query}” দিয়ে কোনো পণ্য পাওয়া যায়নি",
  viewAllResults: "সব ফলাফল দেখুন →",

  // Navigation landmarks / menu toggles
  mainNavigation: "প্রধান নেভিগেশন",
  mobileNavigation: "মোবাইল নেভিগেশন",
  mobileQuickNavigation: "মোবাইল দ্রুত নেভিগেশন",
  openMenu: "মেনু খুলুন",
  closeMenu: "মেনু বন্ধ করুন",

  // Icon-button aria labels with counts (templates)
  wishlistWithCount: "উইশলিস্ট, {count}টি পণ্য",
  cartWithCount: "কার্ট, {count}টি পণ্য",

  // Mega menu
  allCategories: "সব ক্যাটাগরি",
  trackOrderShort: "অর্ডার ট্র্যাক",
  categoriesLoading: "ক্যাটাগরি লোড হচ্ছে…",
  productsCount: "{count}টি পণ্য",
  itemsCountShort: "{count}টি",
  noCategoriesYet: "এখনো কোনো ক্যাটাগরি যোগ হয়নি",
  viewAllProducts: "সব পণ্য দেখুন →",

  // Mobile bottom nav (labels that differ from the common dictionary)
  bottomShop: "দোকান",
  bottomTrack: "ট্র্যাক",

  // Footer
  footerIntro:
    "বাংলাদেশের ক্রেতাদের জন্য তৈরি অনলাইন শপ — যাচাই করা অরিজিনাল পণ্য, ক্যাশ অন ডেলিভারি আর সারাদেশে হোম ডেলিভারি।",
  paymentLabel: "পেমেন্ট:",
  deliveryPartnerLabel: "ডেলিভারি পার্টনার:",
  copyrightLine: "© {year} {brandName} — সর্বস্বত্ব সংরক্ষিত।",
  contactPrompt: "যোগাযোগের জন্য এখানে দেখুন",
  poweredBy: "Advance Ecommerce দ্বারা পরিচালিত",
};

export type ShellStrings = { [K in keyof typeof bn]: string };

const en: ShellStrings = {
  announcement: "Cash on delivery nationwide — pay when you receive your product",
  help: "Help",

  searchProducts: "Search products",
  popularSearches: "Popular searches",
  searching: "Searching…",
  noProductsForQuery: "No products found for “{query}”",
  viewAllResults: "View all results →",

  mainNavigation: "Main navigation",
  mobileNavigation: "Mobile navigation",
  mobileQuickNavigation: "Mobile quick navigation",
  openMenu: "Open menu",
  closeMenu: "Close menu",

  wishlistWithCount: "Wishlist, {count} items",
  cartWithCount: "Cart, {count} items",

  allCategories: "All Categories",
  trackOrderShort: "Track Order",
  categoriesLoading: "Loading categories…",
  productsCount: "{count} products",
  itemsCountShort: "{count}",
  noCategoriesYet: "No categories added yet",
  viewAllProducts: "View all products →",

  bottomShop: "Shop",
  bottomTrack: "Track",

  footerIntro:
    "An online shop built for shoppers in Bangladesh — verified original products, cash on delivery and home delivery nationwide.",
  paymentLabel: "Payment:",
  deliveryPartnerLabel: "Delivery partner:",
  copyrightLine: "© {year} {brandName} — All rights reserved.",
  contactPrompt: "See here for contact details",
  poweredBy: "Powered by Advance Ecommerce",
};

export const SHELL_STRINGS: Record<Locale, ShellStrings> = { bn, en };

/**
 * Trending search shortcuts shown in the search panel. These are
 * search TERMS (they submit to /search?q=), so each locale carries
 * its own term list — an array, hence a separate export from the
 * all-string SHELL_STRINGS dictionary above.
 */
export const TRENDING_TERMS: Record<Locale, readonly string[]> = {
  bn: [
    "শাড়ি",
    "পাঞ্জাবি",
    "থ্রি-পিস",
    "স্মার্টওয়াচ",
    "ওয়্যারলেস ইয়ারবাডস",
    "জুতা",
    "হাতঘড়ি",
    "ব্যাগ",
  ],
  en: [
    "Saree",
    "Panjabi",
    "Three-piece",
    "Smartwatch",
    "Wireless earbuds",
    "Shoes",
    "Wristwatch",
    "Bag",
  ],
};
