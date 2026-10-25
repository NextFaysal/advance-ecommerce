"use client";

// Sourcing import panel — Wave 15-3 (doc 16 §P7).
// Paste a product URL → POST /api/v1/admin/sourcing/preview (server
// fetches + extracts) → merchant reviews/edits EVERYTHING (title,
// images ticked individually, price typed in ৳) → POST .../create
// lands a DRAFT product. Honesty rules baked into the UI:
//  - a foreign price is shown exactly as detected with its currency;
//    the ৳ price field is NEVER auto-filled from a made-up rate —
//    only a BDT price prefills itself;
//  - extraction failures show the server's Bangla reason verbatim;
//  - the create button states the product lands as DRAFT.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { takaStringToPoisha } from "@/catalog/import";

const inputCls =
  "min-h-[44px] w-full rounded-lg border border-border bg-card px-3 py-2 text-sm shadow-sm outline-none transition motion-fast focus:border-brand-500 focus:ring-[3px] focus:ring-brand-100";
const labelCls = "mb-1.5 block text-xs font-semibold text-text-muted";

interface PreviewData {
  sourceUrl: string;
  finalUrl: string;
  title: string | null;
  description: string | null;
  images: string[];
  priceAmount: string | null;
  priceCurrency: string | null;
  strategies: string[];
  truncated: boolean;
}

interface CategoryOption {
  slug: string;
  nameBn: string;
  nameEn?: string;
}

interface CreatedProduct {
  id: string;
  slug: string;
  status: string;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? fallback;
}

