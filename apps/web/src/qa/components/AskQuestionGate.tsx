"use client";

/**
 * Signed-in gate for the PDP Q&A ask form. Asking requires a
 * signed-in customer — guests see a login prompt instead (and the
 * questions API enforces the same rule with a 401).
 *
 * The PDP renders statically, so the choice can no longer be made
 * server-side from the session cookie. It is resolved here on
 * mount via GET /api/v1/public/account/me (200 with
 * { data: { customer } } when signed in, 401 for guests). While
 * unresolved, a neutral placeholder of similar height renders —
 * neither the form nor the prompt flashes first.
 */
import { useEffect, useState } from "react";
import { AskQuestionForm } from "./AskQuestionForm";

export function AskQuestionGate({ productSlug }: { productSlug: string }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/v1/public/account/me")
      .then((res) => {
        if (alive) setSignedIn(res.ok);
      })
      .catch(() => {
        if (alive) setSignedIn(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (signedIn === null) {
    return <div className="mt-1 min-h-[15rem]" aria-hidden="true" />;
  }

  if (signedIn) {
    return (
      <>
        <p className="mt-1 text-sm text-text-muted">
          আমাদের টিম উত্তর দিলেই প্রশ্নোত্তরটি এখানে প্রকাশিত হবে।
        </p>
        <AskQuestionForm productSlug={productSlug} />
      </>
    );
  }

  return (
    <p className="mt-1 text-sm leading-6 text-text-muted">
      প্রশ্ন করতে{" "}
      <a href="/account" className="font-semibold text-brand-700 hover:underline">
        লগইন করুন
      </a>{" "}
      — লগইন করা গ্রাহকদের প্রশ্নই শুধু নেওয়া হয়, যাতে উত্তরগুলো নির্ভরযোগ্য থাকে।
    </p>
  );
}
