/**
 * Contact form — labels for the parts Agent 29's content file does not
 * cover (email/subject fields, submit states, API-driven messages).
 * Agent 47. Name/phone/message/submit labels still come from
 * src/legal/content.ts (ContactContent) — this file only fills the
 * gaps, keyed by the same LegalLocale so /contact stays bn-default.
 */
import type { LegalLocale } from "@/legal/content";

export interface ContactFormLabels {
  emailLabel: string;
  emailOptionalNote: string;
  subjectLabel: string;
  formNote: string;
  storageNote: string;
  submittingLabel: string;
  successTitle: string;
  /** {id} is replaced with the reference id returned by the API. */
  successBody: string;
  genericError: string;
  unreachableError: string;
}

export const CONTACT_FORM_LABELS: Record<LegalLocale, ContactFormLabels> = {
  bn: {
    emailLabel: "ইমেইল (ঐচ্ছিক)",
    emailOptionalNote: "না দিলেও চলবে — আমরা মূলত ফোনে যোগাযোগ করি।",
    subjectLabel: "বিষয়",
    formNote:
      "বার্তাটি আমাদের সাপোর্ট টিমের ইনবক্সে জমা হবে। জরুরি প্রয়োজনে উপরের নম্বরে ফোন করুন।",
    storageNote: "বার্তাটি সাপোর্ট ইনবক্সে সংরক্ষিত হয় — জমা হলেই কোনো ইমেইল বা SMS স্বয়ংক্রিয়ভাবে পাঠানো হয় না।",
    submittingLabel: "পাঠানো হচ্ছে…",
    successTitle: "আপনার বার্তা পৌঁছেছে",
    successBody: "ধন্যবাদ! আপনার বার্তাটি আমাদের সাপোর্ট ইনবক্সে জমা হয়েছে। রেফারেন্স নম্বর: {id} — প্রয়োজনে এই নম্বরটি জানালে আমরা বার্তাটি খুঁজে পাব।",
    genericError: "বার্তা পাঠানো যায়নি — তথ্য মিলিয়ে আবার চেষ্টা করুন।",
    unreachableError:
      "বার্তা পাঠানো যায়নি — সার্ভারের সঙ্গে যোগাযোগ করা যাচ্ছে না। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন, অথবা উপরের নম্বরে ফোন করুন।",
  },
  en: {
    emailLabel: "Email (optional)",
    emailOptionalNote: "You may leave this empty — we mainly reply by phone.",
    subjectLabel: "Subject",
    formNote:
      "Your message will be stored in our support team's inbox. For urgent needs, please call the number above.",
    storageNote: "Your message is saved in the support inbox — no email or SMS is sent automatically on submission.",
    submittingLabel: "Sending…",
    successTitle: "Message received",
    successBody: "Thank you! Your message has been stored in our support inbox. Reference number: {id} — quote it if you contact us about this message.",
    genericError: "Your message could not be sent — please check the details and try again.",
    unreachableError:
      "Your message could not be sent — the server could not be reached. Please check your connection and try again, or call the number above.",
  },
};
