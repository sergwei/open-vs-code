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

  it('maps the status bar text of the server (issue #124) to the setup group', () => {
    expect(selectForFiles(['src/extension/serverStatus.ts'])).toMatchObject({
      mode: 'groups',
      groups: ['setup'],
    });
  });

  // E3-work-mode: the pure Auto decision and the destructive-command classifier select the
  // `requests` group (step 44); the controller that wires them stays cross-cutting. FABRICATED lists.
  it('maps the work mode modules to the requests group', () => {
    for (const file of ['src/extension/workMode.ts', 'src/extension/destructiveCommand.ts']) {
      expect(selectForFiles([file]), file).toMatchObject({ mode: 'groups', groups: ['requests'] });
    }
    expect(selectForFiles(['src/extension/workMode.test.ts']).mode).toBe('none');
  });

  // E10-config-views: the Settings tab has its own group (steps 35 and 36); the shared protocol file
  // stays cross-cutting through `src/shared/`.
  it('maps the Settings tab files to the config group and its shared protocol to a full run', () => {
    expect(selectForFiles(['webview-ui/src/settings/ProviderCard.tsx'])).toMatchObject({
      mode: 'groups',
      groups: ['config'],
    });
    expect(selectForFiles(['src/extension/providerAuthUi.ts'])).toMatchObject({
      mode: 'groups',
      groups: ['config'],
    });
    expect(selectForFiles(['src/shared/settingsProtocol.ts']).mode).toBe('full');
  });

  // E10-mods: the mods code has its own group (step 38). The fixture mods live under
  // `test-fixtures/`, which stays cross-cutting, and the shared protocol file too.
  it('maps the mods files to the mods group, and their fixtures and protocol to a full run', () => {
    for (const file of [
      'src/mods/worker.ts',
      'src/extension/modHost.ts',
      'src/extension/modsLifecycle.ts',
      'src/extension/modsLoader.ts',
      'src/extension/modPanelPolicy.ts',
      'src/extension/modsChat.ts',
      'src/extension/modToggles.ts',
      'webview-ui/src/mods/ModBand.tsx',
      'webview-ui/src/mods/ModsMenu.tsx',
    ]) {
      expect(selectForFiles([file]), file).toMatchObject({ mode: 'groups', groups: ['mods'] });
    }
    expect(selectForFiles(['src/extension/test-fixtures/mods/hello-station/index.mjs']).mode).toBe(
      'full',
    );
    expect(selectForFiles(['src/extension/modsChat.test.ts']).mode).toBe('none');
  });

  // E11-i18n: no step runs in another language, so the language catalogs have no visual effect; the
  // base manifest catalog stays cross-cutting. FABRICATED file lists: this checks `affected.mjs` only.
  it('gives the language catalogs no visual effect, but not the base manifest catalog', () => {
    for (const file of [
      'package.nls.es.json',
      'package.nls.pt-br.json',
      'l10n/bundle.l10n.es.json',
      'l10n/bundle.l10n.json',
    ]) {
      expect(selectForFiles([file]), file).toMatchObject({ mode: 'none' });
    }
    expect(selectForFiles(['package.nls.json']).mode).toBe('full');
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
    // E11-i18n: the base manifest catalog and the two boots.
    'package.nls.json',
    'src/extension/l10nBoot.ts',
    'webview-ui/src/l10nBoot.ts',
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
      steps: [],
      reasons: ['scripts/unknown.mjs: not mapped'],
    });
  });

  // Protects tooling/visual-ci-parallel (issue #199): without `harness`, run.mjs and steps.mjs stay
  // cross-cutting (what `fingerprint.mjs` `checkRun` relies on); with it they are judged per step.
  // The harness results are FABRICATED here; the real ones come from `harnessDiff.mjs`.
  it('judges run.mjs and steps.mjs by the harness diff when it is given', () => {
    const files = ['test/visual/run.mjs', 'test/visual/steps.mjs', 'README.md'];
    expect(selectForFiles(files).mode).toBe('full');
    const harness = {
      'test/visual/run.mjs': { mode: 'steps', steps: ['51'], reason: 'step bodies changed' },
      'test/visual/steps.mjs': { mode: 'steps', steps: ['51', '52'], reason: 'x' },
    };
    expect(selectForFiles(files, harness)).toEqual({
      mode: 'groups',
      groups: [],
      steps: ['51', '52'],
      reasons: ['test/visual/run.mjs -> steps 51', 'test/visual/steps.mjs -> steps 51, 52'],
    });
  });

  // Protects the decision of Sergio on tooling/visual-ci-parallel (Engram
  // `tooling/visual-ci-parallel/decisions/review-w1-w2`): a step chosen by its body drags the NEXT
  // one in canonical order (state leaks forward: the end of steps 49/50 broke 50/51). The order and
  // the diffs are FABRICATED; the real ids come from `STEP_IDS` (see harnessDiff.test.mjs).
  it('adds the next step in canonical order to a step chosen by its body or entry', () => {
    const order = ['1', '6', '6b', '7', '8'];
    const pick = (steps) => ({ 'test/visual/run.mjs': { mode: 'steps', steps, reason: 'x' } });
    expect(selectForFiles(['test/visual/run.mjs'], pick(['6']), order)).toEqual({
      mode: 'groups',
      groups: [],
      steps: ['6', '6b'],
      reasons: ['test/visual/run.mjs -> steps 6 (+ next 6b)'],
    });
    // Two adjacent changed steps: the next of the first is already chosen, so only 8 is added.
    expect(selectForFiles(['test/visual/run.mjs'], pick(['6b', '7']), order).steps).toEqual([
      '6b',
      '7',
      '8',
    ]);
    // The last step has no next.
    expect(selectForFiles(['test/visual/run.mjs'], pick(['8']), order)).toMatchObject({
      steps: ['8'],
      reasons: ['test/visual/run.mjs -> steps 8'],
    });
  });

  it('is full when a step id chosen by the harness diff is not in the canonical order', () => {
    const harness = { 'test/visual/run.mjs': { mode: 'steps', steps: ['99'], reason: 'x' } };
    expect(selectForFiles(['test/visual/run.mjs'], harness, ['1', '2'])).toEqual({
      mode: 'full',
      groups: [],
      steps: [],
      reasons: ['test/visual/run.mjs: cross-cutting (step 99 is not a known step id)'],
    });
  });

  it('unites groups and steps, selects nothing for a none diff and is full for a full diff', () => {
    const none = { 'test/visual/run.mjs': { mode: 'none', steps: [], reason: 'comments' } };
    expect(selectForFiles(['test/visual/run.mjs'], none).mode).toBe('none');
    const steps = { 'test/visual/run.mjs': { mode: 'steps', steps: ['51'], reason: 'x' } };
    expect(
      selectForFiles(['webview-ui/src/selectors/A.tsx', 'test/visual/run.mjs'], steps),
    ).toMatchObject({ mode: 'groups', groups: ['selectors'], steps: ['51'] });
    const full = { 'test/visual/run.mjs': { mode: 'full', steps: [], reason: 'helper changed' } };
    expect(selectForFiles(['test/visual/run.mjs'], full)).toMatchObject({
      mode: 'full',
      reasons: ['test/visual/run.mjs: cross-cutting (helper changed)'],
    });
  });

  it('has no effect for the selector itself, the shard merger and the workflows', () => {
    const result = selectForFiles([
      'test/visual/affected.mjs',
      'test/visual/harnessDiff.mjs',
      'test/visual/merge-shards.mjs',
      '.github/workflows/visual.yml',
    ]);
    expect(result.mode).toBe('none');
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
      'scripts/l10n.mjs',
      'test/integration/fakeServer.test.ts',
      'test/integration/support/extensionLog.ts',
      '.claude/CLAUDE.md',
    ]);
    expect(result).toEqual({ mode: 'none', groups: [], steps: [], reasons: [] });
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
