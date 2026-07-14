import * as assert from 'node:assert/strict';
import { resolveRootDirectoryFromInputs } from '../terraformRootResolution';
import type { RootResolutionInputs } from '../terraformRootResolution';

/** Builds a full RootResolutionInputs, defaulting every field to "absent". */
function inputs(overrides: Partial<RootResolutionInputs> = {}): RootResolutionInputs {
  return {
    activeTerraformFileDirectory: undefined,
    rememberedRoot: undefined,
    workspaceFolderPaths: undefined,
    pathExists: () => false,
    ...overrides,
  };
}

describe('resolveRootDirectoryFromInputs', () => {
  it('prefers the active .tf file directory over everything else', () => {
    const result = resolveRootDirectoryFromInputs(
      inputs({
        activeTerraformFileDirectory: '/active/dir',
        rememberedRoot: '/remembered/dir',
        workspaceFolderPaths: ['/workspace/dir'],
        pathExists: () => true,
      })
    );
    assert.equal(result, '/active/dir');
  });

  it('falls back to the remembered root when it still exists on disk', () => {
    const result = resolveRootDirectoryFromInputs(
      inputs({
        rememberedRoot: '/remembered/dir',
        workspaceFolderPaths: ['/workspace/dir'],
        pathExists: (candidate) => candidate === '/remembered/dir',
      })
    );
    assert.equal(result, '/remembered/dir');
  });

  it('skips the remembered root if it no longer exists on disk, falling through to a single workspace folder', () => {
    const result = resolveRootDirectoryFromInputs(
      inputs({
        rememberedRoot: '/deleted/dir',
        workspaceFolderPaths: ['/workspace/dir'],
        pathExists: () => false,
      })
    );
    assert.equal(result, '/workspace/dir');
  });

  it('uses the single open workspace folder when nothing else applies', () => {
    const result = resolveRootDirectoryFromInputs(
      inputs({
        workspaceFolderPaths: ['/workspace/dir'],
      })
    );
    assert.equal(result, '/workspace/dir');
  });

  it('returns undefined when there are multiple workspace folders and nothing else applies', () => {
    const result = resolveRootDirectoryFromInputs(
      inputs({
        workspaceFolderPaths: ['/workspace/a', '/workspace/b'],
      })
    );
    assert.equal(result, undefined);
  });

  it('returns undefined when there are no workspace folders at all and nothing else applies', () => {
    const result = resolveRootDirectoryFromInputs(inputs({ workspaceFolderPaths: [] }));
    assert.equal(result, undefined);
  });

  it('returns undefined when everything is absent', () => {
    const result = resolveRootDirectoryFromInputs(inputs());
    assert.equal(result, undefined);
  });
});
