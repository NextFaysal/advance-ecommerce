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
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        muted: "hsl(var(--muted))",
        border: "hsl(var(--border))",
        surface: "#FFFFFF",
        "surface-2": "#F3F4FB",
        "bg-app": "#F8F9FD",
        "text-main": "#1F2037",
        "text-muted": "#5B5F7A",
        /* v3 contrast fix: #8A8EA8 was only ~3.2:1 on white; #606784 is
           ~5.6:1 on white (and >5:1 on bg-app), passing WCAG AA 4.5:1. */
        "text-subtle": "#606784",
      },
      borderRadius: { sm: "8px", md: "12px", lg: "16px", xl: "20px" },
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
        mono: ["var(--font-mono)"],
      },
    },
  },
  plugins: [],
};
