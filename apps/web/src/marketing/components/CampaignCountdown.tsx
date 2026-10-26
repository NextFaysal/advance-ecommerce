"use client";

// Campaign countdown — renders ONLY against a real configured end
// instant passed by the server (campaign endsAt, or the live flash
// sale's own endsAt). No target = the server never mounts this. When
// the instant passes the component hides itself rather than showing
// a fake "ended" urgency state.
import { useEffect, useState } from "react";

function parts(ms: number): { d: number; h: number; m: number; s: number } {
  const total = Math.max(0, Math.floor(ms / 1000));
  return {
    d: Math.floor(total / 86400),
    h: Math.floor((total % 86400) / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  };
}

export function CampaignCountdown({ endsAtIso }: { endsAtIso: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return null;
  const remaining = new Date(endsAtIso).getTime() - now;
  if (remaining <= 0) return null;
  const { d, h, m, s } = parts(remaining);
  const cell = "min-w-14 rounded-xl bg-white/15 px-2 py-1.5 text-center backdrop-blur";
  return (
    <div className="mt-5" aria-label="ক্যাম্পেইন শেষ হতে বাকি সময়">
      <p className="text-xs font-semibold uppercase tracking-wide text-white/80">অফার শেষ হতে বাকি</p>
      <div className="mt-2 flex gap-2 text-white">
        <div className={cell}>
          <div className="text-xl font-extrabold tabular-nums">{d}</div>
          <div className="text-[11px] text-white/75">দিন</div>
        </div>
        <div className={cell}>
          <div className="text-xl font-extrabold tabular-nums">{h}</div>
          <div className="text-[11px] text-white/75">ঘণ্টা</div>
        </div>
        <div className={cell}>
          <div className="text-xl font-extrabold tabular-nums">{m}</div>
          <div className="text-[11px] text-white/75">মিনিট</div>
        </div>
        <div className={cell}>
          <div className="text-xl font-extrabold tabular-nums">{s}</div>
          <div className="text-[11px] text-white/75">সেকেন্ড</div>
        </div>
      </div>
    </div>
  );
}
