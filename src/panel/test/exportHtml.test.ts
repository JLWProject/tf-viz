import * as assert from 'node:assert/strict';
import { buildExportedHtml } from '../exportHtml';
import type { ExportHtmlInput } from '../exportHtml';
import type { GraphModel } from '../../graph/graphModel';

const SAMPLE_MODEL: GraphModel = {
  nodes: [
    {
      address: 'azurerm_resource_group.rg',
      type: 'azurerm_resource_group',
      name: 'rg',
      module: 'root',
      kind: 'resource',
      attributes: { name: 'rg-example' },
      referencedVariables: [],
    },
    {
      address: 'azurerm_virtual_network.vnet',
      type: 'azurerm_virtual_network',
      name: 'vnet',
      module: 'root',
      kind: 'resource',
      attributes: { name: 'vnet-example' },
      referencedVariables: ['var.vnet_address_space'],
    },
  ],
  edges: [{ from: 'azurerm_virtual_network.vnet', to: 'azurerm_resource_group.rg' }],
  addressLocations: {
    'azurerm_resource_group.rg': { file: 'main.tf', line: 1 },
    'azurerm_virtual_network.vnet': { file: 'main.tf', line: 5 },
  },
};

function baseInput(overrides?: Partial<ExportHtmlInput>): ExportHtmlInput {
  return {
    model: SAMPLE_MODEL,
    positions: { 'azurerm_resource_group.rg': { x: 12, y: 34 } },
    resolvedColors: {
      '--vscode-editor-background': '#1e1e1e',
      '--vscode-editor-foreground': '#cccccc',
    },
    toggleOn: false,
    webviewJs: 'console.log("webview bundle");',
    webviewCss: 'body { color: red; }',
    ...overrides,
  };
}

/** Pulls the literal `var GRAPH_MODEL = <json>;` payload back out of the assembled HTML for round-trip assertions. */
function extractEmbeddedJson(html: string, varName: string): unknown {
  const pattern = new RegExp(`var ${varName} = (.*?);\\n`, 's');
  const match = pattern.exec(html);
  assert.ok(match, `expected to find "var ${varName} = ..." in the assembled HTML`);
  return JSON.parse(match![1]);
}

describe('buildExportedHtml', () => {
  it('embeds the bundled webview.js and webview.css verbatim', () => {
    const html = buildExportedHtml(baseInput());
    assert.ok(html.includes('console.log("webview bundle");'));
    assert.ok(html.includes('body { color: red; }'));
  });

  it('emits a :root block with every resolvedColors entry', () => {
    const html = buildExportedHtml(baseInput());
    assert.ok(html.includes('--vscode-editor-background: #1e1e1e;'));
    assert.ok(html.includes('--vscode-editor-foreground: #cccccc;'));
  });

  it('round-trips the model and positions through the embedded JSON without mangling them', () => {
    const html = buildExportedHtml(baseInput());
    assert.deepEqual(extractEmbeddedJson(html, 'GRAPH_MODEL'), SAMPLE_MODEL);
    assert.deepEqual(extractEmbeddedJson(html, 'GRAPH_POSITIONS'), {
      'azurerm_resource_group.rg': { x: 12, y: 34 },
    });
  });

  it('posts a graph message carrying both payload and positions', () => {
    const html = buildExportedHtml(baseInput());
    assert.ok(
      html.includes(
        "window.postMessage({ type: 'graph', payload: GRAPH_MODEL, positions: GRAPH_POSITIONS }, '*');"
      )
    );
  });

  it('does not simulate the toggle when toggleOn is false', () => {
    const html = buildExportedHtml(baseInput({ toggleOn: false }));
    assert.ok(!html.includes('show-config-nodes'));
  });

  it('simulates checking and change-dispatching the toggle when toggleOn is true', () => {
    const html = buildExportedHtml(baseInput({ toggleOn: true }));
    assert.ok(html.includes("document.getElementById('show-config-nodes')"));
    assert.ok(html.includes('exportedToggle.checked = true;'));
    assert.ok(html.includes("exportedToggle.dispatchEvent(new Event('change'));"));
  });

  it('stubs acquireVsCodeApi so the exported file has no dependency on a real VS Code host', () => {
    const html = buildExportedHtml(baseInput());
    assert.ok(html.includes('window.acquireVsCodeApi = function ()'));
  });

  it('escapes a literal "</script>" inside model data so it cannot prematurely close the embedded script tag', () => {
    const maliciousModel: GraphModel = {
      ...SAMPLE_MODEL,
      nodes: [
        {
          ...SAMPLE_MODEL.nodes[0],
          name: '</script><script>alert(1)</script>',
        },
        SAMPLE_MODEL.nodes[1],
      ],
    };
    const html = buildExportedHtml(baseInput({ model: maliciousModel }));

    // The raw, case-sensitive closing sequence must never appear inside the
    // embedded JSON payload itself (the two legitimate <script> tags this
    // function itself emits are unaffected - only the interpolated JSON is
    // escaped).
    const jsonSection = html.slice(html.indexOf('var GRAPH_MODEL ='));
    assert.ok(!jsonSection.includes('</script><script>alert'));

    // But it still round-trips back to the exact original string once parsed.
    const roundTripped = extractEmbeddedJson(html, 'GRAPH_MODEL') as GraphModel;
    assert.equal(roundTripped.nodes[0].name, '</script><script>alert(1)</script>');
  });

  it('hides the toolbar (search box, checkboxes, buttons) so the exported file shows only the diagram', () => {
    const html = buildExportedHtml(baseInput());
    assert.match(html, /\.toolbar\s*\{\s*display:\s*none;\s*\}/);
  });

  it('falls back to an empty toggle script and still parses as a coherent document when resolvedColors is empty', () => {
    const html = buildExportedHtml(baseInput({ resolvedColors: {} }));
    assert.ok(html.includes(':root {'));
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.trim().endsWith('</html>'));
  });
});
