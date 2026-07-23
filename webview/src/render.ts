// Pure SVG DOM construction from an already-positioned, already-filtered
// layout. No framework - `document.createElementNS` all the way down.
//
// API split (deliberate call, documented here since the task left it open):
// render.ts does NOT know about search text or the "show config nodes"
// toggle at all - it only ever draws whatever PositionedGraph it's handed.
// main.ts owns filtering, and re-runs `computeLayout` on the filtered
// node/edge subset before calling `renderGraph` again, so nodes that
// disappear cause the remaining ones to reflow (simpler and more visually
// correct than hiding already-positioned DOM nodes in place, and the graphs
// this tool targets - a single Terraform config directory - are small enough
// that re-layout on every keystroke/toggle is not a perf concern).
import {
  CHIP_BLOCK_GAP,
  CHIP_GAP_X,
  CHIP_GAP_Y,
  CHIP_LINE_HEIGHT,
  CONTENT_TOP_RESERVE,
  DETAIL_LINE_HEIGHT,
  ICON_BADGE_INSET,
  ICON_BADGE_RADIUS,
  ICON_BADGE_SIZE,
  NAME_LINE_HEIGHT,
  NAME_TYPE_GAP,
  TYPE_DETAIL_GAP,
  TYPE_LINE_HEIGHT,
} from './layout';
import type { ChipDatum, PositionedCluster, PositionedEdge, PositionedGraph, PositionedNode } from './layout';
import { buildIcon } from './icons';
import type { IconCategory } from './icons';
import { svgEl } from './svg';

/** Rendered pixel size of every node's icon glyph - see buildNode. */
const ICON_SIZE = 16;

// ---- Premium visual treatment constants ------------------------------
//
// See the module comment further down (buildNode) for the full rationale;
// the numbers below are gathered here so the "2026 sexy, stakeholder-demo"
// redesign's magic numbers all live in one place rather than scattered
// inline through buildNode/buildCluster.
//
// The icon badge's own size/corner-radius/inset (ICON_BADGE_SIZE/
// ICON_BADGE_RADIUS/ICON_BADGE_INSET) live in layout.ts, not here - layout.ts
// needs those same numbers to compute CONTENT_TOP_RESERVE (the reserved top
// strip that keeps the centered text block from colliding with the corner
// badge), so they're the single source of truth there and imported here
// rather than hand-copied a second time.

/**
 * Node card corner radius, adaptively scaled off the node's own height
 * (clamped to [MIN, MAX]) rather than a single fixed value - a flat 12-14px
 * radius looks proportionate on a normal two/three-line resource card but
 * turns a short single-line variable/output/locals card (as little as ~34px
 * tall) into an odd stadium/pill shape. Scaling down for shorter cards keeps
 * every node reading as "a softly rounded card", not "a rounded rect that
 * forgot how tall it was".
 */
const CORNER_RADIUS_MIN = 8;
const CORNER_RADIUS_MAX = 14;
const CORNER_RADIUS_HEIGHT_RATIO = 0.22;

function cardCornerRadius(height: number): number {
  return Math.min(CORNER_RADIUS_MAX, Math.max(CORNER_RADIUS_MIN, height * CORNER_RADIUS_HEIGHT_RATIO));
}

/**
 * The four accent "buckets" theme.css defines a gradient/badge-fill/shadow
 * pairing for - mirrors the existing kind-based accent grouping already
 * established by the `.node-kind-*`/`.node-config` CSS rules (resource/data
 * share the blue accent, module gets purple, variable/output/locals share
 * orange under the single `.node-config` class) rather than inventing a
 * second, finer-grained (per resourceCategory) color system. theme.css
 * selects each gradient purely off the existing `.node-kind-*`/`.node-config`
 * classes already present on every node's outer group (see `kindClass`/
 * `isConfigKind` below) - no separate per-bucket class is needed on the rect
 * itself, this type/list only exists so `buildDefs` can enumerate exactly
 * the same four gradient ids theme.css's selectors expect.
 */
type AccentBucket = 'resource' | 'data' | 'module' | 'config';

