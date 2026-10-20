// Vitest config. `.mts` because the root package.json is not `"type": "module"`.
//
// `test.projects` from day one: it is the extension point for issue #2, which adds ONE more
// element (jsdom/happy-dom + the Solid plugin, `include: ['webview-ui/src/**/*.test.{ts,tsx}']`).
// HYPOTHESIS: in Vitest 5 inline projects inherit from the root config (read in
// vitest.dev/guide/migration, not exercised: there is a single project and the root config has
// no `test` options yet; check it when issue #2 adds the second project).
//
// Tests live next to the code (`*.test.ts`) so they are already covered by tsconfig.json
// (`src/**/*.ts`), hence by `check-types` and by the ESLint project service.
// The `vscode` module is NOT resolvable under Vitest (only `@types/vscode` exists), so the
// logic under test must not import it.
// HYPOTHESIS: the Vitest VS Code extension honours `vitest.rootConfig` and ignores the
// webview's vite.config; check in the editor.
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
    ],
  },
});
