import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

/**
 * Standalone Node entry point (NOT run through Mocha) - downloads/launches a
 * real VS Code Extension Development Host and runs the compiled integration
 * suite inside it. See src/test/suite/index.ts for the in-host suite loader.
 *
 * Must be run against compiled JS (out/test/runTest.js) - `@vscode/test-
 * electron` spawns a real `code` process whose extension host requires
 * `extensionTestsPath` as a plain Node module, so ts-node-in-process tricks
 * that work for the plain Mocha unit tests (see .mocharc.json) don't apply
 * here.
 */
async function main(): Promise<void> {
  try {
    // out/test/runTest.js -> out/test -> out -> project root.
    const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');

    // Directory containing the compiled suite's index.js.
    const extensionTestsPath = path.resolve(__dirname, 'suite');

    // Reuse the existing nested-module fixture (root + child/ with a
    // bidirectional module input/output reference chain) as the workspace
    // folder opened by the launched VS Code instance, so `tfGraphVisualizer.
    // open` can resolve its root via the "single open workspace folder"
    // fallback with no folder-picker dialog needed.
    const fixtureWorkspace = path.resolve(
      extensionDevelopmentPath,
      'tools',
      'tf-hcl-graph',
      'testdata',
      'nested_module'
    );

    // This project lives under a deeply-nested OneDrive sync path. VS Code's
    // default `--user-data-dir` (under `<project>/.vscode-test/user-data`)
    // makes its own IPC unix-domain-socket path too long for macOS's ~103-
    // char sockaddr_un limit ("EINVAL: invalid argument" on listen). Even
    // `os.tmpdir()` (under macOS's per-user `/var/folders/...` path) is too
    // long once VS Code appends its own `/<version>-main.sock` suffix -
    // a short, fixed path directly under `/tmp` is the only reliable fix.
    const userDataDir = '/tmp/tfgv-vscode-test-user-data';

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [fixtureWorkspace, '--disable-extensions', `--user-data-dir=${userDataDir}`],
    });
  } catch (err) {
    console.error('Failed to run @vscode/test-electron integration suite.');
    console.error(err);
    process.exit(1);
  }
}

void main();
