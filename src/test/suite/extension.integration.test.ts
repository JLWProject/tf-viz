import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

const EXTENSION_ID = 'jlwproject.tf-graph-visualizer';
const GRAPH_PANEL_VIEW_TYPE = 'tfGraphVisualizer';

type ShowInformationMessage = typeof vscode.window.showInformationMessage;

/** Every tab (across every tab group) whose input is a webview. */
function webviewTabs(): vscode.Tab[] {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.input instanceof vscode.TabInputWebview);
}

/** Webview tabs that look like they belong to this extension's graph panel. */
function graphPanelTabs(): vscode.Tab[] {
  return webviewTabs().filter((tab) => {
    const input = tab.input as vscode.TabInputWebview;
    // The real VS Code API can internally prefix the registered viewType
    // (implementation detail, not part of the public contract) - `includes`
    // rather than `===` so this assertion doesn't quietly start failing if
    // that internal prefixing changes across VS Code versions.
    return input.viewType.includes(GRAPH_PANEL_VIEW_TYPE);
  });
}

/**
 * Temporarily replaces `vscode.window.showInformationMessage` to observe
 * whether/what the extension reports, then restores the original. The
 * `vscode.window` namespace object isn't frozen inside a real extension
 * host, so this reassignment is safe for the lifetime of a single test - a
 * lightweight substitute for a full mocking library for this one call site.
 */
async function captureInformationMessage<T>(
  action: () => Thenable<T>
): Promise<{ result: T; messages: string[] }> {
  const original: ShowInformationMessage = vscode.window.showInformationMessage;
  const messages: string[] = [];

  (vscode.window as { showInformationMessage: unknown }).showInformationMessage = (
    message: string
  ): Thenable<string | undefined> => {
    messages.push(message);
    return Promise.resolve(undefined);
  };

  try {
    const result = await action();
    return { result, messages };
  } finally {
    (vscode.window as { showInformationMessage: unknown }).showInformationMessage = original;
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Real VS-Code-hosted integration tests, launched via @vscode/test-electron
 * (see src/test/runTest.ts) against the tools/tf-hcl-graph/testdata/
 * nested_module fixture opened as the single workspace folder. These have
 * full access to the real `vscode` API - unlike src/test/terraformRoot.test.
 * ts, which is a plain Mocha+Node unit test that never touches `vscode`.
 *
 * Ordering note: these tests share one real, module-level singleton
 * (`TfGraphPanel.current`) inside the single launched Extension Development
 * Host for this whole file, and Mocha runs `it` blocks within a `describe`
 * in file-declaration order (no randomization configured) - so the order
 * below is deliberate: "refresh with nothing ever opened" must run before
 * anything opens a panel, and the "already open" tests must run after.
 */
describe('tf-graph-visualizer integration', () => {
  it('activates and registers its commands', async () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `expected to find extension "${EXTENSION_ID}" - check package.json publisher/name`);

    if (!extension.isActive) {
      await extension.activate();
    }
    assert.equal(extension.isActive, true, 'extension should be active');

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('tfGraphVisualizer.open'), 'tfGraphVisualizer.open should be registered');
    assert.ok(
      commands.includes('tfGraphVisualizer.openForFolder'),
      'tfGraphVisualizer.openForFolder should be registered'
    );
    assert.ok(commands.includes('tfGraphVisualizer.refresh'), 'tfGraphVisualizer.refresh should be registered');
  });

  it('refresh with no panel ever opened reports it has nothing to refresh, and does not throw', async () => {
    assert.equal(graphPanelTabs().length, 0, 'precondition: no graph panel tab should exist yet');

    const { messages } = await captureInformationMessage(() =>
      // executeCommand rejecting would fail this test on its own; the real
      // assertions below check *what* happened, not just "didn't throw".
      vscode.commands.executeCommand('tfGraphVisualizer.refresh')
    );

    assert.equal(
      messages.some((message) => message.toLowerCase().includes('no terraform dependency graph panel')),
      true,
      `expected an informational message about there being no open panel, got: ${JSON.stringify(messages)}`
    );
    assert.equal(graphPanelTabs().length, 0, 'refresh with nothing open should not have created a panel');
  });

  it('open resolves the single open workspace folder (no folder picker) and creates a graph panel', async () => {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(
      folders && folders.length === 1,
      'expected exactly one workspace folder to be open (the nested_module fixture, via launchArgs)'
    );

    await vscode.commands.executeCommand('tfGraphVisualizer.open');

    // buildAndPost spawns the tf-hcl-graph binary and posts a message to the
    // webview asynchronously - give it a moment to settle before asserting.
    await wait(1500);

    assert.equal(graphPanelTabs().length, 1, 'expected exactly one graph panel tab to have been created');
  });

  it('refresh rebuilds the already-open panel in place, without creating a second one', async () => {
    assert.equal(
      graphPanelTabs().length,
      1,
      'precondition: the panel opened by the previous test should still be open'
    );

    await vscode.commands.executeCommand('tfGraphVisualizer.refresh');
    await wait(1500);

    assert.equal(
      graphPanelTabs().length,
      1,
      'refresh should reveal/rebuild the existing panel in place, not open an additional one'
    );
  });
});
