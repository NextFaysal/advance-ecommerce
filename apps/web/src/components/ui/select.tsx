"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";
import { Icon } from "./icon";
import { useLocale } from "@/i18n/LocaleProvider";
import { pick } from "@/i18n/locale";
import { UI_STRINGS } from "./strings";

export type SelectOption = { value: string; label: string };

/**
 * Combobox (Design System v4, doc 31 D3) — search field with icon,
 * pop-shadow list, selected row with check mark; v4 input shell
 * (rounded-xl, token focus halo). API unchanged from v1. The listbox
 * renders only while open; ArrowUp/ArrowDown move the active option,
 * Enter selects it, Escape closes, and the input carries
 * aria-expanded / aria-controls / aria-activedescendant (doc 35
 * wave 4).
 */
export function Combobox({
  label,
  options,
  value,
  onChange,
  placeholder,
}: {
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const { locale } = useLocale();
  const s = pick(locale, UI_STRINGS);
  const effectivePlaceholder = placeholder ?? s.comboboxPlaceholder;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const listboxId = `combobox-${uid}-listbox`;
  const optionId = (index: number) => `combobox-${uid}-option-${index}`;
  const filtered = useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()) || o.value.toLowerCase().includes(query.toLowerCase())),
    [options, query],
  );

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
    // optionId is stable per render; only the active index drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIndex]);

  const selectOption = (option: SelectOption) => {
    onChange(option.value);
    setOpen(false);
    setActiveIndex(-1);
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(filtered.length > 0 ? 0 : -1);
        return;
      }
      if (filtered.length === 0) return;
      setActiveIndex((prev) => {
        if (e.key === "ArrowDown") return prev < filtered.length - 1 ? prev + 1 : 0;
        return prev > 0 ? prev - 1 : filtered.length - 1;
      });
      return;
    }
    if (e.key === "Enter" && open && activeIndex >= 0 && filtered[activeIndex]) {
      e.preventDefault();
      selectOption(filtered[activeIndex]);
      return;
    }
    if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const onRootBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div onBlur={onRootBlur}>
      {label ? <span className="mb-1.5 block text-sm font-medium text-text-main">{label}</span> : null}
      <span className="flex h-11 items-center gap-2 rounded-xl border border-border bg-surface px-3 shadow-xs transition duration-base ease-smooth focus-within:border-brand-ink focus-within:ring-[3px] focus-within:ring-brand-ink/15">
        <span aria-hidden="true" className="shrink-0 text-text-subtle">
          <Icon name="search" size={17} />
        </span>
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKeyDown}
          placeholder={effectivePlaceholder}
          aria-label={label ?? effectivePlaceholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          className="w-full bg-transparent text-sm text-text-main outline-none placeholder:text-text-subtle"
        />
      </span>
      {open ? (
        <div id={listboxId} role="listbox" className="mt-2 max-h-44 overflow-auto rounded-2xl border border-border/60 bg-surface-raised p-1 shadow-pop">
          {filtered.length === 0 ? <p className="px-3 py-2.5 text-sm text-text-muted">{s.noResultsFound}</p> : null}
          {filtered.map((o, index) => {
            const selected = value === o.value;
            const active = index === activeIndex;
            return (
              <button
                key={o.value}
                id={optionId(index)}
                type="button"
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(o)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition duration-fast ease-smooth hover:bg-surface-2 ${active ? "bg-surface-2" : ""} ${selected ? "bg-brand-soft font-medium text-brand-ink" : "text-text-main"}`}
              >
                {o.label}
                {selected ? <Icon name="check" size={15} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
