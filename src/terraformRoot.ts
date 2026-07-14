import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { resolveRootDirectoryFromInputs } from './terraformRootResolution';

export type { RootResolutionInputs } from './terraformRootResolution';
export { resolveRootDirectoryFromInputs } from './terraformRootResolution';

/** workspaceState key the last successfully-graphed root directory is stored under. */
export const LAST_ROOT_STATE_KEY = 'tfGraphVisualizer.lastRoot';

/**
 * workspaceState key prefix for a root directory's saved manual node-drag
 * positions (see graphPanel.ts) - one key per distinct root directory (not a
 * single shared key like LAST_ROOT_STATE_KEY above), so different Terraform
 * directories opened in the same workspace get independent saved layouts and
 * switching directories never leaks one directory's dragged positions onto
 * another's graph.
 */
const POSITIONS_STATE_KEY_PREFIX = 'tfGraphVisualizer.positions.';

/** Builds the collision-safe per-root-directory workspaceState key saved node positions are stored under. */
export function positionsStateKey(rootDirectory: string): string {
  return `${POSITIONS_STATE_KEY_PREFIX}${rootDirectory}`;
}

/**
 * Real-`vscode` entry point: gathers the current active editor / remembered
 * state / workspace folders and defers to the pure precedence logic in
 * terraformRootResolution.ts.
 */
export async function resolveRootDirectory(
  context: vscode.ExtensionContext
): Promise<string | undefined> {
  const activeDocument = vscode.window.activeTextEditor?.document;
  const activeTerraformFileDirectory =
    activeDocument &&
    activeDocument.uri.scheme === 'file' &&
    activeDocument.fileName.toLowerCase().endsWith('.tf')
      ? path.dirname(activeDocument.uri.fsPath)
      : undefined;

  const rememberedRoot = getRememberedRootDirectory(context);
  const workspaceFolderPaths = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath);

  return resolveRootDirectoryFromInputs({
    activeTerraformFileDirectory,
    rememberedRoot,
    workspaceFolderPaths,
    pathExists: (candidate) => fs.existsSync(candidate),
  });
}

/** Reads the last remembered root directory, without any existence check. */
export function getRememberedRootDirectory(context: vscode.ExtensionContext): string | undefined {
  return context.workspaceState.get<string>(LAST_ROOT_STATE_KEY);
}

/** Persists `directory` as the last-known-good root for this workspace. */
export async function rememberRootDirectory(
  context: vscode.ExtensionContext,
  directory: string
): Promise<void> {
  await context.workspaceState.update(LAST_ROOT_STATE_KEY, directory);
}

/**
 * Opens a native folder picker for the user to explicitly override the
 * auto-resolved root directory. Returns `undefined` if the user cancels.
 */
export async function pickRootDirectoryFolder(): Promise<string | undefined> {
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: 'Select Terraform Root',
  });

  return picked && picked.length > 0 ? picked[0].fsPath : undefined;
}
