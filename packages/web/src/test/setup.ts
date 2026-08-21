import "@testing-library/jest-dom";
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { vi } from "vitest";

// Recharts' responsive wrapper relies on browser layout measurements that
// jsdom cannot provide. Give chart children deterministic dimensions so tests
// exercise chart rendering without emitting zero-size warnings.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactNode }) =>
      isValidElement(children)
        ? cloneElement(children as ReactElement<{ width?: number; height?: number }>, {
            width: 800,
            height: 400,
          })
        : children,
  };
});

// Radix's listbox primitives (Select) drive positioning and focus through
// pointer-capture, scrollIntoView and ResizeObserver none of which jsdom
// implements. Without these stubs the dropdown throws the moment it opens.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom has no layout engine, so no query ever actually matches every test
// runs as if on a full-width viewport, same as useMediaQuery's SSR fallback.
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
