"use client";

/**
 * Team chat panel (ADV-27 remainder, doc 23 wave 53-3) — the one
 * general staff room on /admin/team.
 *
 * HOW IT UPDATES: polling, NOT realtime. The panel re-fetches every
 * 15 seconds; this codebase has no websocket/socket server and this
 * panel does not pretend otherwise (the caption under the room says
 * exactly that). Sending appends the server's returned message
 * immediately so the sender never waits for the next poll.
 *
 * The room is DB-backed (Setting docs), so it keeps working when
 * Redis is down — presence is the only Redis-backed piece of ADV-27.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface ChatMessage {
  id: string;
  userId: string;
  userName: string;
  body: string;
  sentAt: string;
}

interface ChatData {
  me: { id: string; name: string };
  messages: ChatMessage[];
}

const POLL_MS = 15_000;

function formatSentAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

export function ChatPanel() {
  const [meId, setMeId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/team/chat", { cache: "no-store" });
      const json = (await res.json()) as { data?: ChatData; error?: { message: string } };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? "বার্তা আনা যায়নি।");
        return;
      }
      setMeId(json.data.me.id);
      setMessages(json.data.messages);
      setError("");
    } catch {
      setError("নেটওয়ার্ক ত্রুটি।");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Keep the view pinned to the newest message only while the reader
  // is already near the bottom — polling must not yank the scroll
  // away from someone reading history.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  const send = async () => {
    const body = draft.trim();
    if (body === "" || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/v1/admin/team/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const json = (await res.json()) as {
        data?: { message: ChatMessage };
        error?: { message: string };
      };
      if (!res.ok || !json.data) {
        setError(json.error?.message ?? "বার্তা পাঠানো যায়নি।");
        return;
      }
      setDraft("");
      setError("");
      stickToBottomRef.current = true;
      setMessages((prev) =>
        prev.some((m) => m.id === json.data!.message.id) ? prev : [...prev, json.data!.message],
      );
    } catch {
      setError("নেটওয়ার্ক ত্রুটি।");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h3">টিম চ্যাট</h2>
        <p className="text-caption text-text-subtle">
          প্রতি ১৫ সেকেন্ডে হালনাগাদ হয় (polling — realtime নয়)। সর্বশেষ ১০০টি বার্তা দেখানো হচ্ছে;
          প্রতি মাসে সর্বোচ্চ ১,০০০টি বার্তা থাকে, পুরনোগুলো মুছে যায় — স্থায়ী রেকর্ডের জন্য অর্ডার
          নোট/টিকিট ব্যবহার করুন।
        </p>
      </div>
      {error !== "" && <p className="mb-2 text-small font-medium text-rose-600">{error}</p>}
      <div
        ref={listRef}
        onScroll={onScroll}
        className="mb-4 max-h-96 space-y-3 overflow-y-auto rounded-md bg-surface-2 p-4"
      >
        {messages.length === 0 && (
          <p className="text-small text-text-subtle">এখনো কোনো বার্তা নেই — প্রথম বার্তাটি লিখুন।</p>
        )}
        {messages.map((m) => {
          const mine = meId !== null && m.userId === meId;
          return (
            <div key={m.id} className={mine ? "text-right" : "text-left"}>
              <p className="text-caption text-text-subtle">
                <span className="font-semibold text-text">{mine ? "আপনি" : m.userName || "স্টাফ"}</span>{" "}
                · {formatSentAt(m.sentAt)}
              </p>
              <p className="inline-block max-w-[85%] whitespace-pre-wrap rounded-md bg-card px-3 py-2 text-left text-small leading-relaxed">
                {m.body}
              </p>
            </div>
          );
        })}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex items-end gap-2"
      >
        <textarea
          aria-label="চ্যাট বার্তা"
          className="min-h-11 flex-1 rounded-md border border-border bg-card p-3 text-small"
          rows={2}
          maxLength={1000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="টিমের জন্য বার্তা লিখুন…"
        />
        <Button type="submit" disabled={busy || draft.trim() === ""} className="min-h-[44px]">
          পাঠান
        </Button>
      </form>
    </Card>
  );
}