/**
 * Node kinds that never appear as graph/dagre boxes at all - `variable`/
 * `output`/`locals` blocks are always excluded from the SVG graph now (see
 * main.ts's filterModel()), regardless of the "show variables, outputs &
 * locals" toggle; that toggle now only controls the resource/data card
 * variable-reference chips (see buildNode below) and the separate Outputs/
 * Locals list panels (main.ts). Exported so main.ts can reuse the exact same
 * classification when building `filterModel()`'s graph-node exclusion,
 * instead of redefining it. No node buildNode() ever receives has this kind
 * as of this pass, so - unlike before this pass - nothing in this file's own
 * rendering branches on it anymore; the `.node-config`/`node-kind-variable`/
 * `node-kind-output`/`node-kind-locals` CSS rules in theme.css are dead for
 * the SVG graph as a direct result, left in place only because their muted/
 * accent-orange visual language is exactly what the new chip styling below
 * (`.node-chip-*`) intentionally echoes.
 */
export function isConfigKind(kind: PositionedNode['kind']): boolean {
  return kind === 'variable' || kind === 'output' || kind === 'locals';
}

function kindClass(kind: PositionedNode['kind']): string {
  return `node-kind-${kind}`;
}

/**
 * Refined arrowhead: a slightly inset tip with a gentle concave curve on its
 * back edge (via a quadratic back-curve instead of a flat line) reads less
 * like a blocky mechanical triangle, closer to the softer chevron shape
 * common in modern diagramming tools - pairs better with the smoothed
 * (curved) edge paths below than the original sharp-edged triangle did.
 */
function buildArrowheadMarker(): SVGMarkerElement {
  const marker = svgEl('marker', {
    id: 'tf-graph-arrowhead',
    viewBox: '0 0 10 10',
    refX: 9,
    refY: 5,
    markerWidth: 8,
    markerHeight: 8,
    orient: 'auto-start-reverse',
  });
  const arrowPath = svgEl('path', {
    d: 'M 1 1 L 9 5 L 1 9 Q 3.2 5 1 1 Z',
    class: 'edge-arrowhead',
  });
  marker.appendChild(arrowPath);
  return marker;
}

/**
 * Builds a single `<filter>` producing a soft "floating card" drop shadow via
 * `feDropShadow` - a single-primitive shorthand for the more verbose
 * feGaussianBlur+feOffset+feMerge chain, safe to rely on here since
 * `feDropShadow` has shipped in Chromium since M89 (2021) and VS Code's
 * webviews run on Electron's bundled Chromium, which is always dramatically
 * newer than that for any currently-supported VS Code release. `dy`/
 * `stdDeviation` are parameterized so the hover state (see theme.css) can
 * swap in a second, slightly deeper filter instance rather than trying to
 * animate filter primitive values directly (CSS `transition` cannot
 * meaningfully interpolate between two different `url(#...)` filter
 * references, only the values *inside* a single filter - swapping the whole
 * filter is the standard "deepen the shadow on hover" technique). Flood
 * color/opacity are deliberately left to a CSS class (see theme.css's
 * `.node-shadow-flood*` rules) rather than set as raw attributes here, so
 * the shadow tints via the real theme-aware `--vscode-widget-shadow` token
 * (VS Code's own "floating widget elevation" color) instead of a hardcoded
 * hex that would look wrong in one of light/dark.
 */
function buildShadowFilter(id: string, dy: number, blur: number, floodClass: string): SVGFilterElement {
  const filter = svgEl('filter', { id, x: '-60%', y: '-60%', width: '220%', height: '220%' });
  filter.appendChild(
    svgEl('feDropShadow', {
      dx: 0,
      dy,
      stdDeviation: blur,
      class: floodClass,
    })
  );
  return filter;
}

/**
 * One subtle top-to-bottom `<linearGradient>` per accent bucket: opaque
 * `--vscode-editor-background` at the top fading to a low-opacity wash of
 * that bucket's accent color at the bottom (see theme.css's
 * `.node-gradient-stop-*` rules for the actual colors/opacities - kept there,
 * not here, so every other themeable color in this file lives in the one
 * place that already owns theming). Gives every node card a faint sense of
 * material/depth instead of a single flat fill, while staying legible in
 * both VS Code light and dark themes since the base stop is always the
 * user's real editor background.
 */
