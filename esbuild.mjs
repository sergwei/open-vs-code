import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * esbuild plugin that prints build progress in the format the VS Code problem
 * matcher expects.
 *
 * The output format is a contract with the inline problem matcher in
 * `.vscode/tasks.json` (task `npm: watch:host`): `[watch] build started` and
 * `[watch] build finished` drive the background-task state that F5 waits on,
 * and errors must be a `[ERROR] <text>` line followed by a
 * `    <file>:<line>:<column>:` line, with a 1-based column (esbuild's
 * `Location.column` is 0-based per its `main.d.ts`, so it is shifted by one).
 * Output is ASCII only on purpose: non-ASCII glyphs can arrive garbled through
 * the Windows console and break the patterns. Everything goes to stdout, errors
 * included, so errors cannot be reordered after `build finished` by separate
 * stdout/stderr buffering (HYPOTHESIS that this happens on Windows TTYs; the
 * official generator template uses stderr for errors).
 * VERIFIED by the issue #1 review with a `node -` probe on Windows: the regexes in
 * tasks.json match these exact strings, including drive-letter paths.
 * VERIFIED with F5 on Windows 11 (2026-10-19): `build started` / `build finished`
 * drive the background task, so the preLaunchTask completes and the Extension
 * Development Host opens. UNVERIFIED: that a build error reaches the Problems
 * panel with the right file, line and column (needs a deliberate syntax error).
 *
 * @type {import('esbuild').Plugin}
 */
const problemMatcherPlugin = {
  name: 'problem-matcher',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        console.log(`[ERROR] ${text}`);
        if (location) {
          // esbuild columns are 0-based; VS Code problem matcher columns are 1-based.
          console.log(`    ${location.file}:${location.line}:${location.column + 1}:`);
        }
      }
      console.log('[watch] build finished');
    });
  },
};

/**
 * Bundles the extension host into `dist/extension.js` and the mod Worker bootstrap
 * (`src/mods/worker.ts`) into `dist/modWorker.js`, optionally watching.
 *
 * `vscode` is external (provided by the host at runtime). Format is cjs
 * because VS Code loads extensions with `require`; never add `"type": "module"`
 * to package.json or `dist/extension.js` stops loading. Target `node22` matches
 * the Node bundled with VS Code 1.105 (Electron 37), per the issue #1 plan
 * (read from microsoft/vscode release/1.105 `.npmrc`, not executed here).
 * VERIFIED in watch mode: the F5 preLaunchTask on Windows 11 (2026-10-19)
 * produced a `dist/extension.js` that VS Code loaded and activated.
 * VERIFIED (02/11/2026, Windows 11): the one-shot `ctx.rebuild()` path, because `build:host` inside
 * `npm run test:integration` left both `dist/extension.js` and `dist/modWorker.js` and the mods
 * suite started a Worker from the latter. UNVERIFIED: `--production`.
 */
async function main() {
  // Same options for both bundles; only the entry and the output differ.
  const common = {
    bundle: true,
    format: 'cjs',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
    plugins: [problemMatcherPlugin],
  };
  const ctx = await esbuild.context({
    ...common,
    entryPoints: ['src/extension/extension.ts'],
    outfile: 'dist/extension.js',
    external: ['vscode'],
  });
  // E10-mods: the bootstrap each mod's Worker runs. A separate file because `new Worker(file)`
  // needs a path; it imports no `vscode` (ESLint forbids it) and has nothing external. The
  // `[watch] build started/finished` lines print once per context, which the F5 problem matcher
  // tolerates (it only waits for the last `finished` of the background task: HYPOTHESIS, check
  // in the next F5 that the preLaunchTask still completes).
  const workerCtx = await esbuild.context({
    ...common,
    entryPoints: ['src/mods/worker.ts'],
    outfile: 'dist/modWorker.js',
  });
  if (watch) {
    await Promise.all([ctx.watch(), workerCtx.watch()]);
  } else {
    await Promise.all([ctx.rebuild(), workerCtx.rebuild()]);
    await Promise.all([ctx.dispose(), workerCtx.dispose()]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
