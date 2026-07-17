// Webview entry point. Builds its own toolbar + canvas DOM (there is no
// shipped index.html yet - that's the next phase's graphPanel.ts - so this
// script must be able to stand on its own against a bare document.body,
// which is also exactly what webview/dev-preview.html exercises).
import './theme.css';
import { computeLayout } from './layout';
import type { GraphEdge, GraphModel, GraphNode } from './layout';
import { isConfigKind, renderGraph } from './render';
import { attachPanZoom } from './panzoom';
import type { PanZoom } from './panzoom';
import { pickNodeDetail } from './nodeDetail';

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState?(): unknown;
  setState?(state: unknown): void;
};

interface GraphMessage {
  type: 'graph';
  payload: GraphModel;
  /**
   * Manually-dragged node positions previously persisted for this root
   * directory (see graphPanel.ts's `workspaceState` read) - keyed by node
   * address, `x`/`y` in the same world-space `PositionedNode.x`/`.y`
   * coordinates a drag reported back. Optional/omitted for a directory with
   * nothing saved yet.
   */
  positions?: Record<string, { x: number; y: number }>;
}
interface ErrorMessage {
  type: 'error';
  message: string;
}
type IncomingMessage = GraphMessage | ErrorMessage;

function isIncomingMessage(value: unknown): value is IncomingMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    ((value as { type: unknown }).type === 'graph' || (value as { type: unknown }).type === 'error')
  );
}

const vscode = acquireVsCodeApi();

// ---- DOM scaffold ---------------------------------------------------------

const app = document.createElement('div');
app.id = 'app';

const toolbar = document.createElement('div');
toolbar.className = 'toolbar';

const searchInput = document.createElement('input');
searchInput.type = 'text';
searchInput.className = 'toolbar-search';
searchInput.placeholder = 'Filter by address, type, or name...';
searchInput.setAttribute('aria-label', 'Filter graph nodes');

// Label/meaning updated: variable/output/locals blocks are never drawn as
// their own graph boxes anymore (see filterModel() below), so this toggle no
// longer means "show config nodes in the graph" - it now controls the
// resource/data card variable-reference chips (render.ts's buildChipRows)
// plus the separate Outputs/Locals list panels (see buildInfoSection below).
const configToggleLabel = document.createElement('label');
configToggleLabel.className = 'toolbar-toggle';
const configToggleInput = document.createElement('input');
configToggleInput.type = 'checkbox';
configToggleInput.id = 'show-config-nodes';
configToggleInput.checked = false; // hidden by default, per the established tf-plan-visualizer pattern
configToggleLabel.setAttribute('for', 'show-config-nodes');
configToggleLabel.appendChild(configToggleInput);
configToggleLabel.appendChild(document.createTextNode('Show variables, outputs & locals'));

// Opt-in, off by default (same convention as configToggleInput above) -
// when on, the extension host (graphPanel.ts's enableLiveMode) both follows
// the active editor to a different Terraform root directory and rebuilds
// automatically whenever a .tf file is saved. Purely a relay: this webview
// has no filesystem/editor access itself, so toggling just informs the host
// which mode to run in.
const liveToggleLabel = document.createElement('label');
liveToggleLabel.className = 'toolbar-toggle';
const liveToggleInput = document.createElement('input');
liveToggleInput.type = 'checkbox';
liveToggleInput.id = 'live-mode';
liveToggleInput.checked = false;
liveToggleLabel.setAttribute('for', 'live-mode');
liveToggleLabel.appendChild(liveToggleInput);
liveToggleLabel.appendChild(document.createTextNode('Live'));

const fitButton = document.createElement('button');
fitButton.type = 'button';
fitButton.className = 'toolbar-button';
fitButton.textContent = 'Fit to view';

const exportButton = document.createElement('button');
exportButton.type = 'button';
exportButton.className = 'toolbar-button';
exportButton.textContent = 'Export HTML';

toolbar.appendChild(searchInput);
toolbar.appendChild(configToggleLabel);
toolbar.appendChild(liveToggleLabel);
toolbar.appendChild(fitButton);
toolbar.appendChild(exportButton);

// The graph canvas and the new Outputs/Locals info panel sit side by side,
// below the toolbar - a docked side panel rather than a bottom drawer, since
// the graph already owns the full canvas height and a side panel doesn't
// compete with dagre's own top-to-bottom layout direction (see layout.ts's
// RANKDIR comment).
const mainArea = document.createElement('div');
mainArea.className = 'main-area';