function buildNodeGradient(bucket: AccentBucket): SVGLinearGradientElement {
  const gradient = svgEl('linearGradient', {
    id: `tf-node-gradient-${bucket}`,
    x1: '0',
    y1: '0',
    x2: '0',
    y2: '1',
  });
  gradient.appendChild(svgEl('stop', { offset: '0%', class: 'node-gradient-stop-start' }));
  gradient.appendChild(svgEl('stop', { offset: '100%', class: `node-gradient-stop-end-${bucket}` }));
  return gradient;
}

const ACCENT_BUCKETS: readonly AccentBucket[] = ['resource', 'data', 'module', 'config'];

function buildDefs(): SVGDefsElement {
  const defs = svgEl('defs');
  defs.appendChild(buildArrowheadMarker());
  defs.appendChild(buildShadowFilter('tf-node-shadow', 1, 2, 'node-shadow-flood'));
  defs.appendChild(buildShadowFilter('tf-node-shadow-hover', 2, 4, 'node-shadow-flood-hover'));
  for (const bucket of ACCENT_BUCKETS) {
    defs.appendChild(buildNodeGradient(bucket));
  }
  return defs;
}

function buildCluster(cluster: PositionedCluster): SVGGElement {
  const group = svgEl('g', { class: 'cluster' });
  group.appendChild(
    svgEl('rect', {
      x: cluster.x,
      y: cluster.y,
      width: Math.max(cluster.width, 1),
      height: Math.max(cluster.height, 1),
      rx: 16,
      ry: 16,
      class: 'cluster-rect',
    })
  );
  // Small colored "zone marker" dot ahead of the label - a cheap (no text
  // measurement needed) common dashboard convention for "this rounded panel
  // is a distinct grouped zone", replacing the old dashed-outline treatment
  // that leaned on stroke-dasharray alone to read as "structural, not solid".
  group.appendChild(
    svgEl('circle', {
      cx: cluster.x + 16,
      cy: cluster.y + 14,
      r: 3,
      class: 'cluster-label-dot',
    })
  );
  const label = svgEl('text', {
    x: cluster.x + 24,
    y: cluster.y + 18,
    class: 'cluster-label',
  });
  label.textContent = cluster.module;
  group.appendChild(label);
  return group;
}

/**
 * Converts a raw dagre point sequence into a smooth cubic-bezier SVG path via
 * a standard uniform Catmull-Rom-to-Bezier conversion: each interior segment
 * `p1 -> p2` gets control points derived from its neighbors (`p0`, `p3`) so
 * the resulting curve passes through every original point while staying
 * tangent-continuous across segment boundaries - the well-known simple
 * "smooth line through a set of points" technique that needs no charting/
 * spline library. The first/last points are duplicated as their own missing
 * neighbor so every real segment always has a valid p0..p3 window. Degrades
 * to a straight line (or nothing) for 0-2 points, where there's nothing
 * meaningful to smooth.
 */
