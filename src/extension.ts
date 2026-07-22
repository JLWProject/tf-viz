import * as vscode from 'vscode';
import { TfGraphPanel } from './panel/graphPanel';
import {
  getRememberedRootDirectory,
  pickRootDirectoryFolder,
  rememberRootDirectory,
  resolveRootDirectory,
} from './terraformRoot';

/**
 * Shows/reveals the graph panel against `rootDirectory`, remembering it for
 * next time only if the build actually succeeded.
 */
async function openAgainst(context: vscode.ExtensionContext, rootDirectory: string): Promise<void> {
  const succeeded = await TfGraphPanel.showOrReveal(context, rootDirectory);
  if (succeeded) {
    await rememberRootDirectory(context, rootDirectory);
  }
}

/** Folder-picker escape hatch, shared by `openForFolder` and the `open` fallback. */
async function openViaFolderPicker(context: vscode.ExtensionContext): Promise<void> {
  const picked = await pickRootDirectoryFolder();
  if (!picked) {
    return; // user cancelled - no error, no dead end
  }
  await openAgainst(context, picked);
}

async function runOpenCommand(context: vscode.ExtensionContext): Promise<void> {
  const root = await resolveRootDirectory(context);
  if (!root) {
    const choice = await vscode.window.showInformationMessage(
      'Could not automatically determine a Terraform root directory (no .tf file open, nothing remembered, and no single workspace folder). Pick one to visualize.',
      'Pick Folder'
    );
    if (choice === 'Pick Folder') {
      await openViaFolderPicker(context);
    }
    return;
  }

  await openAgainst(context, root);
}

async function runOpenForFolderCommand(context: vscode.ExtensionContext): Promise<void> {
  await openViaFolderPicker(context);
}

async function runRefreshCommand(context: vscode.ExtensionContext): Promise<void> {
  if (!TfGraphPanel.isOpen) {
    void vscode.window.showInformationMessage(
      'No Terraform dependency graph panel is open. Use "Terraform: Show Dependency Graph" first.'
    );
    return;
  }

  const root = getRememberedRootDirectory(context);
  if (!root) {
    void vscode.window.showWarningMessage(
      'No remembered Terraform root directory to refresh against.'
    );
    return;
  }

  await openAgainst(context, root);
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    TfGraphPanel.register(context),
    vscode.commands.registerCommand('tfGraphVisualizer.open', () => runOpenCommand(context)),
    vscode.commands.registerCommand('tfGraphVisualizer.openForFolder', () =>
      runOpenForFolderCommand(context)
    ),
    vscode.commands.registerCommand('tfGraphVisualizer.refresh', () => runRefreshCommand(context))
  );
}

export function deactivate(): void {
  // Intentionally empty - nothing async is pending that needs cancellation.
}
