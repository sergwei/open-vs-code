// Vitest config. `.mts` because the root package.json is not `"type": "module"`.
//
// `test.projects` with two inline projects: `node` (host and shared code) and `webview` (jsdom +
// the Solid plugin, added by issue #14). Inline projects do NOT inherit from the root config in
// Vitest 5 as far as this file needs: each project spells out its own `plugins` and `test`
// options, which is why the root has no `test` options besides `projects`. VERIFIED by running
// `npm test` (Windows 11, 2026-10-20): both projects are discovered, and the webview store tests
// run under jsdom with the browser DEV build of solid-js (a failing test's stack trace showed
// `node_modules/solid-js/dist/dev.js`, not `server.js`). HYPOTHESIS: that the server build
// would make the reactivity test fail; it was reasoned, not run (to check, alias `solid-js` to
// its server build and run `npm test`). The old HYPOTHESIS that projects inherit the root config
// stays untested because nothing relies on it.
//
// Tests live next to the code (`*.test.ts(x)`) so they are already covered by tsconfig.json
// (`src/**/*.ts`) or webview-ui/tsconfig.json, hence by `check-types` and by the ESLint project
// service. The `vscode` module is NOT resolvable under Vitest (only `@types/vscode` exists), so
// the logic under test must not import it.
// HYPOTHESIS: the Vitest VS Code extension honours `vitest.rootConfig` and ignores the
// webview's vite.config; check in the editor.
import solid from 'vite-plugin-solid';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // `hot: false`: the HMR runtime (`@solid-refresh`) the plugin injects into every TSX
        // module cannot be loaded by Vitest ("filename must be a file URL ... 'file:///@solid-refresh'"),
        // seen on the first component test of phase 2 (plan-fase2). Tests do not need HMR.
        plugins: [solid({ hot: false })],
        test: {
          name: 'webview',
          include: ['webview-ui/src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          // Vitest blanks every CSS module by default (even `?raw`); `index.css.test.ts` reads the
          // stylesheet as text to check it has no literal colour, so only that import is let through.
          css: { include: [/index\.css\?raw/] },
        },
      },
    ],
  },
});