export function SourcingPanel() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);

  // Editable draft fields (filled from the preview, owned by the merchant).
  const [titleBn, setTitleBn] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [description, setDescription] = useState("");
  const [pickedImages, setPickedImages] = useState<Set<string>>(new Set());
  const [priceTaka, setPriceTaka] = useState("");
  const [categorySlug, setCategorySlug] = useState("");
  const [brandName, setBrandName] = useState("");
  const [sku, setSku] = useState("");
  const [stock, setStock] = useState("0");
  const [categories, setCategories] = useState<CategoryOption[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedProduct | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/v1/admin/categories")
      .then(async (res) => {
        if (!res.ok) throw new Error("categories");
        const body = (await res.json()) as { data?: { categories?: CategoryOption[] } };
        if (alive) setCategories(body.data?.categories ?? []);
      })
      .catch(() => {
        if (alive) setCategories([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  const runPreview = async () => {
    setError(null);
    setCreated(null);
    setPreview(null);
    if (url.trim().length < 8) {
      setError("পণ্যের পেজের পুরো লিংক দিন (https:// সহ)।");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/v1/admin/sourcing/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      if (!res.ok) throw new Error(await readError(res, "প্রিভিউ আনা যায়নি।"));
      const body = (await res.json()) as { data: PreviewData };
      const p = body.data;
      setPreview(p);
      const title = p.title ?? "";
      setTitleBn(title);
      setTitleEn(title);
      setDescription(p.description ?? "");
      setPickedImages(new Set(p.images));
      // Only a BDT price may prefill the ৳ field — anything else
      // would need a conversion rate, and inventing one is a lie.
      setPriceTaka(p.priceCurrency === "BDT" && p.priceAmount ? p.priceAmount.replace(/,/g, "") : "");
      setSku("");
      setStock("0");
    } catch (e) {
      setError(e instanceof Error ? e.message : "প্রিভিউ আনা যায়নি।");
    } finally {
      setLoading(false);
    }
  };

  const toggleImage = (img: string) => {
    setPickedImages((prev) => {
      const next = new Set(prev);
      if (next.has(img)) next.delete(img);
      else next.add(img);
      return next;
    });
  };

  const runCreate = async () => {
    setError(null);
    if (!preview) return;
    const pricePoisha = takaStringToPoisha(priceTaka);
    if (pricePoisha === undefined) {
      setError("বিক্রয়মূল্য টাকায় সঠিকভাবে লিখুন (যেমন 1250 বা 1250.50)।");
      return;
    }
    if (categorySlug.trim() === "") {
      setError("একটি ক্যাটাগরি বেছে নিন — ক্যাটাগরি ছাড়া পণ্য তৈরি হয় না।");
      return;
    }
    const stockNum = Number(stock);
    if (!Number.isInteger(stockNum) || stockNum < 0) {
      setError("স্টক ০ বা তার বেশি পূর্ণ সংখ্যা হতে হবে।");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/v1/admin/sourcing/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: preview.sourceUrl,
          titleBn: titleBn.trim(),
          titleEn: titleEn.trim() || titleBn.trim(),
          descriptionBn: description.trim() || undefined,
          descriptionEn: description.trim() || undefined,
          categorySlug: categorySlug.trim(),
          brandName: brandName.trim() === "" ? null : brandName.trim(),
          pricePoisha,
          sku: sku.trim() === "" ? undefined : sku.trim(),
          stock: stockNum,
          imageUrls: preview.images.filter((img) => pickedImages.has(img)),
        }),
      });
      if (!res.ok) throw new Error(await readError(res, "পণ্য তৈরি করা যায়নি।"));
      const body = (await res.json()) as { data: { product: CreatedProduct } };
      setCreated(body.data.product);
      setPreview(null);
      setUrl("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "পণ্য তৈরি করা যায়নি।");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="overflow-hidden">
        <div className="brand-gradient -mx-5 -mt-5 mb-5 h-1.5" aria-hidden="true" />
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="brand-gradient flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-md">
            <Icon name="store" size={20} />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-base font-semibold text-text-main">লিংক থেকে পণ্য আনুন</h2>
            <p className="text-xs text-text-subtle">AliExpress / 1688 / Alibaba বা যেকোনো শপের পণ্যের লিংক দিন</p>
          </div>
        </div>
        <label className={`${labelCls} mt-4`} htmlFor="src-url">
          পণ্যের লিংক (AliExpress / 1688 / Alibaba বা যেকোনো শপ)
        </label>
        <div className="flex flex-col gap-2 min-[560px]:flex-row">
          <input
            id="src-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.aliexpress.com/item/…"
            className={`${inputCls} flex-1 font-mono`}
            inputMode="url"
          />
          <button
            type="button"
            onClick={runPreview}
            disabled={loading}
            className="brand-gradient inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold text-white shadow-md transition motion-fast hover:shadow-lift hover:brightness-105 disabled:opacity-50"
          >
            <Icon name="search" size={16} />
            {loading ? "আনা হচ্ছে…" : "প্রিভিউ আনুন"}
          </button>
        </div>
        <p className="mt-3 flex gap-2 text-xs leading-relaxed text-text-subtle">
          <Icon name="info" size={14} className="mt-0.5 shrink-0" />
          <span>
            সার্ভার পেজটি পড়ে নাম, ছবি ও দাম খুঁজে বের করে। অনেক মার্কেটপ্লেস স্বয়ংক্রিয় অ্যাক্সেস আটকায় —
            সেক্ষেত্রে কারণসহ বার্তা দেখাবে, ভুয়া তথ্য বসানো হবে না।
          </span>
        </p>
      </Card>

      {error ? (
        <div role="alert" className="anim-pop-in flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3.5 text-sm text-rose-800 shadow-card">
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
            <Icon name="alert" size={16} />
          </span>
          <p className="leading-relaxed">{error}</p>
        </div>
      ) : null}

      {created ? (
        <div role="status" className="anim-pop-in flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-sm text-emerald-900 shadow-card">
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <Icon name="check" size={16} />
          </span>
          <p className="leading-relaxed">
            ড্রাফট পণ্য তৈরি হয়েছে: <span className="font-mono">{created.slug}</span> —{" "}
            <Link href={`/admin/products/${created.id}`} className="font-medium underline">
              এডিটরে খুলে যাচাই করে পাবলিশ করুন
            </Link>
          </p>
        </div>
      ) : null}

      {preview ? (
        <Card className="overflow-hidden">
          <div className="-mx-5 -mt-5 mb-5 border-b border-border bg-surface-2/70 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base font-semibold text-text-main">প্রিভিউ — যাচাই করে ঠিক করুন</h2>
              <span className="inline-flex h-6 items-center rounded-full bg-amber-50 px-2.5 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                DRAFT হিসেবে তৈরি হবে
              </span>
            </div>
            <p className="mt-1.5 break-all text-xs leading-relaxed text-text-subtle">
              উৎস: <span className="font-mono">{preview.finalUrl}</span>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-text-subtle">যেভাবে পাওয়া গেছে:</span>
              {(preview.strategies.length > 0 ? preview.strategies : ["—"]).map((s) => (
                <span key={s} className="inline-flex h-6 items-center rounded-full bg-brand-50 px-2.5 font-mono text-xs text-brand-700 ring-1 ring-inset ring-brand-100">
                  {s}
                </span>
              ))}
            </div>
          </div>
          <div className="space-y-5">

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="src-title-bn">
                নাম (বাংলা) *
              </label>
              <input id="src-title-bn" value={titleBn} onChange={(e) => setTitleBn(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="src-title-en">
                নাম (English) *
              </label>
              <input id="src-title-en" value={titleEn} onChange={(e) => setTitleEn(e.target.value)} className={inputCls} />
            </div>
          </div>

          <div>
            <label className={labelCls} htmlFor="src-desc">
              বর্ণনা (পেজ থেকে পাওয়া; উৎস লিংকটি তৈরি সময়ে নিচে যোগ হবে)
            </label>
            <textarea
              id="src-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className={inputCls}
            />
          </div>

          <div>
            <span className={labelCls}>ছবি — যেগুলো নিতে চান টিক দিন ({pickedImages.size}/{preview.images.length})</span>
            {preview.images.length === 0 ? (
              <p className="text-sm text-text-subtle">এই পেজে কোনো ছবি পাওয়া যায়নি — পণ্য ছবি ছাড়াই তৈরি হবে, পরে এডিটরে যোগ করতে পারবেন।</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {preview.images.map((img) => {
                  const picked = pickedImages.has(img);
                  return (
                    <button
                      key={img}
                      type="button"
                      onClick={() => toggleImage(img)}
                      aria-pressed={picked}
                      className={`relative min-h-[44px] overflow-hidden rounded-xl border-2 transition motion-fast ${
                        picked
                          ? "border-brand-500 opacity-100 ring-2 ring-brand-200"
                          : "border-border opacity-55 hover:opacity-90"
                      }`}
                    >
                      {/* Remote marketplace thumbnails — plain img is intentional (unknown hosts, no next/image config). */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                      <span
                        aria-hidden="true"
                        className={`absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full text-white shadow ${
                          picked ? "brand-gradient" : "bg-black/50"
                        }`}
                      >
                        <Icon name={picked ? "check" : "minus"} size={13} />
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <span className={labelCls}>পেজে শনাক্ত দাম</span>
              <p className="flex min-h-[44px] items-center rounded-lg border border-brand-100 bg-brand-50/60 px-3 py-2 font-mono text-base font-semibold text-brand-800">
                {preview.priceAmount
                  ? `${preview.priceAmount} ${preview.priceCurrency ?? ""}`.trim()
                  : "দাম পাওয়া যায়নি — নিজে লিখুন"}
              </p>
            </div>
            <div>
              <label className={labelCls} htmlFor="src-price">
                বিক্রয়মূল্য (৳) *
              </label>
              <input
                id="src-price"
                value={priceTaka}
                onChange={(e) => setPriceTaka(e.target.value)}
                placeholder="যেমন 1850"
                inputMode="decimal"
                className={inputCls}
              />
              {preview.priceCurrency && preview.priceCurrency !== "BDT" ? (
                <p className="mt-1 text-xs text-amber-700">
                  বিদেশি দাম নিজে থেকে টাকায় বদলানো হয়নি — আপনার রেটে হিসাব করে লিখুন (ক্যালকুলেটর ট্যাব সাহায্য করবে)।
                </p>
              ) : null}
            </div>
            <div>
              <label className={labelCls} htmlFor="src-stock">
                প্রাথমিক স্টক
              </label>
              <input id="src-stock" value={stock} onChange={(e) => setStock(e.target.value)} inputMode="numeric" className={inputCls} />
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <label className={labelCls} htmlFor="src-category">
                ক্যাটাগরি *
              </label>
              {categories && categories.length > 0 ? (
                <select id="src-category" value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} className={inputCls}>
                  <option value="">— বেছে নিন —</option>
                  {categories.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.nameBn} ({c.slug})
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="src-category"
                  value={categorySlug}
                  onChange={(e) => setCategorySlug(e.target.value)}
                  placeholder="ক্যাটাগরি slug, যেমন fashion"
                  className={inputCls}
                />
              )}
            </div>
            <div>
              <label className={labelCls} htmlFor="src-brand">
                ব্র্যান্ড (ঐচ্ছিক)
              </label>
              <input id="src-brand" value={brandName} onChange={(e) => setBrandName(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="src-sku">
                SKU (খালি রাখলে নিজে তৈরি হবে)
              </label>
              <input id="src-sku" value={sku} onChange={(e) => setSku(e.target.value)} className={`${inputCls} font-mono`} />
            </div>
          </div>

          <div className="sticky bottom-3 z-10 flex flex-col gap-2 rounded-xl border border-border bg-card/95 p-3 shadow-lift backdrop-blur sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={runCreate}
              disabled={creating || titleBn.trim() === ""}
              className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 py-2 text-sm font-semibold text-white shadow-md transition motion-fast hover:bg-emerald-700 hover:shadow-lift disabled:opacity-50"
            >
              <Icon name="plus" size={16} />
              {creating ? "তৈরি হচ্ছে…" : "ড্রাফট পণ্য তৈরি করুন"}
            </button>
            <p className="text-xs leading-relaxed text-text-subtle">পণ্যটি DRAFT হিসেবে তৈরি হবে — এডিটরে যাচাই না করে কখনো সরাসরি পাবলিশ হয় না।</p>
          </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
