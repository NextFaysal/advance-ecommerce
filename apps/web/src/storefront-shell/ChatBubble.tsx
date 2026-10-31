"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/icon";

interface ChatBubbleProps {
  storeName?: string;
  supportPhone?: string;
  logoUrl?: string;
}

export function ChatBubble({
  storeName = "Advance Ecommerce",
  supportPhone,
  logoUrl,
}: ChatBubbleProps) {
  const [isOpen, setIsOpen] = useState(false);

  // If no support phone is configured, keep it minimal or hide
  if (!supportPhone) return null;

  const cleanPhone = supportPhone.replace(/\D/g, "");
  const waUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(
    `আসসালামু আলাইকুম! ${storeName} থেকে কিছু জানতে চাচ্ছিলাম।`
  )}`;

  return (
    <div className="fixed bottom-20 right-4 z-40 lg:bottom-6 lg:right-6 font-sans">
      {/* Expanded Chat Card */}
      {isOpen && (
        <div className="mb-3 w-72 sm:w-80 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-2xl transition-all duration-200 animate-in fade-in slide-in-from-bottom-4">
          {/* Header */}
          <div className="brand-gradient p-4 text-white">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {logoUrl ? (
                  <img
                    src={logoUrl}
                    alt={storeName}
                    className="h-7 w-7 rounded-full bg-white/20 object-contain p-0.5"
                  />
                ) : (
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-xs font-bold">
                    {storeName.charAt(0)}
                  </div>
                )}
                <div>
                  <h3 className="text-sm font-semibold leading-none">{storeName}</h3>
                  <p className="mt-1 text-[11px] text-white/80">সরাসরি সাপোর্ট টিম</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-full p-1 text-white/80 hover:bg-white/10 hover:text-white transition"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <p className="mt-2.5 text-xs text-white/95 leading-relaxed">
              স্বাগতম! আপনার কোনো প্রশ্ন বা অর্ডারে সাহায্য প্রয়োজন হলে নিচের মাধ্যমে যোগাযোগ করুন:
            </p>
          </div>

          {/* Action options */}
          <div className="p-3.5 space-y-2 bg-surface">
            {/* WhatsApp */}
            <a
              href={waUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-50/80 p-2.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 transition shadow-xs"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500 text-white font-bold text-sm shadow-xs">
                💬
              </span>
              <div>
                <div className="text-emerald-950 font-bold">WhatsApp-এ চ্যাট করুন</div>
                <div className="text-[11px] text-emerald-700 font-normal">সাধারণত তাৎক্ষণিক উত্তর দেওয়া হয়</div>
              </div>
            </a>

            {/* Direct Call */}
            <a
              href={`tel:${supportPhone}`}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5 text-xs font-semibold text-text-main hover:bg-surface-2 transition shadow-xs"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 font-bold text-sm">
                📞
              </span>
              <div>
                <div className="font-bold">সরাসরি কল করুন</div>
                <div className="text-[11px] text-text-muted font-normal">{supportPhone}</div>
              </div>
            </a>

            {/* Track Order Shortcut */}
            <a
              href="/track"
              className="flex items-center justify-between rounded-xl border border-border/70 bg-card px-3 py-2 text-xs font-medium text-text-muted hover:text-brand-700 hover:border-brand-300 transition"
            >
              <span>🚚 অর্ডার ট্র্যাক করুন</span>
              <span className="text-[11px]">খুলুন →</span>
            </a>
          </div>
        </div>
      )}

      {/* Floating Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="group relative flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 text-white shadow-xl hover:bg-emerald-600 hover:scale-105 active:scale-95 transition-all duration-200"
        aria-label="Customer Support Chat"
      >
        <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-300 opacity-75" />
          <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-400 border-2 border-white" />
        </span>
        {isOpen ? (
          <span className="text-xl font-bold">✕</span>
        ) : (
          <span className="text-2xl">💬</span>
        )}
      </button>
    </div>
  );
}
