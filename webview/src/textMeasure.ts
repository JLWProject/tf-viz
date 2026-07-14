// Real browser text measurement for layout.ts's word-wrap sizing (see
// textWrap.ts), backed by a single shared offscreen `<canvas>` 2D context -
// the standard, reliable way to get accurate glyph-width metrics without
// attaching/detaching real DOM nodes per measurement.
//
// Both helpers here degrade gracefully when there's no usable DOM at all
// (Node-based Mocha tests: `webview/src/test/layout.test.ts` runs under
// plain Node with no `document` global, and even the handful of test files
// that do install a jsdom `document` - see icons.test.ts - can't produce a
// working canvas 2D context, since jsdom stubs `HTMLCanvasElement`'s
// `getContext()` to return null unless the optional native `canvas` npm
// package is installed, which this project deliberately does not depend on
// just for tests). In that case measurement falls back to a fixed
// per-character estimate, keeping layout.ts's sizing deterministic and
// testable without a real browser. Production/webview code always runs in
// a real browser and gets real glyph-accurate measurement.

const FALLBACK_CHAR_WIDTH = 7.2;

let sharedCtx: CanvasRenderingContext2D | null | undefined;

function getSharedContext(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') {
    return null;
  }
  if (sharedCtx === undefined) {
    try {
      const canvas = document.createElement('canvas');
      sharedCtx = canvas.getContext('2d');
    } catch {
      sharedCtx = null;
    }
  }
  return sharedCtx;
}

/**
 * Returns a `measure(text) => width in px` function bound to `font` (a full
 * CSS font shorthand string, e.g. `"12px Segoe UI, sans-serif"`). See the
 * module comment above for the no-canvas fallback behavior.
 */
export function createTextMeasurer(font: string): (text: string) => number {
  const ctx = getSharedContext();
  if (!ctx) {
    return (text: string) => text.length * FALLBACK_CHAR_WIDTH;
  }
  return (text: string) => {
    // Set on every call (not once outside the closure): the shared context
    // is reused across multiple measurers bound to different fonts (name
    // vs. type, regular vs. config-kind name), so `ctx.font` must be
    // re-applied immediately before each `measureText` call to avoid one
    // measurer clobbering another's font.
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}

/**
 * Resolves the font-family actually in effect for node text at
 * render/layout time. `theme.css` sets `font-family: var(--vscode-font-family)`
 * on `html, body` only - no SVG text element under `.graph-svg` overrides
 * it - so every node's `<text>` inherits whatever VS Code's real injected
 * `--vscode-font-family` value resolves to (an arbitrary, theme/OS-specific
 * string). That can't be hardcoded or guessed; it has to be read back via
 * `getComputedStyle` on a real attached element (`document.body`, which is
 * always present and is the element the font-family is actually declared
 * on).
 */
export function resolveEffectiveFontFamily(): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') {
    return 'sans-serif';
  }
  const computed = getComputedStyle(document.body).fontFamily;
  return computed && computed.trim() !== '' ? computed : 'sans-serif';
}
