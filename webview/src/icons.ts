// Small library of original, hand-drawn line-art glyphs for graph nodes.
//
// Deliberately does NOT use (or reference) any official Azure/AWS/GCP icon
// artwork or icon font - every glyph below is built from plain SVG
// primitives (`circle`, `rect`, `ellipse`, `line`, `path` with only simple
// straight segments/arcs) depicting generic, uncopyrightable visual
// concepts - a stacked cylinder for "database", a padlock silhouette for
// "security", circles-joined-by-lines for "network", etc. - not copied path
// data from any existing icon set. Styling is *in the spirit* of popular
// minimalist stroke icon sets (24x24 viewBox, ~1.6 stroke width, round line
// caps/joins, `fill="none" stroke="currentColor"`) but hand-designed here.
import { svgEl } from './svg';

/**
 * `network` through `generic` are inferred from a resource/data `type`
 * string by resourceCategory.ts. `module`/`variable`/`output`/`locals` are
 * used directly by render.ts for those node kinds - there's no `type`
 * string on those blocks to infer a category from.
 */
export type IconCategory =
  | 'network'
  | 'compute'
  | 'storage'
  | 'database'
  | 'security'
  | 'container'
  | 'messaging'
  | 'monitoring'
  | 'generic'
  | 'module'
  | 'variable'
  | 'output'
  | 'locals';

const VIEWBOX_SIZE = 24;

// Shared stroke styling every glyph primitive uses, so every icon reads as
// part of the same consistent family. Stroke color is deliberately always
// `currentColor`, never a hardcoded hex/var here - theme.css sets the CSS
// `color` property per node-kind class so each icon naturally follows the
// same accent color already used for that kind's node border/text.
const STROKE_ATTRS = {
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.6,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const;

function shape<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  return svgEl(tag, { ...STROKE_ATTRS, ...attrs });
}

type GlyphBuilder = () => SVGElement[];

const GLYPHS: Record<IconCategory, GlyphBuilder> = {
  // Three nodes joined by lines (a small mesh/triangle) - the simplest
  // possible "network" concept: things, connected.
  network: () => [
    shape('line', { x1: 6, y1: 7, x2: 18, y2: 7 }),
    shape('line', { x1: 6, y1: 7, x2: 12, y2: 18 }),
    shape('line', { x1: 18, y1: 7, x2: 12, y2: 18 }),
    shape('circle', { cx: 6, cy: 7, r: 2.4 }),
    shape('circle', { cx: 18, cy: 7, r: 2.4 }),
    shape('circle', { cx: 12, cy: 18, r: 2.4 }),
  ],

  // A server rack: an outer body with two horizontal dividers.
  compute: () => [
    shape('rect', { x: 5, y: 3, width: 14, height: 18, rx: 2 }),
    shape('line', { x1: 5, y1: 10, x2: 19, y2: 10 }),
    shape('line', { x1: 5, y1: 16, x2: 19, y2: 16 }),
  ],

  // A disk/drive: a body, a divider line near the top, and an activity dot.
  storage: () => [
    shape('rect', { x: 4, y: 5, width: 16, height: 14, rx: 2 }),
    shape('line', { x1: 4, y1: 10, x2: 20, y2: 10 }),
    shape('circle', { cx: 8, cy: 15, r: 1.3 }),
  ],

  // The classic stacked-cylinder database glyph: an ellipse "lid", two
  // vertical sides, and a bottom + mid-body curve.
  database: () => [
    shape('ellipse', { cx: 12, cy: 6, rx: 7, ry: 3 }),
    shape('path', { d: 'M5 6 V18 A7 3 0 0 0 19 18 V6' }),
    shape('path', { d: 'M5 12 A7 3 0 0 0 19 12' }),
  ],

  // A padlock: an arc "shackle" over a rounded body, with a keyhole slot.
  security: () => [
    shape('path', { d: 'M8 11 V8 a4 4 0 0 1 8 0 V11' }),
    shape('rect', { x: 5, y: 11, width: 14, height: 9, rx: 2 }),
    shape('line', { x1: 12, y1: 14.5, x2: 12, y2: 17 }),
  ],

  // A package/box: a body with a lid seam and a center crease.
  container: () => [
    shape('rect', { x: 4, y: 6, width: 16, height: 14, rx: 1.5 }),
    shape('line', { x1: 4, y1: 10, x2: 20, y2: 10 }),
    shape('line', { x1: 12, y1: 10, x2: 12, y2: 20 }),
  ],

  // An envelope: a body with a "V" flap.
  messaging: () => [
    shape('rect', { x: 3, y: 6, width: 18, height: 13, rx: 2 }),
    shape('path', { d: 'M3.5 7 L12 14 L20.5 7' }),
  ],

  // A small line chart on axes.
  monitoring: () => [
    shape('path', { d: 'M4 4 V20 H20' }),
    shape('path', { d: 'M5 17 L10 10 L14 14 L20 6' }),
  ],

  // Plain rounded box outline - the deliberately-featureless fallback for
  // provider-agnostic utility resources (random_pet, local_file,
  // null_resource, time_sleep, tls_private_key, archive_file, ...) that
  // don't fit any cloud-resource-shaped category.
  generic: () => [shape('rect', { x: 5, y: 5, width: 14, height: 14, rx: 3 })],

  // A folder silhouette (body + top-left tab), all in one path.
  module: () => [
    shape('path', {
      d: 'M4 9 V6.5 a1 1 0 0 1 1 -1 h4.5 l2 2 H19 a1 1 0 0 1 1 1 V17 a1 1 0 0 1 -1 1 H5 a1 1 0 0 1 -1 -1 Z',
    }),
  ],

  // An arrow feeding into a small box on the right - "a value flowing in".
  variable: () => [
    shape('rect', { x: 14, y: 8, width: 6, height: 8, rx: 1 }),
    shape('line', { x1: 3, y1: 12, x2: 12, y2: 12 }),
    shape('path', { d: 'M9 8 L13 12 L9 16' }),
  ],

  // Mirror image of `variable`: a box on the left with an arrow leaving it
  // on the right - "a value flowing out" - deliberately the visual opposite
  // of the `variable` glyph above.
  output: () => [
    shape('rect', { x: 4, y: 8, width: 6, height: 8, rx: 1 }),
    shape('line', { x1: 12, y1: 12, x2: 21, y2: 12 }),
    shape('path', { d: 'M15 8 L19 12 L15 16' }),
  ],

  // A price-tag silhouette (point + rounded body + hole).
  locals: () => [
    shape('path', { d: 'M4 12 L9 6 H18 a2 2 0 0 1 2 2 V16 a2 2 0 0 1 -2 2 H9 Z' }),
    shape('circle', { cx: 9.5, cy: 12, r: 1.1 }),
  ],
};

/**
 * Builds a standalone `<svg width height viewBox="0 0 24 24">` containing
 * the glyph for `category`, sized to `size` CSS pixels. Never sets a
 * `color`/`stroke` value directly - the glyph's `stroke="currentColor"`
 * resolves against whatever CSS `color` is inherited from the enclosing
 * `.node-kind-*`/`.node-config` class in theme.css, so it automatically
 * follows that node kind's existing accent color.
 */
export function buildIcon(category: IconCategory, size: number): SVGSVGElement {
  const icon = svgEl('svg', {
    width: size,
    height: size,
    viewBox: `0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`,
    class: 'node-icon',
  });
  for (const el of GLYPHS[category]()) {
    icon.appendChild(el);
  }
  return icon;
}
