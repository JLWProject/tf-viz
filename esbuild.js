// Two build targets:
//   1. The extension-host entry point (src/extension.ts) -> dist/extension.js,
//      running in the Node-context VS Code extension host.
//   2. The webview entry point (webview/src/main.ts) -> webview/dist/webview.js
//      (+ webview/dist/webview.css), running in the sandboxed browser-context
//      webview - no Node/vscode APIs available there, only DOM/browser APIs
//      plus whatever gets bundled in (e.g. @dagrejs/dagre).
//
// webview/dist/webview.css: main.ts does `import './theme.css'` at its entry
// point, and esbuild's built-in CSS loader bundles any CSS transitively
// imported from a JS/TS entry into a sibling output file automatically (no
// extra plugin/config needed) - simpler than a manual copy step, and it
// means adding more .css files later "just works" without touching this
// file again.
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const extensionBuildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: true,
  // "vscode" is provided by the extension host at runtime, never bundle it.
  external: ['vscode'],
  logLevel: 'info',
};

/** @type {import('esbuild').BuildOptions} */
const webviewBuildOptions = {
  entryPoints: { webview: 'webview/src/main.ts' },
  bundle: true,
  outdir: 'webview/dist',
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
};

async function main() {
  if (watch) {
    const [extensionCtx, webviewCtx] = await Promise.all([
      esbuild.context(extensionBuildOptions),
      esbuild.context(webviewBuildOptions),
    ]);
    await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
    console.log('esbuild: watching for changes...');
  } else {
    await Promise.all([esbuild.build(extensionBuildOptions), esbuild.build(webviewBuildOptions)]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
