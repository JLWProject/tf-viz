import { execFile } from 'node:child_process';
import * as path from 'node:path';
import type { ParserOutput } from './graph/types';

// tools/tf-hcl-graph/build.sh cross-compiles one binary per vsce packaging
// target (see its TARGETS list) into bin/<platform>-<arch>/, matching
// Node's process.platform/process.arch naming exactly - `vsce package
// --target <target> --ignore-other-target-folders` recognizes those same
// names and strips the sibling folders for every other target from that
// build, so each published .vsix ends up with exactly one binary on disk.
const BINARY_NAME = process.platform === 'win32' ? 'tf-hcl-graph.exe' : 'tf-hcl-graph';
const TARGET_DIR = `${process.platform}-${process.arch}`;
const CLI_BINARY_PATH = path.join(
  __dirname,
  '..',
  'tools',
  'tf-hcl-graph',
  'bin',
  TARGET_DIR,
  BINARY_NAME
);

/**
 * Spawns the tf-hcl-graph Go binary against `directory` and parses its
 * stdout JSON into a typed ParserOutput. Uses `execFile` (never `exec`) so
 * `directory` is never subject to shell interpolation.
 */
export function runHclGraphCli(directory: string): Promise<ParserOutput> {
  return new Promise((resolve, reject) => {
    execFile(
      CLI_BINARY_PATH,
      [directory],
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `tf-hcl-graph failed (binary: ${CLI_BINARY_PATH}, directory: "${directory}"): ${error.message}` +
                (stderr ? `\n${stderr}` : '')
            )
          );
          return;
        }

        try {
          resolve(JSON.parse(stdout) as ParserOutput);
        } catch (parseErr) {
          reject(
            new Error(
              `tf-hcl-graph produced invalid JSON for directory "${directory}": ${
                (parseErr as Error).message
              }`
            )
          );
        }
      }
    );
  });
}
