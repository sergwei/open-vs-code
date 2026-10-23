// Vitest config of the OPT-IN event-shape check: `npm run test:event-shapes`
// (tooling/tests-without-model). It runs `src/**/*.contract.ts`, which `vitest.config.mts` does not
// include (its `node` project takes `src/**/*.test.ts`), so `npm test` never starts it.
//
// Pure Node, no VS Code: the check starts a real `opencode serve --stdio` and the synthetic one with
// `startServer`, plays one turn against each and compares the shapes of their events. Without
// `OPEN_VS_CODE_REAL_OPENCODE` (and a model that answers, calling the `read` tool) it SKIPS with a
// banner; it is never green without having compared the whole turn, and it fails when the real
// turn brings no automatic `session.renamed`. The timeouts are ours: a real turn is given 120 s inside the test, and
// starting a server takes seconds, so the test as a whole gets 5 minutes.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'event-shapes',
    include: ['src/**/*.contract.ts'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 60_000,
  },
});
