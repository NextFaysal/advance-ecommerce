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
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, intlLocale, pick } from "@/i18n/locale";
import { TEAM_STRINGS } from "./strings";

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

function formatSentAt(iso: string, localeTag: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(localeTag, {
    timeZone: "Asia/Dhaka",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

export function ChatPanel() {
  const { locale } = useLocale();
  const s = pick(locale, TEAM_STRINGS);
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
        setError(json.error?.message ?? s.chatLoadFailed);
        return;
      }
      setMeId(json.data.me.id);
      setMessages(json.data.messages);
      setError("");
    } catch {
      setError(s.networkError);
    }
  }, [s]);

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
        setError(json.error?.message ?? s.chatSendFailed);
        return;
      }
      setDraft("");
      setError("");
      stickToBottomRef.current = true;
      setMessages((prev) =>
        prev.some((m) => m.id === json.data!.message.id) ? prev : [...prev, json.data!.message],
      );
    } catch {
      setError(s.networkError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-h3">{s.chatTitle}</h2>
        <p className="text-caption text-text-subtle">
          {s.chatNote}
        </p>
      </div>
      {error !== "" && <p className="mb-2 text-small font-medium text-rose-600">{error}</p>}
      <div
        ref={listRef}
        onScroll={onScroll}
        className="mb-4 max-h-96 space-y-3 overflow-y-auto rounded-md bg-surface-2 p-4"
      >
        {messages.length === 0 && (
          <p className="text-small text-text-subtle">{s.chatEmpty}</p>
        )}
        {messages.map((m) => {
          const mine = meId !== null && m.userId === meId;
          return (
            <div key={m.id} className={mine ? "text-right" : "text-left"}>
              <p className="text-caption text-text-subtle">
                <span className="font-semibold text-text">{mine ? s.chatYou : m.userName || s.chatStaffFallback}</span>{" "}
                · {formatSentAt(m.sentAt, intlLocale(locale))}
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
          aria-label={s.chatInputLabel}
          className="min-h-11 flex-1 rounded-md border border-border bg-card p-3 text-small"
          rows={2}
          maxLength={1000}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={s.chatPlaceholder}
        />
        <Button type="submit" disabled={busy || draft.trim() === ""} className="min-h-[44px]">
          {s.chatSendBtn}
        </Button>
      </form>
    </Card>
  );
}
