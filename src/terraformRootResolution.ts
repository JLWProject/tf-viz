// Deliberately free of any `import ... from 'vscode'` - the real `vscode`
// module only resolves inside an actual extension host process, so this
// file exists purely so the root-directory precedence logic can be
// unit-tested with plain Mocha+Node (see src/test/terraformRoot.test.ts).
// The `vscode`-touching wrapper lives in terraformRoot.ts instead.

/**
 * The pure decision inputs behind `resolveRootDirectory` in terraformRoot.ts.
 */
export interface RootResolutionInputs {
  /** Containing directory of the active editor's file, iff it's a `.tf` file on disk. */
  activeTerraformFileDirectory: string | undefined;
  /** Directory remembered from a previous successful run, if any. */
  rememberedRoot: string | undefined;
  /** fsPaths of every open workspace folder (undefined/empty if none). */
  workspaceFolderPaths: readonly string[] | undefined;
  /** Existence check, injected so tests don't need to touch the real filesystem. */
  pathExists: (candidate: string) => boolean;
}

/**
 * Precedence, per the plan:
 *   1. active `.tf` file's directory
 *   2. remembered root from workspaceState, only if it still exists on disk
 *   3. the single open workspace folder, if there is exactly one
 *   4. undefined - caller should prompt the user instead of failing silently
 */
export function resolveRootDirectoryFromInputs(inputs: RootResolutionInputs): string | undefined {
  if (inputs.activeTerraformFileDirectory) {
    return inputs.activeTerraformFileDirectory;
  }

  if (inputs.rememberedRoot && inputs.pathExists(inputs.rememberedRoot)) {
    return inputs.rememberedRoot;
  }

  if (inputs.workspaceFolderPaths && inputs.workspaceFolderPaths.length === 1) {
    return inputs.workspaceFolderPaths[0];
  }

  return undefined;
}