const graphContainer = document.createElement('div');
graphContainer.className = 'graph-container';

const infoPanel = document.createElement('div');
infoPanel.className = 'info-panel';
infoPanel.hidden = true; // shown by renderInfoPanel() once there's something to list

mainArea.appendChild(graphContainer);
mainArea.appendChild(infoPanel);

app.appendChild(toolbar);
app.appendChild(mainArea);
document.body.appendChild(app);

// ---- State ------------------------------------------------------------

let latestModel: GraphModel | null = null;
let panZoom: PanZoom | null = null;

/**
 * Manually-dragged node positions (see render.ts's onNodeDragEnd) for the
 * *current* graph payload - repopulated wholesale from the incoming
 * `GraphMessage.positions` field whenever a new graph payload arrives (see
 * the `message` listener below), so a root-directory switch (a fresh
 * `graph` message) never carries stale overrides from a previously-viewed
 * directory forward. Mutated in place by onNodeDragEnd itself between
 * `graph` messages, and fed into every `computeLayout()` call so overrides
 * survive search/toggle-triggered re-renders within the same directory.
 */
let positionOverrides = new Map<string, { x: number; y: number }>();

function nodeMatchesSearch(node: GraphNode, query: string): boolean {
  if (query === '') {
    return true;
  }
  const haystack = `${node.address} ${node.type} ${node.name}`.toLowerCase();
  return haystack.includes(query);
}

/**
 * Filters a raw GraphModel down to the subset that should actually be laid
 * out and drawn in the SVG graph. `variable`/`output`/`locals` nodes are
 * ALWAYS excluded here now, regardless of the toggle - they no longer render
 * as graph boxes at all (see the module comment at the top of this file's
 * "show variables, outputs & locals" toggle, and render.ts's isConfigKind()
 * doc comment); that toggle only controls the chips/panels built from the
 * *unfiltered* `latestModel.nodes` elsewhere in this file. `module` nodes
 * are unaffected and still participate in the graph as before. The search
 * box continues to filter the remaining resource/data/module nodes as
 * before. Edges are kept only when both endpoints survive filtering.
 */
function filterModel(model: GraphModel): GraphModel {
  const query = searchInput.value.trim().toLowerCase();

  const visibleNodes: GraphNode[] = model.nodes.filter((node) => {
    if (isConfigKind(node.kind)) {
      return false;
    }
    return nodeMatchesSearch(node, query);
  });

  const visibleAddresses = new Set(visibleNodes.map((n) => n.address));
  const visibleEdges: GraphEdge[] = model.edges.filter(
    (edge) => visibleAddresses.has(edge.from) && visibleAddresses.has(edge.to)
  );

  return { nodes: visibleNodes, edges: visibleEdges, addressLocations: model.addressLocations };
}

/**
 * Builds a lookup from a `variable` node's own fully-prefixed address to its
 * full GraphNode, from the *unfiltered* node list - needed because
 * filterModel() above always strips variable nodes out of what actually
 * reaches computeLayout()/renderGraph(), but layout.ts still needs each
 * variable's own `name`/attributes to render a resource/data card's
 * reference chips.
 */
function buildVariablesByAddress(model: GraphModel): Map<string, GraphNode> {
  const map = new Map<string, GraphNode>();
  for (const node of model.nodes) {
    if (node.kind === 'variable') {
      map.set(node.address, node);
    }
  }
  return map;
}

/**
 * Builds one collapsible-free "Outputs" or "Locals" list section for the
 * info panel from the *unfiltered* node list, filtered down to just that
 * `kind` and (like the graph's own search box) the current search query.
 * Returns `null` (skip the section entirely, per the "don't show an empty
 * Outputs (0) header" requirement) when there's nothing left to list.
 */
