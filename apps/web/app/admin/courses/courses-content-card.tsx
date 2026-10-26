"use client";

/**
 * Course content editor — self-fetching client card (ADV-23
 * vertical 6, wave 56). Picks a course product (from
 * GET /api/v1/admin/courses/contents — only products with a
 * variant listed in courses.config appear), loads its content
 * document, and edits modules/lessons as structured forms. Saving
 * PUTs the whole document (products.edit + reason, audited
 * server-side).
 *
 * Video lessons take a YouTube/Vimeo page or share URL — the
 * SERVER normalises it to the embed URL and rejects any other
 * host with a 400, which this card surfaces verbatim. Text lessons
 * are merchant markdown, rendered for buyers through the
 * platform's escape-first renderer (the PDP/blog renderer), never
 * raw HTML.
 */
import { useCallback, useEffect, useState } from "react";

type LessonKind = "video" | "text" | "link";

interface LessonForm {
  id: string;
  title: string;
  kind: LessonKind;
  videoUrl: string;
  bodyMd: string;
  externalUrl: string;
}

interface ModuleForm {
  title: string;
  lessons: LessonForm[];
}

interface ProductSummary {
  productId: string;
  productName: string | null;
  slug: string | null;
  variants: { variantId: string; sku: string; variantLabel: string }[];
  hasContent: boolean;
  moduleCount: number;
  lessonCount: number;
}

interface StoredLesson {
  id: string;
  title: string;
  kind: LessonKind;
  videoUrl?: string;
  bodyMd?: string;
  externalUrl?: string;
}

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-text-main";
const SMALL_BUTTON =
  "rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-text-main transition hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50";