function smoothEdgePath(points: PositionedEdge['points']): string {
  if (points.length === 0) {
    return '';
  }
  if (points.length < 3) {
    const [first, ...rest] = points;
    const segments = rest.map((p) => `L ${p.x} ${p.y}`);
    return `M ${first.x} ${first.y} ${segments.join(' ')}`.trim();
  }

  const padded = [points[0], ...points, points[points.length - 1]];
  // Uniform Catmull-Rom -> Bezier conversion divisor; the textbook constant
  // for this construction is 6 (tangent = (next - prev) / 6 at each interior
  // point), but that produces tangent vectors long enough to bulge/overshoot
  // past the straight-line polyline between dagre's own routed waypoints at
  // sharper bends - confirmed to actually reach into an unrelated node's
  // card in a real multi-branch dependency graph (dagre's raw waypoints
  // themselves had a comfortable ~30px clearance from that node; only the
  // smoothed curve crossed into it). 10 keeps the tangents shorter (a
  // tighter curve that hugs the original points more closely) - verified
  // against that same repro case to restore clearance with margin to spare,
  // while still reading as a smooth curve rather than sharp mechanical
  // elbows for the common (gentle-bend) case.
  const TENSION_DIVISOR = 10;

  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < padded.length - 3; i++) {
    const p0 = padded[i];
    const p1 = padded[i + 1];
    const p2 = padded[i + 2];
    const p3 = padded[i + 3];
    const c1x = p1.x + (p2.x - p0.x) / TENSION_DIVISOR;
    const c1y = p1.y + (p2.y - p0.y) / TENSION_DIVISOR;
    const c2x = p2.x - (p3.x - p1.x) / TENSION_DIVISOR;
    const c2y = p2.y - (p3.y - p1.y) / TENSION_DIVISOR;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

function buildEdge(edge: PositionedEdge): SVGPathElement {
  return svgEl('path', {
    d: smoothEdgePath(edge.points),
    class: 'edge-path',
    'marker-end': 'url(#tf-graph-arrowhead)',
  });
}

/**
 * Terraform's own "just links two other resources together" glue types -
 * these don't represent standalone infrastructure the way a normal
 * resource/data source does, so they get their own `association` icon
 * (see icons.ts) instead of the plain resource/data one. Substring match
 * against the resource `type`, same style as resourceCategory.ts's RULES -
 * covers e.g. azurerm_subnet_network_security_group_association,
 * aws_route_table_association, aws_iam_role_policy_attachment,
 * azurerm_role_assignment, google_project_iam_binding.
 */
const ASSOCIATION_TYPE_KEYWORDS = ['_association', '_attachment', '_assignment', '_binding'];

function isAssociationResourceType(type: string): boolean {
  return ASSOCIATION_TYPE_KEYWORDS.some((keyword) => type.includes(keyword));
}

/**
 * Every node kind maps straight to its own same-named `IconCategory` -
 * `module`/`variable`/`output`/`locals` always, and `resource`/`data` too,
 * UNLESS the resource/data `type` matches the glue-resource pattern above,
 * in which case `association` is used instead.
 */
function nodeIconCategory(node: PositionedNode): IconCategory {
  if ((node.kind === 'resource' || node.kind === 'data') && isAssociationResourceType(node.type)) {
    return 'association';
  }
  return node.kind;
}

/**
 * Builds a centered, multi-line `<text>` element: one `<tspan>` per line of
 * `lines`, each re-specifying `x` (SVG `<text>` does not auto-wrap, and a
 * `tspan` with no `x` of its own just continues the horizontal cursor from
 * the previous one instead of resetting to center) with `dy` stepping down
 * by `lineHeight` for every line after the first, so multi-line labels
 * render as a clean centered block instead of running together.
 */
function buildMultilineText(
  lines: string[],
  centerX: number,
  startY: number,
  lineHeight: number,
  cssClass: string
): SVGTextElement {
  const text = svgEl('text', {
    x: centerX,
    y: startY,
    class: cssClass,
    'text-anchor': 'middle',
  });
  lines.forEach((line, i) => {
    const tspan = svgEl('tspan', i === 0 ? { x: centerX } : { x: centerX, dy: lineHeight });
    tspan.textContent = line;
    text.appendChild(tspan);
  });
  return text;
}

/**
 * Draws one soft rounded-pill "referenced variable" chip per entry in
 * `rows` (already wrapped/measured by layout.ts's `buildChipRows`), row by
 * row, each row horizontally centered on `centerX` - the same text column
 * name/type/detail already center on, so chips read as visually attached to
 * the rest of the card rather than full-bleed to its edges. A `<title>` on
 * each chip surfaces the variable's own full address on hover, since the
 * chip's own visible label is deliberately short.
 */
function buildChipRows(rows: ChipDatum[][], centerX: number, topY: number): SVGGElement {
  const group = svgEl('g', { class: 'node-chips' });

  let rowY = topY;
  for (const row of rows) {
    const rowWidth = row.reduce((sum, chip) => sum + chip.width, 0) + (row.length - 1) * CHIP_GAP_X;
    // A row's height is its tallest chip - rows can mix single-line and
    // wrapped multi-line chips (see layout.ts's buildChipRows), so this
    // can't be a fixed constant.
    const rowHeight = Math.max(...row.map((chip) => chip.height));
    let chipX = centerX - rowWidth / 2;

    for (const chip of row) {
      const chipGroup = svgEl('g', {
        class: 'node-chip',
        // Vertically center a shorter chip within a taller row (e.g. a
        // 1-line chip sharing a row with a 2-line chip).
        transform: `translate(${chipX}, ${rowY + (rowHeight - chip.height) / 2})`,
      });

      const chipTitle = svgEl('title');
      chipTitle.textContent = chip.address;
      chipGroup.appendChild(chipTitle);

      // Corner radius caps out at 8px rather than always being a full
      // half-height pill - a 2+ line chip stays a nicely rounded rect
      // instead of stretching into an oblong capsule shape.
      const chipRadius = Math.min(chip.height / 2, 8);
      chipGroup.appendChild(
        svgEl('rect', {
          width: chip.width,
          height: chip.height,
          rx: chipRadius,
          ry: chipRadius,
          class: 'node-chip-rect',
        })
      );

      const textStartY = chip.height / 2 - ((chip.lines.length - 1) * CHIP_LINE_HEIGHT) / 2;
      const chipText = buildMultilineText(chip.lines, chip.width / 2, textStartY, CHIP_LINE_HEIGHT, 'node-chip-label');
      chipGroup.appendChild(chipText);

      group.appendChild(chipGroup);
      chipX += chip.width + CHIP_GAP_X;
    }

    rowY += rowHeight + CHIP_GAP_Y;
  }

  return group;
}

/**
 * Client-space movement (CSS px) below which a completed pointer
 * down->up interaction on a node is treated as a click rather than a drag -
 * mirrors common drag-vs-click UX thresholds; small enough that an
 * intentional click's natural micro-jitter never misfires as a drag, large
 * enough that a genuine drag is never mistaken for a click.
 */
const DRAG_THRESHOLD_PX = 4;

/** In-progress node drag bookkeeping - see buildNode's pointer handlers. */
interface NodeDragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  /** The node's world-space position (PositionedNode.x/y) when the drag began. */
  baseX: number;
  baseY: number;
  /** Running world-space position as the pointer moves - what a completed drag reports back via onNodeDragEnd. */
  currentX: number;
  currentY: number;
  /** Once true (crossed DRAG_THRESHOLD_PX), pointerup fires onNodeDragEnd instead of onNodeClick. */
  movedPastThreshold: boolean;
}

