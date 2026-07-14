// Shared SVG DOM-construction helper. Pulled out of render.ts into its own
// tiny module so icons.ts can reuse the exact same `createElementNS`
// boilerplate without creating a render.ts <-> icons.ts import cycle
// (render.ts imports icon-drawing functions from icons.ts, so icons.ts
// can't import svgEl back from render.ts).
export const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, String(value));
  }
  return el;
}