function buildInfoSection(title: string, kind: GraphNode['kind'], model: GraphModel, query: string): HTMLElement | null {
  const rows = model.nodes.filter((node) => node.kind === kind && nodeMatchesSearch(node, query));
  if (rows.length === 0) {
    return null;
  }

  const section = document.createElement('section');
  section.className = 'info-section';

  const heading = document.createElement('h2');
  heading.className = 'info-section-title';
  heading.textContent = title;
  section.appendChild(heading);

  const list = document.createElement('div');
  list.className = 'info-section-list';

  for (const node of rows) {
    const detail = pickNodeDetail(node);

    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'info-row';
    row.title = node.address;

    const nameEl = document.createElement('span');
    nameEl.className = 'info-row-name';
    nameEl.textContent = node.name;
    row.appendChild(nameEl);

    if (detail) {
      const detailEl = document.createElement('span');
      detailEl.className = 'info-row-detail';
      detailEl.textContent = detail;
      row.appendChild(detailEl);
    }

    // Same navigate message the graph's own nodes already post on click -
    // clicking an output/local jumps to its source location exactly like
    // everything else in this webview.
    row.addEventListener('click', () => {
      vscode.postMessage({ type: 'navigate', address: node.address });
    });

    list.appendChild(row);
  }

  section.appendChild(list);
  return section;
}

/**
 * Rebuilds the Outputs/Locals side panel from the *unfiltered*
 * `latestModel.nodes` - entirely hidden when the toggle is off, or when
 * there's genuinely nothing to show (both sections empty, e.g. search
 * filtered everything out, or the config simply has no outputs/locals).
 */
function renderInfoPanel(): void {
  infoPanel.innerHTML = '';

  if (!latestModel || !configToggleInput.checked) {
    infoPanel.hidden = true;
    return;
  }

  const query = searchInput.value.trim().toLowerCase();
  const sections = [
    buildInfoSection('Resources', 'resource', latestModel, query),
    buildInfoSection('Data Sources', 'data', latestModel, query),
    buildInfoSection('Modules', 'module', latestModel, query),
    buildInfoSection('Variables', 'variable', latestModel, query),
    buildInfoSection('Outputs', 'output', latestModel, query),
    buildInfoSection('Locals', 'locals', latestModel, query),
  ].filter((section): section is HTMLElement => section !== null);

  if (sections.length === 0) {
    infoPanel.hidden = true;
    return;
  }

  infoPanel.hidden = false;
  for (const section of sections) {
    infoPanel.appendChild(section);
  }
}

function showError(message: string): void {
  graphContainer.innerHTML = '';
  infoPanel.innerHTML = '';
  infoPanel.hidden = true;
  const errorEl = document.createElement('div');
  errorEl.className = 'error-state';
  errorEl.textContent = message;
  graphContainer.appendChild(errorEl);
}

/**
 * Re-runs dagre layout against the currently-filtered node/edge subset and
 * redraws, then rebuilds the Outputs/Locals info panel alongside it.
 * Re-layout (rather than hiding already-positioned DOM elements) keeps
 * remaining nodes reflowed into a clean layout whenever the search box
 * removes nodes - Terraform configs are small enough (single directory's
 * worth of blocks) that redoing the full dagre pass on every filter change
 * is not a perf concern. `positionOverrides` is always passed through to
 * `computeLayout()` so a manually-dragged node's position survives every
 * re-layout, search/toggle-triggered or otherwise.
 *
 * `options.resetView` (default `true`) controls whether the freshly
 * re-attached pan/zoom handle also re-fits the view: the initial load, a
 * search keystroke, and the config toggle all still auto-fit on every
 * render, since node positions genuinely aren't stable across those
 * re-layouts and preserving the previous transform would just leave the
 * view pointed at the wrong place - but a drag-triggered re-render (see
 * onNodeDragEnd below) passes `resetView: false` and its previous transform
 * forward instead, since re-fitting there would immediately undo the
 * framing/zoom the user just chose, for a change that (by definition) only
 * moved the one node they just dragged.
 */
function rerender(options?: { resetView?: boolean }): void {
  if (!latestModel) {
    return;
  }

  // Captured before the DOM is torn down/rebuilt below - the *current*
  // panZoom handle (if any) still reflects whatever transform the user's
  // last pan/zoom/drag interaction left it at.
  const previousTransform = panZoom?.getTransform();

  const filtered = filterModel(latestModel);
  const showConfig = configToggleInput.checked;
  const variablesByAddress = showConfig ? buildVariablesByAddress(latestModel) : undefined;
  const positioned = computeLayout(filtered, {
    ...(variablesByAddress ? { variablesByAddress } : {}),
    positionOverrides,
  });

  renderGraph(
    graphContainer,
    positioned,
    (address) => {
      vscode.postMessage({ type: 'navigate', address });
    },
    (address, x, y) => {
      positionOverrides.set(address, { x, y });
      rerender({ resetView: false });
      vscode.postMessage({
        type: 'positionsChanged',
        positions: Object.fromEntries(positionOverrides),
      });
    }
  );

  renderInfoPanel();

  const svg = graphContainer.querySelector('svg.graph-svg') as SVGSVGElement | null;
  const viewport = graphContainer.querySelector('#viewport') as SVGGElement | null;
  if (svg && viewport) {
    const shouldResetView = options?.resetView !== false;
    panZoom = attachPanZoom(svg, viewport, shouldResetView ? undefined : previousTransform);
    if (shouldResetView) {
      panZoom.reset();
    }
  } else {
    panZoom = null;
  }
}

