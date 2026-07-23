// Small library of original, hand-drawn line-art glyphs for graph nodes.
//
// Deliberately does NOT use (or reference) any official Azure/AWS/GCP icon
// artwork or icon font - every glyph below is built from plain SVG
// primitives (`circle`, `rect`, `path` with only simple straight
// segments/arcs) depicting generic, uncopyrightable visual concepts - a
// plain box for "resource", an eye for "data", a folder for "module", etc.
// - not copied path data from any existing icon set. Styling is *in the
// spirit* of popular minimalist stroke icon sets (24x24 viewBox, ~1.6 stroke
// width, round line caps/joins, `fill="none" stroke="currentColor"`) but
// hand-designed here.
import { svgEl } from './svg';

/**
 * The top-left badge icon on every node card - keyed off a node's
 * *structural kind* (a resource, a data source, a module call, ...), not
 * what the resource actually is (a database vs. a network vs. ...; see
 * resourceCategory.ts's separate `ResourceCategory` for that - it now only
 * drives nodeDetail.ts's curated attribute line, not the icon).
 * `module`/`variable`/`output`/`locals` map straight from `GraphNode.kind`
 * (render.ts's `nodeIconCategory`); `resource`/`data` do too, UNLESS the
 * resource/data type matches a "just links two other resources together"
 * glue pattern (azurerm_..._association, aws_..._attachment, ...), in which
 * case `association` is used instead - see render.ts's
 * `isAssociationResourceType`.
 */
export type IconCategory = 'resource' | 'data' | 'association' | 'module' | 'variable' | 'output' | 'locals';

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
  // Plain rounded box - a single concrete "thing", deliberately featureless
  // so it reads as a neutral default rather than implying any particular
  // resource shape (this used to be the `generic` fallback category's own
  // glyph, before resourceCategory.ts's semantic categories were split out
  // from node icons entirely - see icons.ts's own top comment).
  resource: () => [shape('rect', { x: 5, y: 5, width: 14, height: 14, rx: 3 })],

  // An eye: a data source only ever reads/looks up something that already
  // exists, never creates it - the one deliberate visual departure from
  // "box" shapes, so a `data` block is never mistaken for a `resource` at a
  // glance even when their names/types are identical.
  data: () => [
    shape('path', { d: 'M3 12 C6 6, 18 6, 21 12 C18 18, 6 18, 3 12 Z' }),
    shape('circle', { cx: 12, cy: 12, r: 2.6 }),
  ],

  // Two overlapping circles (a Venn pair) - "this joins two other things
  // together", for glue/junction resource types that don't represent real
  // standalone infrastructure (azurerm_..._association,
  // aws_..._attachment, ...; see render.ts's isAssociationResourceType).
  association: () => [
    shape('circle', { cx: 9, cy: 12, r: 5.5 }),
    shape('circle', { cx: 15, cy: 12, r: 5.5 }),
  ],

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
