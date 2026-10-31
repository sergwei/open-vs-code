// Pins the two copies of the integration baseline of `openVsCode.chatLocation` (#116).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('integration baseline of chatLocation', () => {
  /**
   * Protects `TEST_CHAT_LOCATION` of `.vscode-test.mjs` and `TEST_BASELINE_CHAT_LOCATION` of
   * `test/integration/support/chatLocation.ts` from drifting apart: the first is written into
   * every profile, the second is what the suites restore to, and a plain `.mjs` cannot import the
   * other. Provenance: reads both files as text (the `.mjs` runs `defineConfig` and writes
   * profiles on import, so it is not imported); no VS Code involved.
   */
  it('keeps .vscode-test.mjs and the integration helper on the same location', () => {
    const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
    const config = /const TEST_CHAT_LOCATION = '([^']+)'/.exec(read('../../.vscode-test.mjs'));
    const helper = /TEST_BASELINE_CHAT_LOCATION: ChatLocation = '([^']+)'/.exec(
      read('../../test/integration/support/chatLocation.ts'),
    );
    expect(config?.[1]).toBeDefined();
    expect(helper?.[1]).toBeDefined();
    expect(config?.[1]).toBe(helper?.[1]);
  });
});