let idCounter = 0;
function newLessonId(): string {
  idCounter += 1;
  return `les_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

function emptyLesson(): LessonForm {
  return { id: newLessonId(), title: "", kind: "video", videoUrl: "", bodyMd: "", externalUrl: "" };
}

export function CoursesContentCard() {
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [productId, setProductId] = useState<string>("");
  const [modules, setModules] = useState<ModuleForm[]>([]);
  const [docSource, setDocSource] = useState<"saved" | "default" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadProducts = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/courses/contents", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as {
        data?: { products: ProductSummary[] };
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.data) {
        setError(json?.error?.message ?? "কোর্স পণ্যের তালিকা লোড করা যায়নি।");
        return;
      }
      setProducts(json.data.products);
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — কোর্স পণ্যের তালিকা লোড করা যায়নি।");
    }
  }, []);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const loadDoc = useCallback(async (id: string) => {
    if (id === "") {
      setModules([]);
      setDocSource(null);
      return;
    }
    setLoadingDoc(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/courses/contents?productId=${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as {
        data?: {
          source: "saved" | "default";
          doc: { modules: { title: string; lessons: StoredLesson[] }[] } | null;
        };
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.data) {
        setError(json?.error?.message ?? "কন্টেন্ট লোড করা যায়নি।");
        setModules([]);
        return;
      }
      setDocSource(json.data.source);
      const doc = json.data.doc;
      setModules(
        doc
          ? doc.modules.map((m) => ({
              title: m.title,
              lessons: m.lessons.map((l) => ({
                id: l.id,
                title: l.title,
                kind: l.kind,
                videoUrl: l.videoUrl ?? "",
                bodyMd: l.bodyMd ?? "",
                externalUrl: l.externalUrl ?? "",
              })),
            }))
          : [],
      );
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — কন্টেন্ট লোড করা যায়নি।");
    } finally {
      setLoadingDoc(false);
    }
  }, []);

  function updateModule(mi: number, patch: Partial<ModuleForm>) {
    setModules((prev) => prev.map((m, i) => (i === mi ? { ...m, ...patch } : m)));
  }

  function updateLesson(mi: number, li: number, patch: Partial<LessonForm>) {
    setModules((prev) =>
      prev.map((m, i) =>
        i === mi
          ? { ...m, lessons: m.lessons.map((l, j) => (j === li ? { ...l, ...patch } : l)) }
          : m,
      ),
    );
  }

  function move<T>(arr: T[], from: number, to: number): T[] {
    if (to < 0 || to >= arr.length) return arr;
    const next = [...arr];
    const [item] = next.splice(from, 1);
    if (item === undefined) return arr;
    next.splice(to, 0, item);
    return next;
  }

  async function save() {
    if (productId === "") return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const payloadModules = modules.map((m) => ({
        title: m.title,
        lessons: m.lessons.map((l) => ({
          id: l.id,
          title: l.title,
          kind: l.kind,
          ...(l.kind === "video" ? { videoUrl: l.videoUrl } : {}),
          ...(l.kind === "text" ? { bodyMd: l.bodyMd } : {}),
          ...(l.kind === "link" ? { externalUrl: l.externalUrl } : {}),
        })),
      }));
      const res = await fetch("/api/v1/admin/courses/contents", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ productId, modules: payloadModules, reason }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: { message?: string; details?: unknown };
      } | null;
      if (!res.ok) {
        const details = Array.isArray(json?.error?.details)
          ? ` (${(json.error.details as string[]).join("; ")})`
          : "";
        setError((json?.error?.message ?? "কন্টেন্ট সংরক্ষণ করা যায়নি।") + details);
        return;
      }
      setNotice("কন্টেন্ট সংরক্ষিত হয়েছে।");
      setReason("");
      await loadProducts();
      await loadDoc(productId);
    } catch {
      setError("নেটওয়ার্ক ত্রুটি — কন্টেন্ট সংরক্ষণ করা যায়নি।");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <h2 className="font-display text-base font-bold text-text-main">পাঠ্যক্রম (কন্টেন্ট)</h2>
      <p className="mt-1 text-sm leading-6 text-text-muted">
        পণ্য বেছে মডিউল ও লেসন সাজান। সর্বোচ্চ ২০টি মডিউল, প্রতি মডিউলে ৫০টি লেসন। PDP-তে
        শুধু মডিউল/লেসনের <strong>নাম</strong> সবাই দেখতে পায় — লেসনের ভেতরের কন্টেন্ট শুধু
        ক্রেতারা অ্যাকাউন্ট থেকে দেখতে পায়।
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-red-700 dark:text-red-300">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-3 text-sm font-medium text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4">
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text-main">কোর্স পণ্য</span>
          <select
            className={INPUT_CLASS + " max-w-xl"}
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              void loadDoc(e.target.value);
            }}
          >
            <option value="">— পণ্য বেছে নিন —</option>
            {(products ?? []).map((p) => (
              <option key={p.productId} value={p.productId}>
                {p.productName ?? p.productId} ({p.variants.map((v) => v.sku).join(", ")}) —{" "}
                {p.hasContent ? `${p.moduleCount}টি মডিউল, ${p.lessonCount}টি লেসন` : "কন্টেন্ট নেই"}
              </option>
            ))}
          </select>
          {products !== null && products.length === 0 ? (
            <span className="text-xs text-text-muted">
              কোনো কোর্স পণ্য নেই — আগে নিচের কনফিগ কার্ডে কোর্স ভ্যারিয়েন্টের আইডি যোগ করুন।
            </span>
          ) : null}
          {docSource ? (
            <span className="text-xs text-text-muted">
              উৎস: {docSource === "saved" ? "সংরক্ষিত ডকুমেন্ট" : "এখনো কোনো কন্টেন্ট সংরক্ষণ হয়নি"}
            </span>
          ) : null}
        </label>

        {productId !== "" ? (
          <>
            <div className="space-y-4">
              {modules.map((mod, mi) => (
                <fieldset key={mi} className="rounded-xl border border-border p-3 sm:p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-text-main">মডিউল {mi + 1}</span>
                    <input
                      className={INPUT_CLASS + " min-w-[220px] flex-1"}
                      value={mod.title}
                      onChange={(e) => updateModule(mi, { title: e.target.value })}
                      placeholder="মডিউলের নাম"
                    />
                    <button type="button" className={SMALL_BUTTON} disabled={mi === 0} onClick={() => setModules((p) => move(p, mi, mi - 1))}>↑</button>
                    <button type="button" className={SMALL_BUTTON} disabled={mi === modules.length - 1} onClick={() => setModules((p) => move(p, mi, mi + 1))}>↓</button>
                    <button
                      type="button"
                      className={SMALL_BUTTON}
                      onClick={() => setModules((p) => p.filter((_, i) => i !== mi))}
                    >
                      মডিউল মুছুন
                    </button>
                  </div>

                  <div className="mt-3 space-y-3">
                    {mod.lessons.map((lesson, li) => (
                      <div key={lesson.id} className="rounded-lg bg-card p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            className={INPUT_CLASS + " min-w-[200px] flex-1"}
                            value={lesson.title}
                            onChange={(e) => updateLesson(mi, li, { title: e.target.value })}
                            placeholder="লেসনের নাম"
                          />
                          <select
                            className={INPUT_CLASS + " w-auto"}
                            value={lesson.kind}
                            onChange={(e) => updateLesson(mi, li, { kind: e.target.value as LessonKind })}
                          >
                            <option value="video">ভিডিও</option>
                            <option value="text">লেখা</option>
                            <option value="link">লিংক</option>
                          </select>
                          <button type="button" className={SMALL_BUTTON} disabled={li === 0} onClick={() => updateModule(mi, { lessons: move(mod.lessons, li, li - 1) })}>↑</button>
                          <button type="button" className={SMALL_BUTTON} disabled={li === mod.lessons.length - 1} onClick={() => updateModule(mi, { lessons: move(mod.lessons, li, li + 1) })}>↓</button>
                          <button
                            type="button"
                            className={SMALL_BUTTON}
                            onClick={() => updateModule(mi, { lessons: mod.lessons.filter((_, j) => j !== li) })}
                          >
                            মুছুন
                          </button>
                        </div>
                        {lesson.kind === "video" ? (
                          <input
                            className={INPUT_CLASS + " mt-2"}
                            value={lesson.videoUrl}
                            onChange={(e) => updateLesson(mi, li, { videoUrl: e.target.value })}
                            placeholder="YouTube বা Vimeo লিংক (watch/share/embed যেকোনোটি)"
                          />
                        ) : null}
                        {lesson.kind === "text" ? (
                          <textarea
                            className={INPUT_CLASS + " mt-2 min-h-[140px]"}
                            value={lesson.bodyMd}
                            onChange={(e) => updateLesson(mi, li, { bodyMd: e.target.value })}
                            placeholder={"লেসনের লেখা (Markdown: ## শিরোনাম, **বোল্ড**, - তালিকা) — সর্বোচ্চ ২০,০০০ অক্ষর"}
                          />
                        ) : null}
                        {lesson.kind === "link" ? (
                          <input
                            className={INPUT_CLASS + " mt-2"}
                            value={lesson.externalUrl}
                            onChange={(e) => updateLesson(mi, li, { externalUrl: e.target.value })}
                            placeholder="https://…"
                          />
                        ) : null}
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    className={SMALL_BUTTON + " mt-3"}
                    disabled={mod.lessons.length >= 50}
                    onClick={() => updateModule(mi, { lessons: [...mod.lessons, emptyLesson()] })}
                  >
                    + লেসন যোগ করুন
                  </button>
                </fieldset>
              ))}
            </div>

            <div>
              <button
                type="button"
                className={SMALL_BUTTON}
                disabled={modules.length >= 20}
                onClick={() => setModules((p) => [...p, { title: "", lessons: [] }])}
              >
                + মডিউল যোগ করুন
              </button>
            </div>

            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-text-main">পরিবর্তনের কারণ (বাধ্যতামূলক)</span>
              <input
                className={INPUT_CLASS}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="যেমন: ৩ নম্বর মডিউল যোগ"
              />
            </label>

            <div>
              <button
                type="button"
                disabled={busy || loadingDoc || reason.trim() === ""}
                onClick={save}
                className="inline-flex items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "সংরক্ষণ হচ্ছে…" : "কন্টেন্ট সংরক্ষণ করুন"}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