// ---- Export as standalone HTML -------------------------------------------
//
// "Export HTML" freezes the graph *currently on screen* into a portable,
// self-contained .html file the extension host (graphPanel.ts) assembles
// from the exact same shape webview/dev-preview.html's harness already
// proves works standalone: a stub acquireVsCodeApi(), a literal `:root {
// --vscode-... }` block, and an embedded `GRAPH_MODEL` posted via
// `window.postMessage`. The host has direct filesystem access (to read the
// bundled webview.js/webview.css and write wherever the save dialog picked)
// but does NOT have access to what `--vscode-editor-background` etc.
// actually *resolve to* right now - that only exists in this live DOM via
// getComputedStyle() - so this webview gathers the resolved colors and
// posts everything up; see graphPanel.ts's `exportHtml` handler for the
// assembly step.

/**
 * Every `--vscode-*`/`--tf-accent-*` custom property theme.css actually
 * references via `var(...)` - confirmed by grepping theme.css for every
 * `var(--...)` call site, not guessed. This is the concrete list "freeze the
 * current theme into literal values" resolves against. Keep in sync with
 * theme.css by hand if its own `var(--vscode-...)` references ever change -
 * there is no automated cross-check for this list.
 */
const THEME_CSS_CUSTOM_PROPERTIES: readonly string[] = [
  '--tf-accent-config',
  '--tf-accent-module',
  '--tf-accent-primary',
  '--vscode-button-background',
  '--vscode-button-border',
  '--vscode-button-foreground',
  '--vscode-button-hoverBackground',
  '--vscode-button-secondaryBackground',
  '--vscode-button-secondaryForeground',
  '--vscode-button-secondaryHoverBackground',
  '--vscode-charts-blue',
  '--vscode-charts-orange',
  '--vscode-charts-purple',
  '--vscode-checkbox-background',
  '--vscode-checkbox-border',
  '--vscode-descriptionForeground',
  '--vscode-editor-background',
  '--vscode-editor-font-family',
  '--vscode-editor-foreground',
  '--vscode-editor-inactiveSelectionBackground',
  '--vscode-editorLineNumber-foreground',
  '--vscode-errorForeground',
  '--vscode-focusBorder',
  '--vscode-font-family',
  '--vscode-font-size',
  '--vscode-input-background',
  '--vscode-input-border',
  '--vscode-input-foreground',
  '--vscode-input-placeholderForeground',
  '--vscode-panel-border',
  '--vscode-statusBarItem-remoteBackground',
  '--vscode-textLink-foreground',
  '--vscode-widget-shadow',
];

/**
 * Resolves every token in THEME_CSS_CUSTOM_PROPERTIES against the live
 * document right now into a plain `name -> value` map for the host to freeze
 * into the exported file's own `:root` block.
 *
 * Note: `--tf-accent-*`'s own *specified* value in theme.css is itself a
 * `var(--vscode-..., var(...))` fallback chain, not a literal - CSS custom
 * properties are never eagerly substituted into each other (substitution
 * only happens once a real property like `color`/`fill` finally consumes
 * one), so `getPropertyValue()` below returns that chain's literal source
 * text for those three tokens, not a resolved color. That's fine here: the
 * exported file re-embeds theme.css's own `:root` rule verbatim right after
 * this frozen block (see graphPanel.ts's buildExportedHtml), so
 * `--tf-accent-*` still ends up correctly re-derived at real render time
 * from the *other*, genuinely literal, `--vscode-*` values captured below -
 * this function does not need to "solve" that chain itself.
 */
function gatherResolvedColors(): Record<string, string> {
  const computed = getComputedStyle(document.documentElement);
  const resolved: Record<string, string> = {};
  for (const name of THEME_CSS_CUSTOM_PROPERTIES) {
    const value = computed.getPropertyValue(name).trim();
    if (value !== '') {
      resolved[name] = value;
    }
  }
  return resolved;
}

