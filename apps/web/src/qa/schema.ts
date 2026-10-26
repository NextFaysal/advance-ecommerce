import { z } from "zod";

/**
 * Product Q&A input contracts (ADV-16b, doc 22).
 *
 * Statuses are app-level strings on ProductQuestion.status:
 *   PENDING  — asked, not yet answered (never shown publicly)
 *   ANSWERED — has a staff answer; the ONLY status the PDP shows
 *   HIDDEN   — staff hid it (spam/abuse); recoverable by staff
 * Soft-deleted rows (deletedAt) are excluded from every read.
 */
export const QUESTION_STATUSES = ["PENDING", "ANSWERED", "HIDDEN"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

export const askQuestionSchema = z.object({
  question: z.string().trim().min(3, "প্রশ্ন লিখুন").max(1000),
});
export type AskQuestionInput = z.infer<typeof askQuestionSchema>;

/** Admin moderation: answer a question, hide it, or restore it. */
export const moderateQuestionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("answer"),
    answer: z.string().trim().min(1, "উত্তর লিখুন").max(5000),
  }),
  z.object({ action: z.literal("hide") }),
  z.object({ action: z.literal("restore") }),
]);
export type ModerateQuestionInput = z.infer<typeof moderateQuestionSchema>;
