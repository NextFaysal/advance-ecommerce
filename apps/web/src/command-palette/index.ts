/**
 * Command palette (Admin Ctrl+K + global search) — Agent 28.
 *
 * Mount: render <CommandPalette /> once in the admin shell — see the
 * mount contract in CommandPalette.tsx. Everything else here is the
 * pure pipeline behind it (index -> natural-language -> scoring ->
 * keyboard reducer), importable for tests without rendering.
 */
export * from "./types";
export * from "./scoring";
export * from "./index-builder";
export * from "./natural-language";
export * from "./recent";
export * from "./keyboard";
export { CommandPalette, type CommandPaletteProps } from "./CommandPalette";
