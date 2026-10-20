import { join } from 'node:path';
import { build } from 'vite';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const configFile = join(import.meta.dirname, 'vite.config.mts');

/**
 * Prints one build error in the format the VS Code problem matcher expects.
 *
 * The format is the same contract as `esbuild.mjs` and the inline matcher of the
 * task `npm: watch:webview` in `.vscode/tasks.json`: an `[ERROR] <text>` line
 * followed by `    <file>:<line>:<column>:`. Only the first line of the message is
 * used because Vite's own watcher listener mutates `error.message`, appending ANSI
 * colors, the file path and a code frame (HYPOTHESIS: read in vite@8.3.4
 * `enhanceRollupError`, not executed). Output is ASCII only, as in `esbuild.mjs`.
 * An error without a location (for example an unresolved entry) falls back to
 * `configFile:1:1` so the two-line matcher still completes and the error reaches
 * Problems. The column gets `+1` like in `esbuild.mjs`: Rollup's `loc.column` is
 * 0-based by convention (HYPOTHESIS that rolldown does the same; an off-by-one
 * column is cosmetic). UNVERIFIED: that a syntax error in `App.tsx` reaches the
 * Problems panel with the right file and line (needs F5).
 */
function reportError(error) {
  const parts = Array.isArray(error?.errors) && error.errors.length > 0 ? error.errors : [error];
  for (const part of parts) {
    // First non-empty line: a message starting with a newline must not print an empty `[ERROR] `.
    const firstLine = String(part?.message ?? part)
      .split('\n')
      .find((line) => line.trim() !== '');
    console.log(`[ERROR] ${firstLine?.trim() ?? 'Unknown build error'}`);
    const file = part?.loc?.file ?? part?.id ?? configFile;
    const hasLocation = Boolean(part?.loc?.file ?? part?.id);
    const line = hasLocation ? (part?.loc?.line ?? 1) : 1;
    const column = hasLocation ? (part?.loc?.column ?? 0) + 1 : 1;
    console.log(`    ${file}:${line}:${column}:`);
  }
}

/**
 * Builds the webview bundle with Vite, optionally watching.
 *
 * Wrapper instead of a bare `vite build --watch` so that watch mode speaks the
 * same `[watch] build started` / `[watch] build finished` protocol as the host
 * build, and so that a build error in the first build is reported to Problems
 * instead of leaving F5 waiting forever on the preLaunchTask. `build finished`
 * is printed exactly once per cycle, on `BUNDLE_END` or on `ERROR`, and the
 * result is not closed here because Vite already does it. `--production` turns
 * sourcemaps off for the packaged bundle (used by `package:webview`).
 * Without `--watch` it exits with code 1 if the build throws.
 * HYPOTHESIS: the rolldown watcher event names (`BUNDLE_START`, `BUNDLE_END`,
 * `ERROR`) were read in rolldown@1.2.14 typings, not executed (same for `enhanceRollupError` above).
 * UNVERIFIED: no build has been run; the first one happens in F5.
 */
async function main() {
  /** @type {import('vite').InlineConfig} */
  const inline = {
    configFile,
    logLevel: 'silent',
    build: {
      sourcemap: !production,
      ...(watch ? { watch: {} } : {}),
    },
  };

  if (!watch) {
    try {
      await build(inline);
    } catch (error) {
      reportError(error);
      process.exit(1);
    }
    return;
  }

  const watcher = await build(inline);
  if (!watcher || typeof watcher.on !== 'function') {
    throw new Error('Vite did not return a watcher in watch mode');
  }
  watcher.on('event', (event) => {
    if (event.code === 'BUNDLE_START') {
      console.log('[watch] build started');
    } else if (event.code === 'BUNDLE_END') {
      console.log('[watch] build finished');
    } else if (event.code === 'ERROR') {
      reportError(event.error);
      console.log('[watch] build finished');
    }
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