/**
 * Converts a client-space (CSS px) delta *vector* into the world-space delta
 * it represents, using `matrix`'s inverse - only the linear part (a/b/c/d)
 * of the inverse is applied, deliberately ignoring its translation (e/f):
 * a delta is a vector, not a point, so translating it would be wrong (two
 * points transformed individually and then subtracted would cancel out that
 * translation anyway - this is the same result, without the extra step).
 */
function transformDeltaByInverseMatrix(matrix: DOMMatrix, dx: number, dy: number): { dx: number; dy: number } {
  const inverse = matrix.inverse();
  return {
    dx: dx * inverse.a + dy * inverse.c,
    dy: dx * inverse.b + dy * inverse.d,
  };
}

function buildNode(
  node: PositionedNode,
  onNodeClick: (address: string) => void,
  onNodeDragEnd: (address: string, x: number, y: number) => void
): SVGGElement {
  // `node` is never a `variable`/`output`/`locals` kind as of this pass (see
  // filterModel() in main.ts - those kinds are stripped out of the graph
  // entirely before layout runs), so the old "add .node-config for config
  // kinds" branch here is now permanently dead and has been removed;
  // `kindClass` alone is enough.
  const group = svgEl('g', {
    class: `node ${kindClass(node.kind)}`,
    'data-address': node.address,
    transform: `translate(${node.x - node.width / 2}, ${node.y - node.height / 2})`,
  });

  const title = svgEl('title');
  title.textContent = node.address;
  group.appendChild(title);

  // Everything visual (card background, badge, icon, text) lives inside its
  // own inner group rather than directly on `group` above, specifically so
  // the hover "gently lift" treatment (see theme.css's `.node-card`/
  // `.node:hover .node-card` rules - a soft scale-up plus a deeper drop
  // shadow, transitioned smoothly rather than an instant jump-cut) can set a
  // CSS `transform`/`filter` on this inner element without clobbering the
  // outer group's own SVG `transform="translate(...)"` positioning
  // attribute - a CSS `transform` property on an element entirely replaces
  // (rather than composes with) that element's own `transform` attribute, so
  // positioning and hover-animation transforms must live on two different
  // elements.
  const card = svgEl('g', { class: 'node-card' });
  group.appendChild(card);

  card.appendChild(
    svgEl('rect', {
      width: node.width,
      height: node.height,
      rx: cardCornerRadius(node.height),
      ry: cardCornerRadius(node.height),
      class: 'node-rect',
    })
  );

  // Icon badge sits in the card's top-left corner now - a fixed small inset
  // from both the top and left edges (ICON_BADGE_INSET), rather than
  // vertically centered in its own left-hand gutter column the way it used
  // to be. Name/type/detail/chip text is centered across the *full* card
  // width (see textCenterX below) instead of the width remaining to the
  // icon's right, so the card reads as genuinely centered content with a
  // corner badge overlaid on top - not text still balanced around a
  // now-removed gutter.
  //
  // A soft rounded-square "badge" sits behind the icon glyph itself - a low-
  // opacity wash of the node's own accent color (see theme.css's
  // `.node-icon-badge` rules), a common modern dashboard/SaaS treatment that
  // reads as noticeably more polished than a bare stroke icon floating on
  // transparent background.
  const badgeX = ICON_BADGE_INSET;
  const badgeY = ICON_BADGE_INSET;
  card.appendChild(
    svgEl('rect', {
      x: badgeX,
      y: badgeY,
      width: ICON_BADGE_SIZE,
      height: ICON_BADGE_SIZE,
      rx: ICON_BADGE_RADIUS,
      ry: ICON_BADGE_RADIUS,
      class: 'node-icon-badge',
    })
  );

  const icon = buildIcon(nodeIconCategory(node), ICON_SIZE);
  icon.setAttribute('x', String(ICON_BADGE_INSET + (ICON_BADGE_SIZE - ICON_SIZE) / 2));
  icon.setAttribute('y', String(ICON_BADGE_INSET + (ICON_BADGE_SIZE - ICON_SIZE) / 2));
  card.appendChild(icon);

  const textCenterX = node.width / 2;

  const showSubtitle = node.kind === 'resource' || node.kind === 'data' || node.kind === 'module';

  // Node height is no longer a fixed per-kind constant (layout.ts computes
  // it from however many lines `node.nameLines`/`node.typeLines` wrapped
  // to), so the text block is centered here from those actual line counts
  // rather than a hardcoded offset - `dominant-baseline: middle` (set in
  // theme.css's .node-label/.node-type) means each line's y is that line's
  // vertical center, so `blockTop + lineHeight/2` lands the first line
  // correctly regardless of how tall the overall block is.
  // Detail line (see nodeDetail.ts): a small curated "what's actually
  // configured" value - e.g. a virtual network's address_space CIDR - drawn
  // as a third stacked text block below name/type, using the exact same
  // pre-wrapped-lines/multiline-tspan approach as those two, so it can never
  // drift out of sync with what layout.ts sized the box for. Empty for any
  // node `pickNodeDetail` found nothing curated for (most nodes).
  const hasDetail = node.detailLines.length > 0;

  // Variable-reference chips (see layout.ts's ChipDatum/buildChipRows): one
  // small pill per variable this resource/data node's own attributes
  // directly reference, wrapped onto however many rows layout.ts already
  // packed them into - drawn exactly as pre-computed there, same
  // never-drift-apart pattern as name/type/detail above. Always empty for
  // any node kind other than resource/data, or when chips are disabled (the
  // "show variables, outputs & locals" toggle is off) - see
  // computeLayout()'s `variablesByAddress` option.
  const hasChips = node.chipRows.length > 0;

  const nameBlockHeight = node.nameLines.length * NAME_LINE_HEIGHT;
  const typeBlockHeight = showSubtitle ? NAME_TYPE_GAP + node.typeLines.length * TYPE_LINE_HEIGHT : 0;
  const detailBlockHeight = hasDetail ? TYPE_DETAIL_GAP + node.detailLines.length * DETAIL_LINE_HEIGHT : 0;

  // Built at a nominal position (packed right after the icon reserve, no
  // centering math here) inside its own `.node-content` group - this group
  // gets nudged to its *real* centered position in a second pass, once the
  // whole SVG tree is actually attached to the live document (see
  // renderGraph()'s post-append centering pass below). Doing the size-driven
  // math here instead (against nameBlockHeight/typeBlockHeight/etc.'s
  // estimates) used to assume those estimates always exactly matched
  // layout.ts's own `node.height` calculation - true in the common case, but
  // real-world content (long wrapped detail lines, chip rows measured against
  // a live theme's actual font metrics rather than textMeasure.ts's Node-only
  // fallback) could drift enough from the estimate to visibly bias the block
  // toward the bottom of the card instead of the middle. Measuring the real
  // rendered `getBBox()` after attachment sidesteps that drift entirely.
  const blockTop = CONTENT_TOP_RESERVE;

  const content = svgEl('g', { class: 'node-content' });
  card.appendChild(content);

  const nameStartY = blockTop + NAME_LINE_HEIGHT / 2;
  const nameText = buildMultilineText(node.nameLines, textCenterX, nameStartY, NAME_LINE_HEIGHT, 'node-label');
  content.appendChild(nameText);

  if (showSubtitle) {
    const typeStartY = blockTop + nameBlockHeight + NAME_TYPE_GAP + TYPE_LINE_HEIGHT / 2;
    const typeText = buildMultilineText(node.typeLines, textCenterX, typeStartY, TYPE_LINE_HEIGHT, 'node-type');
    content.appendChild(typeText);
  }

  if (hasDetail) {
    const detailStartY = blockTop + nameBlockHeight + typeBlockHeight + TYPE_DETAIL_GAP + DETAIL_LINE_HEIGHT / 2;
    const detailText = buildMultilineText(
      node.detailLines,
      textCenterX,
      detailStartY,
      DETAIL_LINE_HEIGHT,
      'node-detail'
    );
    content.appendChild(detailText);
  }

  if (hasChips) {
    const chipsTop = blockTop + nameBlockHeight + typeBlockHeight + detailBlockHeight + CHIP_BLOCK_GAP;
    content.appendChild(buildChipRows(node.chipRows, textCenterX, chipsTop));
  }

  // ---- Whole-card dragging (manual position override) --------------------
  // Same click-anywhere convention the card already used for navigate: a
  // pointerdown/move/up sequence that stays within DRAG_THRESHOLD_PX is
  // still treated as a click (onNodeClick fires, exactly as before); once it
  // moves past that threshold it's a drag instead, and onNodeClick is never
  // also fired for it (a drag should never additionally trigger navigation).
  let dragState: NodeDragState | null = null;

  function applyDragTransform(): void {
    if (!dragState) {
      return;
    }
    const offsetX = dragState.currentX - dragState.baseX;
    const offsetY = dragState.currentY - dragState.baseY;
    // Same base `translate(x - width/2, y - height/2)` this group is always
    // positioned with, plus the live drag offset on top - keeps the group's
    // own `transform` attribute the single source of truth for its on-screen
    // position (no separate CSS transform layered on top, unlike `.node-card`
    // above, which needs its own element specifically to avoid clobbering
    // this one).
    group.setAttribute(
      'transform',
      `translate(${node.x - node.width / 2 + offsetX}, ${node.y - node.height / 2 + offsetY})`
    );
  }

  function onPointerDown(event: PointerEvent): void {
    // Critical: stops this from bubbling up to svgRoot's own pointerdown
    // listener (panzoom.ts's onPointerDown) - without this, panzoom would
    // simultaneously start a background pan on every node drag. See
    // panzoom.ts's onPointerDown doc comment, which already (stale-ly)
    // claims node-originated pointerdowns are ignored; this stopPropagation
    // is what actually delivers that.
    event.stopPropagation();
    dragState = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      baseX: node.x,
      baseY: node.y,
      currentX: node.x,
      currentY: node.y,
      movedPastThreshold: false,
    };
    group.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    const dxClient = event.clientX - dragState.startClientX;
    const dyClient = event.clientY - dragState.startClientY;
    if (!dragState.movedPastThreshold && Math.hypot(dxClient, dyClient) >= DRAG_THRESHOLD_PX) {
      dragState.movedPastThreshold = true;
      group.classList.add('node-dragging');
    }

    // This node group's own current on-screen transformation matrix already
    // reflects whatever pan/zoom transform panzoom.ts has applied - inverting
    // it and transforming the client-space delta through it converts
    // straight to world-space, with no need to read panzoom.ts's internal
    // scale/pan state directly.
    const ctm = group.getScreenCTM();
    if (!ctm) {
      return;
    }
    const { dx, dy } = transformDeltaByInverseMatrix(ctm, dxClient, dyClient);
    dragState.currentX = dragState.baseX + dx;
    dragState.currentY = dragState.baseY + dy;
    applyDragTransform();
  }

  function endDrag(event: PointerEvent): void {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    if (group.hasPointerCapture(event.pointerId)) {
      group.releasePointerCapture(event.pointerId);
    }
    group.classList.remove('node-dragging');

    const { movedPastThreshold, currentX, currentY } = dragState;
    dragState = null;

    if (movedPastThreshold) {
      onNodeDragEnd(node.address, currentX, currentY);
    } else {
      onNodeClick(node.address);
    }
  }

  group.addEventListener('pointerdown', onPointerDown);
  group.addEventListener('pointermove', onPointerMove);
  group.addEventListener('pointerup', endDrag);
  group.addEventListener('pointercancel', endDrag);

  return group;
}

