// Wires up @dagrejs/dagre (the maintained continuation of the original
// dagre + graphlib packages - same maintainers, scoped npm name) to turn a
// GraphModel into a fully positioned layout ready for SVG rendering.
//
// `GraphNode`/`GraphEdge`/`GraphModel` are imported `import type` only from
// the extension-host's graph model module - this is a zero-runtime-cost type
// import (erased entirely at build time, nothing is bundled from `src/`), it
// just keeps the webview's node/edge shape guaranteed identical to what
// `graphModel.ts` actually produces instead of hand-duplicating the
// interface and letting it drift.
import * as dagre from '@dagrejs/dagre';
import type { EdgeLabel, GraphLabel, NodeLabel } from '@dagrejs/dagre';
import type { GraphEdge, GraphModel, GraphNode } from '../../src/graph/graphModel';
import { pickNodeDetail } from './nodeDetail';
import { createTextMeasurer, resolveEffectiveFontFamily } from './textMeasure';
import { packIntoRows, wrapText } from './textWrap';

type DagreGraph = dagre.graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>;

export interface Point {
  x: number;
  y: number;
}

export interface PositionedNode extends GraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Pre-wrapped name/type lines, computed once here by the real
   * canvas-measurement `wrapText()` pass this same function used to size
   * the node's box - render.ts draws exactly these lines (one `<tspan>`
   * each) rather than re-running wrapping itself, so what the box was
   * sized for and what gets drawn can never drift apart.
   */
  nameLines: string[];
  /** Empty for node kinds with no subtitle line (see `hasSubtitle`). */
  typeLines: string[];
  /**
   * Pre-wrapped curated-attribute "detail" lines (see nodeDetail.ts), e.g.
   * a virtual network's `address_space` CIDR. Empty when `pickNodeDetail`
   * found nothing worth surfacing for this node.
   */
  detailLines: string[];
  /**
   * Pre-measured, pre-wrapped rows of "referenced variable" chips (see
   * ChipDatum below) for a `resource`/`data` node - computed once here, the
   * same "size and draw from the exact same pre-computed data" pattern
   * already used for nameLines/typeLines/detailLines, so what the box was
   * sized for and what render.ts draws can never drift apart. Always empty
   * unless `computeLayout` was called with a `variablesByAddress` lookup
   * (i.e. the "show variables, outputs & locals" toggle is on) AND this
   * node is a resource/data block with at least one direct variable
   * reference.
   */
  chipRows: ChipDatum[][];
}

/** One rendered "referenced variable" chip - see PositionedNode.chipRows. */
export interface ChipDatum {
  /** The variable's own fully-prefixed address, e.g. "var.environment". */
  address: string;
  /**
   * Pre-wrapped label lines, e.g. `["environment: production"]` for a short
   * chip, or multiple lines for a long name/value combo that doesn't fit on
   * one line within `WRAP_WIDTH` - a chip is no longer treated as an
   * unbreakable unit (see `buildChipRows` below), so it can never overflow
   * a node's box the way `nameLines`/`typeLines`/`detailLines` couldn't
   * before this same word-wrap treatment was applied to them.
   */
  lines: string[];
  /** Pre-measured pill width (widest wrapped line's width + horizontal chip padding). */
  width: number;
  /** Pre-measured pill height (grows with `lines.length`, see CHIP_LINE_HEIGHT). */
  height: number;
}

export interface PositionedEdge extends GraphEdge {
  points: Point[];
}

