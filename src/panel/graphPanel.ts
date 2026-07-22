import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { buildGraphModel } from '../graph/graphModel';
import type { GraphModel, SourceLocation } from '../graph/graphModel';
import { runHclGraphCli } from '../hclGraphCli';
import { getRememberedRootDirectory, positionsStateKey, rememberRootDirectory } from '../terraformRoot';
import { buildExportedHtml } from './exportHtml';

/** Registered `createWebviewPanel`/`registerWebviewPanelSerializer` viewType - kept as one constant so the two call sites can never drift apart. */
const VIEW_TYPE = 'tfGraphVisualizer';

/**
 * Debounce window for live-mode's auto-refresh-on-save (see enableLiveMode)
 * - a save of multiple dirty files in quick succession (e.g. "Save All")
 * should trigger one rebuild, not one per file.
 */
const LIVE_SAVE_DEBOUNCE_MS = 300;

/** One root directory's saved manual node-drag positions, keyed by node address - see terraformRoot.ts's positionsStateKey(). */
type StoredPositions = Record<string, { x: number; y: number }>;

/**
 * Wire messages posted FROM the extension host TO the webview.
 * Mirrors webview/src/main.ts's `IncomingMessage` union exactly - if that
 * contract ever changes, this must change with it.
 */
type OutgoingMessage =
  | { type: 'graph'; payload: GraphModel; positions: StoredPositions }
  | { type: 'error'; message: string };

/**
 * Wire messages posted FROM the webview TO the extension host.
 * Mirrors webview/src/main.ts's `vscode.postMessage` call sites: `{type:
 * 'ready'}` on load, `{type: 'navigate', address}` on node click, `{type:
 * 'positionsChanged', positions}` whenever a node drag completes, `{type:
 * 'exportHtml', model, positions, resolvedColors, toggleOn}` when the
 * toolbar's "Export HTML" button is clicked (see main.ts's own doc comment
 * on that postMessage call for the field-by-field rationale).
 */
type IncomingMessage =
  | { type: 'ready' }
  | { type: 'navigate'; address: string }
  | { type: 'positionsChanged'; positions: StoredPositions }
  | { type: 'setLiveMode'; enabled: boolean }
  | {
      type: 'exportHtml';
      model: GraphModel;
      positions: StoredPositions;
      resolvedColors: Record<string, string>;
      toggleOn: boolean;
    };

/** Validates an untrusted `positions` payload from the webview at the message boundary before it's ever persisted. */
function isStoredPositions(value: unknown): value is StoredPositions {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as { x?: unknown }).x === 'number' &&
      typeof (entry as { y?: unknown }).y === 'number'
  );
}

/** Validates an untrusted `resolvedColors` payload from the webview at the message boundary before it's ever written into the exported file. */
function isResolvedColors(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return Object.values(value as Record<string, unknown>).every((entry) => typeof entry === 'string');
}

/** Light structural check only (not a full schema validation) - just enough to rule out a malformed/unexpected payload before it's embedded into the exported file. */
function isGraphModelLike(value: unknown): value is GraphModel {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { nodes?: unknown; edges?: unknown; addressLocations?: unknown };
  return (
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.edges) &&
    typeof candidate.addressLocations === 'object' &&
    candidate.addressLocations !== null
  );
}

function isIncomingMessage(value: unknown): value is IncomingMessage {
  if (typeof value !== 'object' || value === null || !('type' in value)) {
    return false;
  }
  const type = (value as { type: unknown }).type;
  if (type === 'ready') {
    return true;
  }
  if (type === 'navigate') {
    return typeof (value as { address?: unknown }).address === 'string';
  }
  if (type === 'positionsChanged') {
    return isStoredPositions((value as { positions?: unknown }).positions);
  }
  if (type === 'setLiveMode') {
    return typeof (value as { enabled?: unknown }).enabled === 'boolean';
  }
  if (type === 'exportHtml') {
    const candidate = value as {
      model?: unknown;
      positions?: unknown;
      resolvedColors?: unknown;
      toggleOn?: unknown;
    };
    return (
      isGraphModelLike(candidate.model) &&
      isStoredPositions(candidate.positions) &&
      isResolvedColors(candidate.resolvedColors) &&
      typeof candidate.toggleOn === 'boolean'
    );
  }
  return false;
}

