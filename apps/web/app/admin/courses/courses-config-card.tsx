"use client";

/**
 * Courses config editor — self-fetching client card (ADV-23
 * vertical 6, wave 56). Edits the Setting doc `courses.config`
 * through PUT /api/v1/admin/courses/config (settings.edit +
 * reason, audited server-side). Course variants are one variant ID
 * per line — a variant IS a course variant only while its ID is on
 * this list (the config list is the v1 course marker; the content
 * itself is authored per product in the content card above).
 */
import { useCallback, useEffect, useState } from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { interpolate, pick } from "@/i18n/locale";
import { COURSES_STRINGS } from "./strings";

interface CoursesConfig {
  courseVariantIds: string[];
}

interface ConfigData {
  moduleEnabled: boolean;
  source: "saved" | "default";
  config: CoursesConfig;
}

const INPUT_CLASS =
  "w-full rounded-xl border border-border bg-card px-3 py-2 text-sm text-text-main shadow-xs outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export function CoursesConfigCard() {
  const { locale } = useLocale();
  const s = pick(locale, COURSES_STRINGS);
  const [data, setData] = useState<ConfigData | null>(null);
  const [variantIdsText, setVariantIdsText] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/courses/config", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as {
        data?: ConfigData;
        error?: { message?: string };
      } | null;
      if (!res.ok || !json?.data) {
        setError(json?.error?.message ?? s.configLoadFailed);
        return;
      }
      setData(json.data);
      setVariantIdsText(json.data.config.courseVariantIds.join("\n"));
      setError(null);
    } catch {
      setError(s.configLoadNetwork);
    }
  }, [s]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const courseVariantIds = variantIdsText
        .split("\n")
        .map((v) => v.trim())
        .filter((v) => v !== "");
      const res = await fetch("/api/v1/admin/courses/config", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ courseVariantIds, reason }),
      });
      const json = (await res.json().catch(() => null)) as {
        error?: { message?: string };
      } | null;
      if (!res.ok) {
        setError(json?.error?.message ?? s.configSaveFailed);
        return;
      }
      setNotice(s.configSaved);
      setReason("");
      await load();
    } catch {
      setError(s.configSaveNetwork);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-xs">
      <h2 className="font-display text-base font-bold text-text-main">{s.configTitle}</h2>
      <p className="mt-1 text-sm leading-6 text-text-muted">
        {s.configIntro}{" "}
        {data
          ? interpolate(s.configSourceLine, {
              source: data.source === "saved" ? s.sourceSaved : s.sourceDefault,
              state: data.moduleEnabled ? s.stateOn : s.stateOff,
            })
          : ""}
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-sm font-medium text-danger">
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
          <span className="font-medium text-text-main">{s.variantIdsLabel}</span>
          <textarea
            className={INPUT_CLASS + " min-h-[96px] font-mono text-xs"}
            value={variantIdsText}
            onChange={(e) => setVariantIdsText(e.target.value)}
            placeholder={"variant-id-1\nvariant-id-2"}
          />
          <span className="text-xs text-text-muted">{s.variantIdsHelp}</span>
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text-main">{s.reasonLabel}</span>
          <input
            className={INPUT_CLASS}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={s.reasonPlaceholderConfig}
          />
        </label>

        <div>
          <button
            type="button"
            disabled={busy || reason.trim() === ""}
            onClick={save}
            className="inline-flex items-center justify-center rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? s.saving : s.saveConfig}
          </button>
        </div>
      </div>
    </section>
  );
}
