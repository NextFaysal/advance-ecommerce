/** PostCSS pipeline — REQUIRED for Tailwind v3 to process globals.css.
 *  This file was missing, so @tailwind directives were never compiled
 *  and the production CSS contained no utility classes at all. */
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
