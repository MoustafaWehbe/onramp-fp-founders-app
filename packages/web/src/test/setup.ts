import "@testing-library/jest-dom";

// Radix's listbox primitives (Select) drive positioning and focus through
// pointer-capture, scrollIntoView and ResizeObserver — none of which jsdom
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