/**
 * Builds the full SVG DOM for a positioned graph inside `container`
 * (replacing any previous contents). `onNodeClick` fires with a node's full
 * address on a plain click; `onNodeDragEnd` fires instead (never both) with
 * the node's new world-space x/y once a drag that moved past the click
 * threshold completes.
 */
export function renderGraph(
  container: HTMLElement,
  positioned: PositionedGraph,
  onNodeClick: (address: string) => void,
  onNodeDragEnd: (address: string, x: number, y: number) => void
): void {
  container.innerHTML = '';

  // Deliberately no `width`/`height`/`viewBox` attributes here: CSS gives
  // this element width:100%/height:100% of its container, and with no
  // viewBox the SVG's user-unit coordinate system is defined to be exactly
  // 1 unit = 1 rendered CSS pixel. panzoom.ts's cursor<->world-space math
  // (and its fit-to-view `reset()`) both assume that 1:1 mapping - adding a
  // viewBox here would layer the browser's own automatic viewBox-to-
  // viewport scaling underneath our hand-rolled transform, throwing off
  // both the wheel-zoom-to-cursor point and the initial fit-to-view.
  const svg = svgEl('svg', { class: 'graph-svg' });
  svg.appendChild(buildDefs());

  const viewport = svgEl('g', { id: 'viewport' });

  const clustersGroup = svgEl('g', { class: 'clusters' });
  for (const cluster of positioned.clusters) {
    clustersGroup.appendChild(buildCluster(cluster));
  }
  viewport.appendChild(clustersGroup);

  const edgesGroup = svgEl('g', { class: 'edges' });
  for (const edge of positioned.edges) {
    edgesGroup.appendChild(buildEdge(edge));
  }
  viewport.appendChild(edgesGroup);

  const nodesGroup = svgEl('g', { class: 'nodes' });
  for (const node of positioned.nodes) {
    nodesGroup.appendChild(buildNode(node, onNodeClick, onNodeDragEnd));
  }
  viewport.appendChild(nodesGroup);

  svg.appendChild(viewport);
  container.appendChild(svg);

  centerNodeContent(nodesGroup);
}

