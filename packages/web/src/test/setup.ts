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

// dnd-kit installs sensors and measurement observers that can schedule state
// updates after an assertion has completed. Unit tests exercise the board's
// explicit move controls instead of synthetic pointer dragging, so keep the
// real hooks/components but replace the provider with a passive boundary.
vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: ({ children }: { children: ReactNode }) => children,
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

// Web Storage is absent under this runner's jsdom build (an opaque-origin
// document has no localStorage), which is not a browser condition any of this
// app's code is written for: the workspace/round preferences persist through
// zustand's storage middleware, so every screen that reads one throws on
// mount and renders nothing at all. The same in-memory shape jsdom would
// otherwise install, with the same per-test lifetime as the document.
function installStorage(key: "localStorage" | "sessionStorage") {
  if (key in globalThis && globalThis[key]) return;

  let entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    key: (index) => [...entries.keys()][index] ?? null,
    getItem: (name) => entries.get(String(name)) ?? null,
    setItem: (name, value) => void entries.set(String(name), String(value)),
    removeItem: (name) => void entries.delete(String(name)),
    clear: () => {
      entries = new Map();
    },
  };

  Object.defineProperty(globalThis, key, { configurable: true, value: storage });
  Object.defineProperty(window, key, { configurable: true, value: storage });
}

installStorage("localStorage");
installStorage("sessionStorage");
