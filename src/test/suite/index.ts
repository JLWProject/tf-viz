import * as path from 'node:path';
import Mocha from 'mocha';
import { glob } from 'glob';

/**
 * In-VS-Code-instance suite loader. `@vscode/test-electron` requires this
 * module (via `extensionTestsPath`) and calls `run()` from inside the real
 * Extension Development Host process - full `vscode` API access, unlike the
 * plain Mocha+Node unit tests in src/test/*.test.ts.
 *
 * Reports pass/fail back to the runTest.ts host process by resolving (all
 * green) or rejecting (any red) the returned promise - `runTests()` turns a
 * rejection into a non-zero process exit code.
 */
export async function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'bdd',
    color: true,
    // Spawning the Go CLI + loading the webview inside a real Extension
    // Development Host can genuinely take a while on a cold run - generous
    // timeout so that's not a source of flakiness.
    timeout: 60_000,
  });

  const testsRoot = path.resolve(__dirname);
  const files = await glob('**/*.test.js', { cwd: testsRoot });

  for (const file of files) {
    mocha.addFile(path.resolve(testsRoot, file));
  }

  return new Promise((resolve, reject) => {
    try {
      mocha.run((failures) => {
        if (failures > 0) {
          reject(new Error(`${failures} integration test(s) failed.`));
        } else {
          resolve();
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}