/**
 * Nudges each node's `.node-content` group (name/type/detail/chips - see
 * buildNode()) so it's truly vertically centered in the card's full height,
 * measured against its *real* rendered `getBBox()` rather than the
 * size-estimate math layout.ts used to pre-size the card. Must run after
 * `container.appendChild(svg)` above - `getBBox()` on a detached SVG tree
 * can't resolve the CSS-driven font metrics (.node-label/.node-type/etc.'s
 * font-size) that determine each text line's actual rendered extent, so
 * measuring any earlier would just re-introduce the same estimate-vs-reality
 * drift this pass exists to eliminate.
 */
function centerNodeContent(nodesGroup: SVGGElement): void {
  for (const nodeGroup of Array.from(nodesGroup.children)) {
    const content = nodeGroup.querySelector('.node-content');
    const rect = nodeGroup.querySelector('.node-rect');
    if (!(content instanceof SVGGElement) || !(rect instanceof SVGRectElement)) {
      continue;
    }

    const cardHeight = rect.height.baseVal.value;
    const bbox = content.getBBox();
    const idealTop = (cardHeight - bbox.height) / 2;
    // Never let centering pull content up into the icon badge's reserved
    // corner - see buildNode()'s CONTENT_TOP_RESERVE comment. Only matters
    // for the shortest (e.g. bare `module` name-only) cards, where the ideal
    // full-height center would otherwise land above that reserved strip.
    const clampedTop = Math.max(CONTENT_TOP_RESERVE, idealTop);
    const delta = clampedTop - bbox.y;

    if (Math.abs(delta) > 0.5) {
      content.setAttribute('transform', `translate(0, ${delta})`);
    }
  }
}
