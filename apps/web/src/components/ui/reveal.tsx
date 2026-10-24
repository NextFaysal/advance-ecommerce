"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { CSSProperties, ElementType, ReactNode } from "react";

/**
 * Reveal (Design System v3, plan §2) — reveal-on-scroll wrapper.
 *
 * Renders `children` inside `as` (default <div>) with the `.reveal` class.
 * On mount it adds `.reveal-init` (the CSS hidden state) and observes the
 * element; the first time it enters the viewport it adds `.is-revealed`
 * and stops observing. SSR / no-JS output carries NO hidden state, so
 * content is never invisible if hydration fails. With
 * prefers-reduced-motion (or no IntersectionObserver) the content is
 * revealed immediately.
 *
 * `delay` (ms) staggers siblings: it is passed to the CSS as
 * `--reveal-delay`, which the `.reveal` transition consumes as its delay.
 *
 * Note: `.reveal` sets the element's `transition` — don't put other
 * transition utilities on the same element; wrap instead.
 *
 *   <Reveal as="section" delay={120} className="mt-10">…</Reveal>
 */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export function Reveal({
  as: Tag = "div",
  delay = 0,
  className = "",
  style,
  id,
  children,
}: {
  as?: ElementType;
  delay?: number;
  className?: string;
  style?: CSSProperties;
  id?: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  // Callback ref: a (HTMLElement | null) handler is assignable to any
  // concrete element's ref prop, whatever `as` renders.
  const setRef = (node: HTMLElement | null) => {
    ref.current = node;
  };

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || typeof IntersectionObserver === "undefined") {
      el.classList.add("is-revealed");
      return;
    }
    el.classList.add("reveal-init");
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={setRef}
      id={id}
      className={`reveal ${className}`}
      style={{ "--reveal-delay": `${delay}ms`, ...style } as CSSProperties}
    >
      {children}
    </Tag>
  );
}
