import { useSyncExternalStore } from "react";

/**
 * Tracks a CSS media query in React state. Used to switch between the
 * pointer-drag desktop board and the tap-driven mobile pipeline list rather
 * than mounting both and hiding one with CSS with up to a few hundred
 * cards on the board, doubling that DOM for a view nobody sees is exactly
 * the kind of cost Phase 4 profiling exists to catch.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
