import type { GraphModel } from '../graph/graphModel';

/**
 * Pure input for buildExportedHtml() below - deliberately no `vscode`/`fs`
 * dependency in this file at all, so the HTML-assembly logic can be unit
 * tested directly under plain Mocha+Node (see test/exportHtml.test.ts),
 * without needing a live VS Code host. graphPanel.ts's message handler is
 * responsible for gathering all of this (reading the bundled webview.js/
 * webview.css off disk, running the save dialog, writing the result) and is
 * the only real caller.
 */
export interface ExportHtmlInput {
  /** The current GraphModel exactly as the webview last received/held it - unfiltered (search never narrows what's exported, see webview/src/main.ts's export click handler doc comment). */
  model: GraphModel;
  /** The webview's current manually-dragged node positions (positionOverrides), keyed by node address. */
  positions: Record<string, { x: number; y: number }>;
  /**
   * Every `--vscode-*`/`--tf-accent-*` custom property theme.css references,
   * resolved against the *live* webview document at export time (see
   * webview/src/main.ts's gatherResolvedColors()) - this is what lets a
   * standalone file (no real VS Code webview host to inject them) still
   * render with the user's real theme colors instead of generic defaults.
   */
  resolvedColors: Record<string, string>;
  /** Whether the "show variables, outputs & locals" toggle was checked at export time. */
  toggleOn: boolean;
  /** Raw text content of the bundled webview/dist/webview.js. */
  webviewJs: string;
  /** Raw text content of the bundled webview/dist/webview.css. */
  webviewCss: string;
}

/**
 * Safely embeds an arbitrary JSON-serializable value inside an inline
 * `<script>` tag: `JSON.stringify()`'s output can legally contain a literal
 * `</script>` substring (e.g. a Terraform resource name or attribute value
 * containing that text) which would otherwise prematurely close the
 * surrounding `<script>` element once concatenated into raw HTML. Escaping
 * every `<` character to its unicode escape sequence is still a perfectly
 * valid JS string/array/object literal (parses back to the exact same
 * value) while neutralizing that risk entirely - the same technique used by
 * e.g. Rails'/`serialize-javascript`'s `json_escape` option.
 */
function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Guards a resolved theme value about to be inlined inside a `<style>`
 * block against one that happens to contain a literal `</style` close tag
 * (theme values are always genuine VS Code theme-derived CSS values in
 * practice, never untrusted remote input, but this keeps the assembled
 * document well-formed even in a pathological case rather than silently
 * corrupting the rest of the file).
 */
function cssValueForInlineStyle(value: string): string {
  return value.replace(/<\/style/gi, '<\\/style');
}

/**
 * Assembles the final standalone, self-contained HTML document a user can
 * open directly in any browser (no VS Code needed) and still interact with
 * (pan/zoom/search/toggle) - same shape as the project's `dev-preview*.html`
 * harnesses (stub `acquireVsCodeApi()`, a literal `:root { --vscode-... }`
 * block, an embedded `GRAPH_MODEL` posted via `window.postMessage`), except
 * every piece here is the *current live* value (real captured theme colors,
 * the graph actually on screen, current dragged positions) rather than a
 * hand-crafted fixture, and the toggle's on/off state is replayed too.
 */
export function buildExportedHtml(input: ExportHtmlInput): string {
  const { model, positions, resolvedColors, toggleOn, webviewJs, webviewCss } = input;

  const rootVarsBlock = Object.entries(resolvedColors)
    .map(([name, value]) => `      ${name}: ${cssValueForInlineStyle(value)};`)
    .join('\n');

  // Only emitted when the toggle was actually on at export time - mirrors
  // webview/src/main.ts's own `configToggleInput.addEventListener('change',
  // () => rerender())` wiring exactly (same element id, same event type), so
  // this drives the exact same code path a real click would.
  const toggleScript = toggleOn
    ? `
      var exportedToggle = document.getElementById('show-config-nodes');
      if (exportedToggle) {
        exportedToggle.checked = true;
        exportedToggle.dispatchEvent(new Event('change'));
      }`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Terraform Dependency Graph (exported)</title>
  <style>
    /* Frozen real theme values, captured from the live VS Code webview at
       export time (see webview/src/main.ts's gatherResolvedColors()) -
       standing in for what a real VS Code webview host would otherwise
       inject automatically, same role webview/dev-preview.html's hardcoded
       :root block plays, but with genuinely captured values instead of a
       hand-picked approximation. */
    :root {
${rootVarsBlock}
    }
${webviewCss}
  </style>
</head>
<body>
  <script>
    // Stub of the ambient global every real VS Code webview provides
    // exactly once - this exported file has no extension host on the other
    // end after export, so postMessage calls (node click "navigate", drag
    // "positionsChanged", ...) are just logged instead of bridged anywhere,
    // matching webview/dev-preview.html's own harness stub.
    window.acquireVsCodeApi = function () {
      return {
        postMessage: function (message) {
          console.log('[exported graph] postMessage from webview:', message);
        },
        getState: function () {
          return undefined;
        },
        setState: function () {
          /* no-op */
        },
      };
    };
  </script>
  <script>
${webviewJs}
  </script>
  <script>
    // Real captured GraphModel/positions - by the time this script tag
    // runs, the previous script tag's top-level code (including its own
    // window.addEventListener('message', ...) call) has already finished
    // executing, since classic script tags run synchronously in document
    // order - so posting here is safe and will always be handled, no race
    // with main.ts's own 'ready' postMessage (same reasoning as
    // webview/dev-preview.html).
    var GRAPH_MODEL = ${jsonForInlineScript(model)};
    var GRAPH_POSITIONS = ${jsonForInlineScript(positions)};
    window.postMessage({ type: 'graph', payload: GRAPH_MODEL, positions: GRAPH_POSITIONS }, '*');
${toggleScript}
  </script>
</body>
</html>
`;
}