function getNonce(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Manages the single (singleton) webview panel's lifecycle: creation,
 * reveal-on-reopen, the bidirectional postMessage bridge, and
 * click-to-navigate. See project/plan.md for the overall design.
 */
export class TfGraphPanel {
  private static current: TfGraphPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private readonly disposables: vscode.Disposable[] = [];

  /** True once the webview has posted `{type: 'ready'}` at least once. */
  private webviewReady = false;
  /** The most recent message we owe the webview, sent as soon as it's ready. */
  private pendingMessage: OutgoingMessage | undefined;
  /** Whether at least one build for this panel instance has succeeded. */
  private hasSuccessfulBuild = false;
  /** Looked up by address when the webview reports a node click. */
  private addressLocations: Record<string, SourceLocation> = {};
  /**
   * The root directory the *last successful* build was against - only set
   * once `buildAndPost` actually succeeds (never on a failed rebuild, which
   * per the plan leaves the last-good graph on screen), so a `positions
   * Changed` message from the webview always persists against the directory
   * the webview is actually currently showing. `undefined` until the first
   * successful build.
   */
  private currentRootDirectory: string | undefined;

  /**
   * Live-mode's own listeners (`onDidChangeActiveTextEditor`/
   * `onDidSaveTextDocument`) - kept separate from `disposables` above so
   * `disableLiveMode()` can tear down just these without touching the
   * panel's own message/dispose subscriptions. Empty whenever live mode is
   * off (used as the "already enabled" guard in `enableLiveMode`).
   */
  private liveModeDisposables: vscode.Disposable[] = [];
  /** Pending debounce timer for live-mode's auto-refresh-on-save, if any. */
  private liveRefreshTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.context = context;

    this.panel.webview.html = this.renderHtml();

    this.panel.webview.onDidReceiveMessage(
      (message: unknown) => this.handleMessage(message),
      undefined,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  static get isOpen(): boolean {
    return TfGraphPanel.current !== undefined;
  }

  /**
   * Reveals the existing panel (rebuilding against `rootDirectory`) or
   * creates a fresh one. Returns whether the resulting build succeeded, so
   * callers know whether it's safe to remember `rootDirectory` for next time.
   */
  static async showOrReveal(
    context: vscode.ExtensionContext,
    rootDirectory: string
  ): Promise<boolean> {
    if (TfGraphPanel.current) {
      TfGraphPanel.current.panel.reveal(vscode.ViewColumn.Beside);
      return TfGraphPanel.current.buildAndPost(rootDirectory);
    }

    const panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      'Terraform Dependency Graph',
      vscode.ViewColumn.Beside,
      TfGraphPanel.webviewOptions(context)
    );

    const instance = new TfGraphPanel(panel, context);
    TfGraphPanel.current = instance;
    return instance.buildAndPost(rootDirectory);
  }

  private static webviewOptions(context: vscode.ExtensionContext): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    return {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'webview', 'dist'))],
    };
  }

  /**
   * Registers this extension as the reviver for any `tfGraphVisualizer`
   * webview VS Code itself tries to restore (a window reload, or "Reopen
   * Closed Editor") after the tab was closed with the panel still open.
   * Without this, VS Code recreates the raw `WebviewPanel` on our behalf but
   * never calls back into this class - so it sits on screen with none of the
   * html/message-wiring `showOrReveal` above would normally set up, showing
   * a permanently blank canvas until the user closes it and re-runs "Show
   * Dependency Graph" manually. This wires the restored panel up exactly
   * like a freshly created one, then rebuilds it against whatever root
   * directory was last remembered for this workspace (see
   * getRememberedRootDirectory) - or, if nothing's remembered yet, leaves it
   * showing the same "nothing to show" error state a fresh panel with no
   * root would.
   */
  static register(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
      deserializeWebviewPanel: async (panel) => {
        panel.webview.options = TfGraphPanel.webviewOptions(context);

        // Only one graph panel is ever meant to exist at once (see the class
        // doc comment) - defensive in case a live instance somehow already
        // exists by the time VS Code restores another, so the two never race
        // over the same workspaceState-backed root directory.
        TfGraphPanel.current?.dispose();

        const instance = new TfGraphPanel(panel, context);
        TfGraphPanel.current = instance;

        const root = getRememberedRootDirectory(context);
        if (root) {
          await instance.buildAndPost(root);
        } else {
          instance.post({
            type: 'error',
            message: 'No remembered Terraform root directory. Run "Terraform: Show Dependency Graph" to pick one.',
          });
        }
      },
    });
  }

  private async buildAndPost(rootDirectory: string): Promise<boolean> {
    try {
      const parserOutput = await runHclGraphCli(rootDirectory);
      const model = buildGraphModel(parserOutput);

      this.addressLocations = model.addressLocations;
      this.hasSuccessfulBuild = true;
      // Only updated on success (see the field's own doc comment) - a later
      // failed rebuild against a different directory must not repoint
      // currentRootDirectory (and therefore where a subsequent
      // `positionsChanged` message gets persisted) away from the directory
      // still actually on screen.
      this.currentRootDirectory = rootDirectory;
      const positions =
        this.context.workspaceState.get<StoredPositions>(positionsStateKey(rootDirectory)) ?? {};
      this.post({ type: 'graph', payload: model, positions });
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const message = `Failed to build the Terraform dependency graph for "${rootDirectory}": ${detail}`;

      void vscode.window.showErrorMessage(message);

      // Per the plan: once a panel has shown a graph successfully, a later
      // failed refresh should leave the last-good graph on screen rather
      // than blanking it out with an error state.
      if (!this.hasSuccessfulBuild) {
        this.post({ type: 'error', message });
      }
      return false;
    }
  }

  private post(message: OutgoingMessage): void {
    this.pendingMessage = message;
    if (this.webviewReady) {
      void this.panel.webview.postMessage(message);
    }
  }

  private handleMessage(raw: unknown): void {
    if (!isIncomingMessage(raw)) {
      return;
    }

    if (raw.type === 'ready') {
      this.webviewReady = true;
      if (this.pendingMessage) {
        void this.panel.webview.postMessage(this.pendingMessage);
      }
      return;
    }

    if (raw.type === 'positionsChanged') {
      // No response needed - and nothing to persist against if a
      // `positionsChanged` message somehow arrives before any build has ever
      // succeeded (shouldn't happen in practice, since the webview only ever
      // drags a node it already rendered from a successfully-posted graph,
      // but defensive here rather than persisting under an undefined key).
      if (this.currentRootDirectory) {
        void this.context.workspaceState.update(
          positionsStateKey(this.currentRootDirectory),
          raw.positions
        );
      }
      return;
    }

    if (raw.type === 'exportHtml') {
      void this.exportHtml(raw);
      return;
    }

    if (raw.type === 'setLiveMode') {
      if (raw.enabled) {
        this.enableLiveMode();
      } else {
        this.disableLiveMode();
      }
      return;
    }

    void this.navigateTo(raw.address);
  }

  /**
   * Turns on "Live" mode (webview's `liveToggleInput` - see main.ts): the
   * panel starts following the active editor to a different Terraform root
   * directory, and rebuilds automatically whenever any `.tf` file is saved.
   * A no-op if already enabled (`liveModeDisposables` non-empty acts as the
   * guard, so toggling the webview checkbox twice in a row - or a stray
   * duplicate message - never registers the listeners twice).
   */
  private enableLiveMode(): void {
    if (this.liveModeDisposables.length > 0) {
      return;
    }

    // Sync immediately on enable, rather than waiting for the next editor
    // switch - if the user already has a different stack's file focused
    // when they flip the toggle on, it should jump there right away.
    this.followActiveEditor(vscode.window.activeTextEditor);

    this.liveModeDisposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => this.followActiveEditor(editor)),
      vscode.workspace.onDidSaveTextDocument((document) => this.onTerraformFileSaved(document))
    );
  }

  private disableLiveMode(): void {
    if (this.liveRefreshTimer) {
      clearTimeout(this.liveRefreshTimer);
      this.liveRefreshTimer = undefined;
    }
    while (this.liveModeDisposables.length) {
      this.liveModeDisposables.pop()?.dispose();
    }
  }

  /**
   * If `editor` is a `.tf` file whose directory differs from what's
   * currently on screen, rebuilds against it and remembers it as the new
   * "last root" (same bookkeeping `extension.ts`'s own `openAgainst` does
   * for the manual "Show Dependency Graph" command) - so live-following to a
   * different stack sticks for next time the panel is reopened, exactly
   * like manually re-running the command against that file would have.
   */
  private followActiveEditor(editor: vscode.TextEditor | undefined): void {
    const document = editor?.document;
    if (!document || document.uri.scheme !== 'file' || !document.fileName.toLowerCase().endsWith('.tf')) {
      return;
    }

    const directory = path.dirname(document.uri.fsPath);
    if (directory === this.currentRootDirectory) {
      return;
    }

    void this.buildAndPost(directory).then((succeeded) => {
      if (succeeded) {
        void rememberRootDirectory(this.context, directory);
      }
    });
  }

  /**
   * Debounced auto-refresh: any `.tf` file being saved anywhere (not just
   * under the current root) can change the graph on screen - a shared child
   * module's file is a common case - so this deliberately doesn't filter by
   * directory, just rebuilds whatever root is currently shown.
   */
  private onTerraformFileSaved(document: vscode.TextDocument): void {
    if (document.uri.scheme !== 'file' || !document.fileName.toLowerCase().endsWith('.tf')) {
      return;
    }
    if (!this.currentRootDirectory) {
      return;
    }

    if (this.liveRefreshTimer) {
      clearTimeout(this.liveRefreshTimer);
    }
    const rootDirectory = this.currentRootDirectory;
    this.liveRefreshTimer = setTimeout(() => {
      this.liveRefreshTimer = undefined;
      void this.buildAndPost(rootDirectory);
    }, LIVE_SAVE_DEBOUNCE_MS);
  }

  /**
   * Handles the toolbar's "Export HTML" button: prompts for a save location,
   * assembles a standalone, self-contained HTML document (see
   * exportHtml.ts's buildExportedHtml doc comment) from the webview's
   * current live model/positions/theme colors/toggle state, and writes it
   * out. Cancelling the save dialog is a silent no-op (same "no error, no
   * dead end" convention as pickRootDirectoryFolder() in terraformRoot.ts).
   */
  private async exportHtml(message: {
    model: GraphModel;
    positions: StoredPositions;
    resolvedColors: Record<string, string>;
    toggleOn: boolean;
  }): Promise<void> {
    const defaultFileName = this.currentRootDirectory
      ? `${path.basename(this.currentRootDirectory)}-dependency-graph.html`
      : 'dependency-graph.html';
    const defaultUri = this.currentRootDirectory
      ? vscode.Uri.file(path.join(this.currentRootDirectory, defaultFileName))
      : vscode.Uri.file(defaultFileName);

    const targetUri = await vscode.window.showSaveDialog({
      filters: { HTML: ['html'] },
      saveLabel: 'Export Graph as HTML',
      defaultUri,
    });

    if (!targetUri) {
      return; // user cancelled - no error, no dead end
    }

    try {
      // Read straight off disk (not via vscode.workspace.fs) - these are
      // plain extension-bundled files under extensionPath, not user
      // workspace files, same "path.join(this.context.extensionPath,
      // 'webview', 'dist', ...)" convention renderHtml() above already uses
      // to locate them, just read as raw text here instead of turned into a
      // webview URI. Writing the *result* below still goes through
      // `vscode.workspace.fs` though, since the destination is a
      // user/save-dialog-chosen Uri that (unlike these two fixed bundled
      // paths) may live on a remote/virtual filesystem.
      const webviewJsPath = path.join(this.context.extensionPath, 'webview', 'dist', 'webview.js');
      const webviewCssPath = path.join(this.context.extensionPath, 'webview', 'dist', 'webview.css');
      const [webviewJs, webviewCss] = await Promise.all([
        fs.readFile(webviewJsPath, 'utf8'),
        fs.readFile(webviewCssPath, 'utf8'),
      ]);

      const html = buildExportedHtml({
        model: message.model,
        positions: message.positions,
        resolvedColors: message.resolvedColors,
        toggleOn: message.toggleOn,
        webviewJs,
        webviewCss,
      });

      await vscode.workspace.fs.writeFile(targetUri, Buffer.from(html, 'utf8'));
      void vscode.window.showInformationMessage(
        `Exported the Terraform dependency graph to "${targetUri.fsPath}".`
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `Failed to export the Terraform dependency graph as HTML: ${detail}`
      );
    }
  }

  private async navigateTo(address: string): Promise<void> {
    const location = this.addressLocations[address];
    if (!location) {
      void vscode.window.showWarningMessage(
        `Could not find a source location for "${address}".`
      );
      return;
    }

    try {
      const targetUri = vscode.Uri.file(location.file);
      const document = await vscode.workspace.openTextDocument(targetUri);

      // Reuse an already-open tab for this file in whatever column it's
      // already in, rather than always forcing it into a fixed column
      // (which reads as a confusing jump / duplicate-feeling tab). Only
      // when it's not open anywhere do we open a new tab beside the
      // current one (matching how the graph panel itself opens).
      const existingGroup = vscode.window.tabGroups.all.find((group) =>
        group.tabs.some(
          (tab) =>
            tab.input instanceof vscode.TabInputText &&
            tab.input.uri.toString() === targetUri.toString()
        )
      );

      const editor = await vscode.window.showTextDocument(document, {
        viewColumn: existingGroup ? existingGroup.viewColumn : vscode.ViewColumn.Beside,
        preserveFocus: false,
      });
      const position = new vscode.Position(Math.max(location.line - 1, 0), 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      void vscode.window.showWarningMessage(
        `Could not open "${location.file}" for "${address}": ${detail}`
      );
    }
  }

  private renderHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'dist', 'webview.js'))
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.file(path.join(this.context.extensionPath, 'webview', 'dist', 'webview.css'))
    );
    const nonce = getNonce();
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Terraform Dependency Graph</title>
</head>
<body>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    if (TfGraphPanel.current === this) {
      TfGraphPanel.current = undefined;
    }
    this.disableLiveMode();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