/** One module-cluster background region, sized to bound its member nodes. */
export interface PositionedCluster {
  /** The GraphNode.module value this cluster represents, e.g. "root" or "module.child". */
  module: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PositionedGraph {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  clusters: PositionedCluster[];
  width: number;
  height: number;
}

// rankdir 'TB' (top-to-bottom), not 'LR': the user-facing convention here is
// "the source/dependency renders above, arrows flow downward into whatever
// depends on it" (e.g. an azurerm_virtual_network above the
// azurerm_subnet that references it) - a vertical tree reads more naturally
// for that "what this depends on" mental model than a left-to-right chain.
// See computeLayout()'s edge-building comment below for how dagre edge
// direction is deliberately reversed relative to GraphEdge's semantic
// from/to to make this ranking come out the right way round.
const RANKDIR: dagre.GraphLabel['rankdir'] = 'TB';
// NODESEP governs same-rank spacing between adjacent nodes/clusters alike
// (dagre treats a compound cluster as a sized "node" for this purpose too) -
// bumped from 40 so a module's own node (which lives in its *parent*
// scope's cluster, not the child cluster it creates) doesn't crowd right up
// against that child cluster's boundary when dagre places them at a similar
// rank, which previously read as if the module node might be one of that
// cluster's own members.
const NODESEP = 90;
const RANKSEP = 64;
const MARGIN = 24;

// Text-sizing constants. Node width/height are now computed from *real*
// canvas-measured, word-wrapped text (see textMeasure.ts/textWrap.ts) rather
// than a rough character-count heuristic - long identifiers (e.g.
// `azurerm_storage_account_customer_managed_key`) wrap to 2-3 lines within a
// fixed target content width instead of stretching the box arbitrarily wide
// (or overflowing a single unwrapped `<text>`, which is what render.ts used
// to draw).
const MIN_WIDTH = 96;
const MAX_WIDTH = 260;

/**
 * Small rounded-square icon badge drawn in the card's top-left corner (see
 * render.ts's buildNode) - this replaces the old fixed-width left-hand icon
 * gutter (formerly `ICON_GUTTER`) that used to sit as its own column next to
 * a vertically-centered icon. Now the icon overlays the corner instead of
 * occupying a horizontal column, so these are sizing/positioning constants,
 * not a width reservation - `estimateNodeSize()`'s width formula below no
 * longer adds anything for the icon at all. Exported so render.ts positions
 * the badge/icon with these exact same numbers instead of a second
 * hand-copied set that could drift out of sync with `CONTENT_TOP_RESERVE`
 * below.
 */
export const ICON_BADGE_SIZE = 20;
export const ICON_BADGE_RADIUS = 6;
/** Fixed inset from the card's own top-left corner the badge sits at, on both axes. */
export const ICON_BADGE_INSET = 7;

/**
 * Height of the fixed top strip reserved above the name/type/detail/chip
 * text block (see render.ts's buildNode) - covers the corner icon badge's
 * own footprint (`ICON_BADGE_INSET` + `ICON_BADGE_SIZE`) plus a little extra
 * breathing room, so a short single-line card (e.g. a bare `module` node
 * with no type/detail/chips) never has its centered text block sitting
 * under/against the badge. The text block is centered within
 * `node.height - CONTENT_TOP_RESERVE`, not the full card height - see
 * `estimateNodeSize()`'s height formula below and render.ts's `blockTop`.
 */
export const CONTENT_TOP_RESERVE = ICON_BADGE_INSET + ICON_BADGE_SIZE + 7; // 7 + 20 + 7 = 34

// Horizontal padding inside the text column (both edges combined) - the
// card's width is now driven purely by the widest wrapped text line/chip
// row plus this padding, centered; no icon-gutter reservation.
const TEXT_PADDING_X = 16;
// Fixed content width every name/type wraps to - MAX_WIDTH minus the text
// padding, i.e. the box never grows past MAX_WIDTH just because a label is
// long; it wraps within this width instead.
const WRAP_WIDTH = MAX_WIDTH - TEXT_PADDING_X;

const NAME_FONT_SIZE = 12; // .node-label
const TYPE_FONT_SIZE = 10; // .node-type
const DETAIL_FONT_SIZE = 9; // .node-detail
const CHIP_FONT_SIZE = 9; // .node-chip-label

// Weight/style prefixes mirroring theme.css's typography-hierarchy rules
// exactly (name = primary/bold, type = secondary/regular, detail =
// tertiary/italic) - included in the measurement font string too, not just
// the CSS, since a canvas 2D context's `measureText` only reflects whatever
// `ctx.font` shorthand it was given; a mismatched weight/style here would
// make the estimated box narrower than the actually-rendered (bolder/
// slanted) text.
const NAME_FONT_WEIGHT = '600 ';
const DETAIL_FONT_STYLE = 'italic ';

// Line-height/padding constants - exported so render.ts steps its `<tspan>`
// dy offsets and centers text using the exact same numbers this function
// used to compute node height, instead of a second hand-copied set of
// magic numbers that could drift out of sync.
export const NAME_LINE_HEIGHT = 14;
export const TYPE_LINE_HEIGHT = 12;
export const DETAIL_LINE_HEIGHT = 11;
export const NAME_TYPE_GAP = 4; // extra breathing room between name and type blocks
// Reuses the same gap constant between the type block and the detail block
// below it, for the same "consistent breathing room between stacked text
// blocks" look - see render.ts buildNode.
export const TYPE_DETAIL_GAP = NAME_TYPE_GAP;
// Same gap reused again between the detail block (or type/name block, if
// there's no detail) and the first row of variable-reference chips below it.
export const CHIP_BLOCK_GAP = NAME_TYPE_GAP;
// Bottom-only padding below the text/chip block now - the equivalent
// top-side padding is `CONTENT_TOP_RESERVE` above (the corner icon badge's
// own footprint plus breathing room), not this constant, since the text
// block centers within the space *below* that reserved strip rather than
// the full card height. See render.ts's `blockTop`.
const PADDING_BOTTOM = 14;

// ---- Variable-reference chip sizing (see ChipDatum/PositionedNode.chipRows,
// render.ts's chip-drawing in buildNode, and theme.css's `.node-chip-*`
// rules) - a resource/data card's small "which variables feed into me"
// pills, rendered only when computeLayout() is given a `variablesByAddress`
// lookup (i.e. the toggle is on).
export const CHIP_GAP_X = 6; // horizontal gap between chips within a row
export const CHIP_GAP_Y = 4; // vertical gap between chip rows
export const CHIP_PADDING_X = 8; // horizontal padding inside a single chip pill
// Vertical: a single-line chip comes out to CHIP_LINE_HEIGHT + CHIP_PADDING_Y
// = 16px tall, matching the fixed height chips had before multi-line
// wrapping was added, so the common (short) case looks unchanged.
export const CHIP_LINE_HEIGHT = 11;
export const CHIP_PADDING_Y = 5; // total vertical padding inside a single chip pill

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** True for node kinds that render a secondary "type" line under the name. */
function hasSubtitle(kind: GraphNode['kind']): boolean {
  return kind === 'resource' || kind === 'data' || kind === 'module';
}

/**
 * The rendered label for one variable-reference chip: the variable's short
 * name, plus (when `pickNodeDetail` found something worth showing - its
 * default, or its description when the default is withheld for a sensitive
 * variable, see nodeDetail.ts's `pickVariableDetail`) that value too, e.g.
 * "environment: production" or just "admin_password" alone when nothing was
 * found.
 */
function chipLabel(variableNode: GraphNode): string {
  const detail = pickNodeDetail(variableNode);
  return detail ? `${variableNode.name}: ${detail}` : variableNode.name;
}

/**
 * Builds the pre-measured, pre-wrapped chip rows for one `resource`/`data`
 * node's `referencedVariables` (see graphModel.ts) - only ever called when
 * chips are enabled (a `variablesByAddress` lookup was supplied) and the
 * node actually has at least one direct variable reference. Addresses that
 * don't resolve in `variablesByAddress` are skipped silently (defensive
 * only - every address in `referencedVariables` is expected to exist in the
 * unfiltered model this lookup was built from).
 */
function buildChipRows(
  node: GraphNode,
  variablesByAddress: Map<string, GraphNode>,
  measureChip: (text: string) => number
): ChipDatum[][] {
  const chips: ChipDatum[] = [];
  for (const address of node.referencedVariables) {
    const variableNode = variablesByAddress.get(address);
    if (!variableNode) {
      continue;
    }
    const text = chipLabel(variableNode);
    // A chip's own text wraps within WRAP_WIDTH minus its own horizontal
    // padding, same as name/type/detail - a chip is no longer an
    // unbreakable unit, so a long variable name/value combo grows the pill
    // taller (multi-line) instead of running wider than the node itself.
    const lines = wrapText(text, WRAP_WIDTH - CHIP_PADDING_X * 2, measureChip);
    const width = Math.max(...lines.map(measureChip)) + CHIP_PADDING_X * 2;
    const height = lines.length * CHIP_LINE_HEIGHT + CHIP_PADDING_Y;
    chips.push({ address, lines, width, height });
  }
  if (chips.length === 0) {
    return [];
  }
  return packIntoRows(chips, WRAP_WIDTH, (chip) => chip.width + CHIP_GAP_X);
}

interface NodeSize {
  width: number;
  height: number;
  nameLines: string[];
  typeLines: string[];
  detailLines: string[];
  chipRows: ChipDatum[][];
}

/** Optional chip-rendering context passed down from computeLayout()'s own optional parameter - see its doc comment. */
interface ChipContext {
  variablesByAddress: Map<string, GraphNode>;
  measureChip: (text: string) => number;
}

function estimateNodeSize(
  node: GraphNode,
  measureName: (text: string) => number,
  measureType: (text: string) => number,
  measureDetail: (text: string) => number,
  chipContext: ChipContext | undefined
): NodeSize {
  const subtitle = hasSubtitle(node.kind);

  const nameLines = wrapText(node.name, WRAP_WIDTH, measureName);
  const typeLines = subtitle ? wrapText(node.type, WRAP_WIDTH, measureType) : [];

  // pickNodeDetail has its own per-kind rules (see nodeDetail.ts): a curated
  // attribute for resource/data nodes, default/description for variable,
  // value/description for output, the single synthetic attribute for
  // locals, and never anything for module. Called unconditionally here for
  // every kind - nodes with nothing worth surfacing simply get no detail
  // lines.
  const detailValue = pickNodeDetail(node);
  const detailLines = detailValue ? wrapText(detailValue, WRAP_WIDTH, measureDetail) : [];

  // Chips only ever apply to resource/data nodes (see graphModel.ts's
  // `referencedVariables` doc comment - always empty for every other kind)
  // and only when the caller supplied a chip context at all (the toggle is
  // on) - a node with no referenced variables naturally produces no rows via
  // `buildChipRows`'s own empty-check, but skipping the call entirely here
  // when there's no chip context avoids doing any chip work at all while the
  // toggle is off.
  const chipRows =
    chipContext && (node.kind === 'resource' || node.kind === 'data') && node.referencedVariables.length > 0
      ? buildChipRows(node, chipContext.variablesByAddress, chipContext.measureChip)
      : [];

  const widestNameLine = Math.max(...nameLines.map(measureName));
  const widestTypeLine = typeLines.length > 0 ? Math.max(...typeLines.map(measureType)) : 0;
  const widestDetailLine = detailLines.length > 0 ? Math.max(...detailLines.map(measureDetail)) : 0;
  const widestChipRow =
    chipRows.length > 0
      ? Math.max(
          ...chipRows.map((row) => row.reduce((sum, chip) => sum + chip.width, 0) + (row.length - 1) * CHIP_GAP_X)
        )
      : 0;
  const widestLine = Math.max(widestNameLine, widestTypeLine, widestDetailLine, widestChipRow);

  // No icon-gutter reservation anymore - the icon overlays the card's top-
  // left corner (see render.ts buildNode) rather than occupying its own
  // column, so width is driven purely by the widest wrapped text line/chip
  // row plus ordinary horizontal text padding.
  const width = clamp(widestLine + TEXT_PADDING_X, MIN_WIDTH, MAX_WIDTH);

  const nameBlockHeight = nameLines.length * NAME_LINE_HEIGHT;
  const typeBlockHeight = subtitle ? NAME_TYPE_GAP + typeLines.length * TYPE_LINE_HEIGHT : 0;
  const detailBlockHeight = detailLines.length > 0 ? TYPE_DETAIL_GAP + detailLines.length * DETAIL_LINE_HEIGHT : 0;
  // Each row's own height is the tallest chip within it (rows can mix
  // single-line and wrapped multi-line chips), not a fixed constant.
  const chipBlockHeight =
    chipRows.length > 0
      ? CHIP_BLOCK_GAP +
        chipRows.reduce((sum, row) => sum + Math.max(...row.map((chip) => chip.height)), 0) +
        (chipRows.length - 1) * CHIP_GAP_Y
      : 0;
  // CONTENT_TOP_RESERVE (the reserved top strip for the corner icon badge)
  // adds to the card's total height on top of whatever the text/chip blocks
  // already need - see render.ts's `blockTop`, which centers those blocks
  // within `height - CONTENT_TOP_RESERVE`, not the full height.
  const height =
    CONTENT_TOP_RESERVE + PADDING_BOTTOM + nameBlockHeight + typeBlockHeight + detailBlockHeight + chipBlockHeight;

  return { width, height, nameLines, typeLines, detailLines, chipRows };
}

/** Cluster node ids are namespaced so they can never collide with a real address. */
function clusterId(module: string): string {
  return `cluster:${module}`;
}

/**
 * Lays out a GraphModel with dagre: one real node per GraphNode, one dagre
 * edge per GraphEdge, and one compound-graph cluster per distinct `module`
 * value (root included, for consistency - every node always belongs to
 * exactly one cluster, so render.ts never needs a "no cluster" special
 * case). Clusters are flat (one level), not nested by module dot-path - v1
 * keeps the visual grouping simple; nested module.child.module.grandchild
 * addresses still land in their own distinct cluster, just not visually
 * nested inside their parent module's cluster.
 *
 * `options.variablesByAddress`, when supplied, enables the "referenced
 * variable" chip treatment on resource/data cards (see ChipDatum/
 * PositionedNode.chipRows) - a lookup from a `variable` node's own fully-
 * prefixed address to its full GraphNode, built by main.ts from the
 * *unfiltered* GraphModel (variable nodes never appear in `model.nodes`
 * here - see main.ts's filterModel(), which always excludes them from the
 * graph itself now). Omitted (or an empty map) entirely disables chips,
 * i.e. whenever the "show variables, outputs & locals" toggle is off.
 *
 * `options.positionOverrides`, when supplied, is a lookup from a node's own
 * address to a manually-dragged world-space position (see render.ts's
 * onNodeDragEnd/main.ts's positionOverrides) - dagre still lays out the
 * *entire* graph normally on every call (v1's deliberate "post-hoc override"
 * simplification: no real constraint solver re-flows other nodes around a
 * moved one), but any node with an override here has its dagre-computed
 * `x`/`y` overwritten by the override's `x`/`y` afterward (its dagre-computed
 * `width`/`height` is kept as-is). Any edge touching an overridden node gets
 * a simple straight 2-point path directly between its (possibly-overridden)
 * endpoints instead of dagre's original multi-point routing, which assumed
 * the pre-move position; edges between two non-overridden nodes are
 * completely unaffected.
 */
export function computeLayout(
  model: GraphModel,
  options?: {
    variablesByAddress?: Map<string, GraphNode>;
    positionOverrides?: Map<string, { x: number; y: number }>;
  }
): PositionedGraph {
  const g: DagreGraph = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({
    rankdir: RANKDIR,
    nodesep: NODESEP,
    ranksep: RANKSEP,
    marginx: MARGIN,
    marginy: MARGIN,
  });
  g.setDefaultEdgeLabel(() => ({}));

  // Measurers are built once per layout pass (not per node): resolving the
  // effective font-family and spinning up a canvas 2D context are both
  // small but non-zero costs, and every node of a given kind/font shares
  // the same measurer regardless of its own text.
  const fontFamily = resolveEffectiveFontFamily();
  const measureName = createTextMeasurer(`${NAME_FONT_WEIGHT}${NAME_FONT_SIZE}px ${fontFamily}`);
  const measureType = createTextMeasurer(`${TYPE_FONT_SIZE}px ${fontFamily}`);
  const measureDetail = createTextMeasurer(`${DETAIL_FONT_STYLE}${DETAIL_FONT_SIZE}px ${fontFamily}`);
  const measureChip = createTextMeasurer(`${CHIP_FONT_SIZE}px ${fontFamily}`);
  const chipContext: ChipContext | undefined = options?.variablesByAddress
    ? { variablesByAddress: options.variablesByAddress, measureChip }
    : undefined;

  const modules = new Set(model.nodes.map((n) => n.module));
  for (const moduleLabel of modules) {
    // width/height of 0 are placeholders only - dagre auto-sizes compound
    // (parent) nodes to bound their children once layout runs, overwriting
    // whatever's set here.
    g.setNode(clusterId(moduleLabel), { width: 0, height: 0 });
  }

  // Per-node wrapped line arrays (+ chip rows), keyed by address - dagre's
  // NodeLabel only carries width/height (that's all `@dagrejs/dagre`'s own
  // types model), so the actual wrapped text/chips is tracked here and
  // merged back onto each PositionedNode after `dagre.layout()` runs below,
  // rather than trying to smuggle extra fields through dagre's node label
  // object.
  const nodeExtras = new Map<
    string,
    { nameLines: string[]; typeLines: string[]; detailLines: string[]; chipRows: ChipDatum[][] }
  >();

  for (const node of model.nodes) {
    const { width, height, nameLines, typeLines, detailLines, chipRows } = estimateNodeSize(
      node,
      measureName,
      measureType,
      measureDetail,
      chipContext
    );
    g.setNode(node.address, { width, height });
    g.setParent(node.address, clusterId(node.module));
    nodeExtras.set(node.address, { nameLines, typeLines, detailLines, chipRows });
  }

  for (const edge of model.edges) {
    // Defensive guard: every edge endpoint should exist as a node (the
    // extension host guarantees this), but never let a stray/malformed
    // message crash the whole webview's layout pass.
    if (!g.hasNode(edge.from) || !g.hasNode(edge.to)) {
      continue;
    }
    // Reversed relative to GraphEdge's semantic direction: `edge.from` is
    // the *referencing* (dependent) resource and `edge.to` is the
    // *referenced* (source/dependency) resource - see graphModel.ts's "One
    // resolved dependency edge: `from` references `to`" comment. Feeding
    // dagre `(to, from)` here (source, then dependent) makes dagre rank the
    // source above the dependent under the TB rankdir above, so arrows draw
    // flowing downward from source to dependent - e.g. an
    // azurerm_virtual_network (source) ranks above the azurerm_subnet
    // (dependent) that references it.
    g.setEdge(edge.to, edge.from);
  }

  dagre.layout(g);

  const nodes: PositionedNode[] = [];
  for (const node of model.nodes) {
    const label = g.node(node.address);
    const extras = nodeExtras.get(node.address) ?? {
      nameLines: [node.name],
      typeLines: [],
      detailLines: [],
      chipRows: [],
    };
    // A manually-dragged position (see options.positionOverrides doc comment
    // above) overwrites dagre's own computed x/y outright - width/height
    // always stay dagre's own computed values regardless, since a moved node
    // wasn't resized, only repositioned.
    const override = options?.positionOverrides?.get(node.address);
    nodes.push({
      ...node,
      x: override?.x ?? label.x ?? 0,
      y: override?.y ?? label.y ?? 0,
      width: label.width ?? 0,
      height: label.height ?? 0,
      nameLines: extras.nameLines,
      typeLines: extras.typeLines,
      detailLines: extras.detailLines,
      chipRows: extras.chipRows,
    });
  }

  // Final resolved (possibly-overridden) node positions, keyed by address -
  // built from `nodes` above (not read from dagre's own labels directly)
  // specifically so the edge-routing pass below sees each endpoint's real
  // on-screen position, override included.
  const finalPositionByAddress = new Map(nodes.map((n) => [n.address, { x: n.x, y: n.y }]));
  const overriddenAddresses = new Set(options?.positionOverrides?.keys() ?? []);

  const edges: PositionedEdge[] = g.edges().map((e) => {
    const label = g.edge(e);
    // `e.v`/`e.w` are dagre's (source, dependent) - reversed back here to
    // (dependent, source) so PositionedEdge.from/.to keep meaning exactly
    // what GraphEdge.from/.to always meant ("from references to"), for
    // any consumer that relies on that semantic (e.g. tooltips, a future
    // click-to-navigate-via-edge feature). Only the *visual* `points`
    // (and therefore the rendered arrow direction, via render.ts's
    // marker-end on the path built from these points) actually flow
    // source-to-dependent top-to-bottom now - render.ts's buildEdge()
    // only ever reads `.points`, never `.from`/`.to`, so this reversal is
    // entirely internal to this function.
    //
    // If either endpoint was manually dragged, dagre's own multi-point
    // routing assumed the pre-move position and is no longer meaningful -
    // replaced here with a simple straight line directly between the two
    // final (possibly-overridden) node centers instead. Edges where neither
    // endpoint moved keep dagre's original routing untouched.
    const involvesOverride = overriddenAddresses.has(e.v) || overriddenAddresses.has(e.w);
    const sourcePos = finalPositionByAddress.get(e.v);
    const dependentPos = finalPositionByAddress.get(e.w);
    const points =
      involvesOverride && sourcePos && dependentPos
        ? [sourcePos, dependentPos]
        : (label.points ?? []).map((p) => ({ x: p.x, y: p.y }));

    return {
      from: e.w,
      to: e.v,
      points,
    };
  });

  const clusters: PositionedCluster[] = [];
  for (const moduleLabel of modules) {
    const label = g.node(clusterId(moduleLabel));
    if (!label) {
      continue;
    }
    clusters.push({
      module: moduleLabel,
      x: (label.x ?? 0) - (label.width ?? 0) / 2,
      y: (label.y ?? 0) - (label.height ?? 0) / 2,
      width: label.width ?? 0,
      height: label.height ?? 0,
    });
  }

  const graphLabel = g.graph();

  return {
    nodes,
    edges,
    clusters,
    width: graphLabel.width ?? 0,
    height: graphLabel.height ?? 0,
  };
}

// Re-exported for consumers that only need the raw shape (e.g. render.ts
// doesn't need buildGraphModel's Node/Edge types directly, just the
// positioned ones above), kept here so `main.ts`/`render.ts` don't also need
// their own `import type ... from '../../src/graph/graphModel'` line.
export type { GraphEdge, GraphModel, GraphNode } from '../../src/graph/graphModel';
