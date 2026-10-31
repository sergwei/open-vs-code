// Protects the `--affected` map of `test/visual` (tooling/test-speed, phase 2): that an area file
// selects its group, that anything cross-cutting or unmapped selects the full run (the
// conservative side of decision P2), and that Windows paths are read the same. The inputs are
// fabricated file lists, so this checks `affected.mjs`; that `run.mjs` prints and honours the
// choice was run by hand with `--list`.
import { describe, expect, it } from 'vitest';
import { AFFECTED_RULES, parseAffectedArg, selectForFiles } from './affected.mjs';
import { GROUPS } from './steps.mjs';

describe('selectForFiles', () => {
  it('maps an area file to its group and explains it', () => {
    const result = selectForFiles(['webview-ui/src/selectors/ModelPicker.tsx']);
    expect(result.mode).toBe('groups');
    expect(result.groups).toEqual(['selectors']);
    expect(result.reasons).toEqual(['webview-ui/src/selectors/ModelPicker.tsx -> selectors']);
  });

  it('unites the groups of several files, without repeating one', () => {
    const result = selectForFiles([
      'src/extension/chatTabs.ts',
      'src/extension/chatPanels.ts',
      'webview-ui/src/sessions/List.tsx',
    ]);
    expect(result).toMatchObject({ mode: 'groups', groups: ['tabs', 'sessions'] });
  });

  it.each([
    'src/shared/protocol.ts',
    'webview-ui/src/store/reducer.ts',
    'webview-ui/src/chat/Composer.tsx',
    'webview-ui/src/App.tsx',
    'src/extension/chatController.ts',
    'package.json',
    'src/extension/test-fixtures/fakeServer.ts',
    'test/visual/run.mjs',
  ])('sends the cross-cutting file %s to the full run', (file) => {
    const result = selectForFiles(['webview-ui/src/selectors/A.tsx', file]);
    expect(result.mode).toBe('full');
    expect(result.reasons).toContain(`${file}: cross-cutting`);
  });

  it('sends a file that no rule maps to the full run', () => {
    const result = selectForFiles(['scripts/unknown.mjs']);
    expect(result).toEqual({
      mode: 'full',
      groups: [],
      reasons: ['scripts/unknown.mjs: not mapped'],
    });
  });

  it('has no visual effect for tests, markdown, the integration suite and .claude', () => {
    const result = selectForFiles([
      'src/extension/chatController.test.ts',
      'webview-ui/src/chat/Composer.test.tsx',
      'README.md',
      'test/visual/README.md',
      'test/visual/steps.test.mjs',
      'test/visual/compare-runs.mjs',
      'test/visual/fingerprint.mjs',
      'test/integration/fakeServer.test.ts',
      'test/integration/support/extensionLog.ts',
      '.claude/CLAUDE.md',
    ]);
    expect(result).toEqual({ mode: 'none', groups: [], reasons: [] });
  });

  it('is none for an empty list', () => {
    expect(selectForFiles([]).mode).toBe('none');
  });

  it('reads Windows separators and a leading ./ like git paths', () => {
    expect(selectForFiles(['src\\shared\\a.ts']).mode).toBe('full');
    expect(selectForFiles(['.\\src\\extension\\chatTabs.ts'])).toMatchObject({
      mode: 'groups',
      groups: ['tabs'],
    });
  });

  it('a mapped test file next to an area file stays groups (the test is ignored)', () => {
    const result = selectForFiles(['src/extension/chatTabs.ts', 'src/extension/chatTabs.test.ts']);
    expect(result).toMatchObject({ mode: 'groups', groups: ['tabs'] });
  });
});

describe('AFFECTED_RULES', () => {
  it('only names groups that steps.mjs defines', () => {
    for (const rule of AFFECTED_RULES) {
      for (const group of rule.groups) expect(GROUPS.has(group)).toBe(true);
    }
  });
});

describe('parseAffectedArg', () => {
  it('is disabled without the flag', () => {
    expect(parseAffectedArg(['--bail'])).toEqual({ enabled: false });
  });

  it('takes an optional ref that is not another flag', () => {
    expect(parseAffectedArg(['--affected'])).toEqual({ enabled: true, ref: undefined });
    expect(parseAffectedArg(['--affected', '--bail'])).toEqual({ enabled: true, ref: undefined });
    expect(parseAffectedArg(['--affected', 'main'])).toEqual({ enabled: true, ref: 'main' });
    expect(parseAffectedArg(['--affected=HEAD~3'])).toEqual({ enabled: true, ref: 'HEAD~3' });
  });
});
