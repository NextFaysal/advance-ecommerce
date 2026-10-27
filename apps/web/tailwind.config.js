/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#EEF2FF", 100: "#E0E7FF", 200: "#C7D2FE", 300: "#A5B4FC",
          400: "#818CF8", 500: "#6366F1", 600: "#4F46E5", 700: "#4338CA",
          800: "#3730A3", 900: "#312E81",
        },
        violet: { 500: "#8B5CF6", 600: "#7C3AED" },
        pink: { 500: "#EC4899" },
        amber: { 500: "#F59E0B" },
        emerald: { 500: "#10B981" },
        sky: { 500: "#0EA5E9" },
        rose: { 500: "#F43F5E" },
        teal: { 500: "#14B8A6" },
        orange: { 500: "#F97316" },
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        info: "hsl(var(--info))",
        /* Theme-token colours (globals.css vars, overridden per-theme by
           the theme engine's injected stylesheet). These names were
           referenced by components (admin + storefront) but never mapped
           here, so the utilities silently generated nothing; mapping
           them makes the token utilities real and lets former brand-*
           call sites follow the active theme. Like the entries above,
           the plain hsl(var(--…)) form still supports opacity modifiers
           (Tailwind injects the alpha into the hsl() call). */
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        ring: "hsl(var(--ring))",
        input: "hsl(var(--input))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        muted: "hsl(var(--muted))",
        border: "hsl(var(--border))",
        /* These six resolve through RGB-triplet vars in globals.css
           (:root = the original hex values; `.dark` overrides them) so
           surfaces and text flip in dark mode; <alpha-value> keeps
           opacity modifiers (bg-surface/80 etc.) working. */
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        "surface-2": "rgb(var(--c-surface-2) / <alpha-value>)",
        "bg-app": "rgb(var(--c-bg-app) / <alpha-value>)",
        "text-main": "rgb(var(--c-text-main) / <alpha-value>)",
        "text-muted": "rgb(var(--c-text-muted) / <alpha-value>)",
        /* v3 contrast fix: the light triplet 96 103 132 (#606784) is
           ~5.6:1 on white (and >5:1 on bg-app), passing WCAG AA 4.5:1. */
        "text-subtle": "rgb(var(--c-text-subtle) / <alpha-value>)",
      },
      /* Radius scale derived from the --radius theme token (doc 25 §1.3.2).
         --radius defaults to 0.75rem = 12px in globals.css, so at the
         default these compute to EXACTLY the px values this scale had
         before it was token-wired: sm 12-4=8px, md 12px, lg 12+4=16px,
         xl 12+8=20px. A theme that changes --radius shifts the whole
         scale around the md anchor. */
      borderRadius: {
        sm: "calc(var(--radius) - 4px)",
        md: "var(--radius)",
        lg: "calc(var(--radius) + 4px)",
        xl: "calc(var(--radius) + 8px)",
      },
      boxShadow: {
        sm: "0 1px 2px rgba(79,70,229,0.06)",
        md: "0 4px 12px rgba(79,70,229,0.08)",
        lg: "0 12px 32px rgba(49,46,129,0.14)",
        /* Elevation system v2 (§2.3) — values live in globals.css vars so
           dark mode can deepen them without touching component classes. */
        card: "var(--shadow-card)",
        lift: "var(--shadow-lift)",
        pop: "var(--shadow-pop)",
      },
      /* Type scale v2 (§2.1) — named sizes for headings/editorial use.
         Body text stays on Tailwind's default scale (text-sm/text-base). */
      fontSize: {
        /* v3: display/h1 are fluid (clamp) so headlines scale with the
           viewport instead of jumping at breakpoints (plan §3). */
        display: ["clamp(1.75rem, 4.5vw, 2.5rem)", { lineHeight: "1.2", fontWeight: "700" }],
        h1: ["clamp(1.5rem, 3.5vw, 2rem)", { lineHeight: "1.25", fontWeight: "700" }],
        h2: ["1.5rem", { lineHeight: "2rem", fontWeight: "700" }],
        h3: ["1.25rem", { lineHeight: "1.75rem", fontWeight: "600" }],
        body: ["0.9375rem", { lineHeight: "1.5rem" }],
        small: ["0.8125rem", { lineHeight: "1.25rem" }],
        caption: ["0.75rem", { lineHeight: "1rem" }],
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        /* --font-display is a theme token (doc 25 §1.3.3); its globals.css
           default equals the stack the hand-written .font-display
           utility in globals.css has always used, so this generated
           utility renders identically. */
        display: ["var(--font-display)"],
        mono: ["var(--font-mono)"],
      },
    },
  },
  plugins: [],
};
