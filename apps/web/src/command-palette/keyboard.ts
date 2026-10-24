/**
 * Keyboard navigation for the palette — Agent 28. Pure state machine.
 *
 * The component owns focus and the DOM; this reducer owns only WHICH
 * result is active, so the behaviour is unit-testable without rendering:
 *   next / prev  — move with wrap-around (last -> first, first -> last)
 *   first / last — Home / End
 *   set          — hover or a fresh result list picks an explicit index
 *   reset        — a new query/result list: back to the first result
 * An empty list always yields activeIndex -1 (nothing to activate), and
 * every index is clamped into range when the list shrinks.
 */

export interface PaletteNavState {
  activeIndex: number;
  /** Number of navigable results the state was built against. */
  count: number;
}

export type PaletteNavEvent =
  | { type: "next" }
  | { type: "prev" }
  | { type: "first" }
  | { type: "last" }
  | { type: "set"; index: number }
  | { type: "reset"; count: number };

export const INITIAL_NAV_STATE: PaletteNavState = { activeIndex: -1, count: 0 };

function clamp(index: number, count: number): number {
  if (count <= 0) return -1;
  if (index < 0) return 0;
  if (index >= count) return count - 1;
  return index;
}

export function paletteNavReducer(state: PaletteNavState, event: PaletteNavEvent): PaletteNavState {
  switch (event.type) {
    case "reset":
      return { count: event.count, activeIndex: event.count > 0 ? 0 : -1 };
    case "next":
      if (state.count <= 0) return state;
      return { ...state, activeIndex: state.activeIndex >= state.count - 1 ? 0 : state.activeIndex + 1 };
    case "prev":
      if (state.count <= 0) return state;
      return { ...state, activeIndex: state.activeIndex <= 0 ? state.count - 1 : state.activeIndex - 1 };
    case "first":
      return { ...state, activeIndex: clamp(0, state.count) };
    case "last":
      return { ...state, activeIndex: clamp(state.count - 1, state.count) };
    case "set":
      return { ...state, activeIndex: clamp(event.index, state.count) };
  }
}

export type PaletteKeyAction = "next" | "prev" | "first" | "last" | "confirm" | "close" | null;

/** Map a KeyboardEvent.key (while the palette is open) to an action. */
export function paletteKeyAction(key: string): PaletteKeyAction {
  switch (key) {
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "prev";
    case "Home":
      return "first";
    case "End":
      return "last";
    case "Enter":
      return "confirm";
    case "Escape":
      return "close";
    default:
      return null;
  }
}

/** True for the global open shortcut: Ctrl+K or Cmd+K (not in the palette). */
export function isPaletteShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean }): boolean {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
}
