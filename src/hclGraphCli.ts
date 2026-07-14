import { execFile } from 'node:child_process';
import * as path from 'node:path';
import type { ParserOutput } from './graph/types';

// TODO: this resolves a locally-built dev binary (`cd tools/tf-hcl-graph &&
// go build -o tf-hcl-graph .`), for use during development only. Packaging
// needs to bundle per-platform prebuilt binaries (e.g. under a `bin/<os>-
// <arch>/` layout picked by process.platform/process.arch) instead of
// relying on this path existing - not this phase's job, don't over-engineer
// it now.
const BINARY_NAME = process.platform === 'win32' ? 'tf-hcl-graph.exe' : 'tf-hcl-graph';
const CLI_BINARY_PATH = path.join(__dirname, '..', 'tools', 'tf-hcl-graph', BINARY_NAME);

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