// ---- Wiring -------------------------------------------------------------

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  const message = event.data;
  if (!isIncomingMessage(message)) {
    return;
  }

  if (message.type === 'error') {
    latestModel = null;
    showError(message.message);
    return;
  }

  latestModel = message.payload;
  // Always repopulated wholesale (not merged) from this message's own
  // `positions` field - a `graph` message can represent a different root
  // directory than whatever was previously loaded (folder-picker override,
  // a refresh that re-resolved elsewhere, ...), and that directory's own
  // stored positions (or none at all) should entirely replace, never merge
  // with, overrides left over from a previous directory's session.
  positionOverrides = new Map(Object.entries(message.positions ?? {}));
  rerender();
});

searchInput.addEventListener('input', () => rerender());
configToggleInput.addEventListener('change', () => rerender());
liveToggleInput.addEventListener('change', () => {
  vscode.postMessage({ type: 'setLiveMode', enabled: liveToggleInput.checked });
});
fitButton.addEventListener('click', () => {
  panZoom?.reset();
});

/**
 * Outgoing "export the current graph as a standalone HTML file" message -
 * the extension host (graphPanel.ts's `handleMessage`/`exportHtml`) is the
 * single consumer; see that file's own `IncomingMessage` union, which must
 * be kept in sync with this shape by hand (same convention already
 * established there for `ready`/`navigate`/`positionsChanged`). Message
 * shape:
 *   - `model`: the *current, unfiltered* `latestModel` - filterModel() only
 *     ever affects what's drawn on screen, never `latestModel` itself, so
 *     this is already the full graph regardless of the search box.
 *   - `positions`: the current `positionOverrides`, so manually-dragged
 *     node positions survive into the export.
 *   - `resolvedColors`: this file's own gatherResolvedColors() snapshot -
 *     the current theme frozen into literal values.
 *   - `toggleOn`: the current "show variables, outputs & locals" checkbox
 *     state, so the export opens with the same chips/info-panel visibility
 *     the user had on screen.
 * Deliberately does NOT send the current search box text - a stale search
 * filter baked into a file the recipient never typed themselves would be
 * confusing to open, whereas the toggle state and dragged positions remain
 * meaningful for a "snapshot to share" export. (Judgment call, per the
 * feature's own design doc - the toggle/positions are kept, search resets.)
 */
exportButton.addEventListener('click', () => {
  if (!latestModel) {
    return; // nothing loaded yet (or currently showing the error state) - nothing to export
  }
  vscode.postMessage({
    type: 'exportHtml',
    model: latestModel,
    positions: Object.fromEntries(positionOverrides),
    resolvedColors: gatherResolvedColors(),
    toggleOn: configToggleInput.checked,
  });
});

// Rescales the graph to the container's *current* size whenever the
// container is actually resized (editor split dragged wider/narrower, VS
// Code window resized, etc.) - without this, panZoom's transform stays
// frozen at whatever size existed at the last full re-render (see
// rerender()'s own panZoom.reset() call, which only fires once per
// re-layout, not on every subsequent resize). ResizeObserver callbacks can
// fire many times in a row during a continuous drag-resize, so calls are
// debounced here; only the resize-triggered path is debounced - the
// toolbar's own "Fit to view" click handler above stays an immediate,
// un-debounced call. Reads the live `panZoom` variable on every fire (not a
// value captured once at setup time) since rerender() reassigns it on every
// re-layout, and guards the same way the rest of this file already does
// (`panZoom?.reset()`) for the no-graph-yet / error-state case where
// `panZoom` is `null`. Observer is created once here, at initial wiring
// time, against `graphContainer` (present in the DOM from page load) - not
// recreated on every rerender().
let resizeDebounceHandle: number | undefined;
const graphResizeObserver = new ResizeObserver(() => {
  if (resizeDebounceHandle !== undefined) {
    window.clearTimeout(resizeDebounceHandle);
  }
  resizeDebounceHandle = window.setTimeout(() => {
    resizeDebounceHandle = undefined;
    panZoom?.reset();
  }, 150);
});
graphResizeObserver.observe(graphContainer);

// Tell the extension host it's safe to post the initial graph now that
// message listeners are attached - avoids a load-order race where the host
// posts before this script has finished evaluating.
vscode.postMessage({ type: 'ready' });
