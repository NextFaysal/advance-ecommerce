/**
 * PDP product Q&A section — server component. Renders ANSWERED
 * questions only (src/qa/store.ts enforces the visibility contract:
 * PENDING waits in the admin moderation queue, HIDDEN never shows)
 * plus the ask form. Asking requires a signed-in customer — guests
 * see a login prompt instead of the form, and the API enforces the
 * same rule with a 401. The signed-in-vs-guest choice is resolved
 * CLIENT-side by AskQuestionGate (via /api/v1/public/account/me)
 * so this section — and the PDP around it — can render statically.
 *
 * Fail-safe like the review section beside it: a store problem
 * degrades to the honest empty state instead of breaking the PDP.
 */
import { listAnsweredQuestions } from "@/qa/store";
import { AskQuestionGate } from "./AskQuestionGate";

function bnDate(iso: string): string {
  return new Date(iso).toLocaleDateString("bn-BD", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export async function QuestionsSection({
  productId,
  productSlug,
}: {
  productId: string;
  productSlug: string;
}) {
  const questions = await listAnsweredQuestions(productId).catch(() => []);

  return (
    <section className="mt-10 rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-8" aria-label="পণ্য সম্পর্কে প্রশ্নোত্তর">
      <h2 className="text-lg font-extrabold text-text-main">প্রশ্ন ও উত্তর</h2>

      {questions.length > 0 ? (
        <ul className="mt-6 space-y-5">
          {questions.map((q) => (
            <li key={q.id} className="border-t border-border pt-5 first:border-t-0 first:pt-0">
              <p className="text-sm font-bold text-text-main">
                <span className="mr-1.5 text-brand-700">প্র:</span>
                {q.question}
              </p>
              <p className="mt-0.5 text-xs text-text-subtle">
                {q.authorName} · {bnDate(q.createdAt)}
              </p>
              <p className="mt-2.5 max-w-3xl break-words text-sm leading-7 text-text-muted [overflow-wrap:anywhere]">
                <span className="mr-1.5 font-bold text-text-main">উ:</span>
                {q.answer}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-sm text-text-muted">
          এই পণ্য নিয়ে এখনো কোনো প্রশ্নের উত্তর প্রকাশিত হয়নি — প্রথম প্রশ্নটি আপনিই করুন।
        </p>
      )}

      <div className="mt-8 border-t border-border pt-6">
        <h3 className="text-base font-extrabold text-text-main">পণ্য সম্পর্কে প্রশ্ন করুন</h3>
        <AskQuestionGate productSlug={productSlug} />
      </div>
    </section>
  );
}
