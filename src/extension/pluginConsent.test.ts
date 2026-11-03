// Tests of the consent policy of issue #153. SYNTHETIC: fabricated findings and an in-memory
// memento; they pin the decision matrix and the sanitizing, not what VS Code shows.

import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  confirmDetail,
  createDecisionStore,
  decideLaunch,
  noticeMessage,
  type DecisionMemento,
  type LaunchAction,
  type StoredDecision,
} from './pluginConsent';
import { pluginFingerprint, type PluginFinding } from './projectPlugins';

const folder = path.resolve(os.tmpdir(), 'repo');
const file = (name: string, inside = true): PluginFinding => ({
  kind: 'file',
  path: path.join(folder, '.opencode', 'plugins', name),
  inside,
});
const one = [file('a.js')];
const fp = pluginFingerprint(one);
const stored = (decision: 'allow' | 'deny', fingerprint = fp): StoredDecision => ({
  decision,
  fingerprint,
  at: 1,
});

describe('decideLaunch', () => {
  const rows: Array<[string, PluginFinding[], StoredDecision | undefined, boolean, LaunchAction]> =
    [
      ['no findings', [], undefined, false, 'go'],
      ['allow with the same fingerprint', one, stored('allow'), false, 'go'],
      [
        'allow with another fingerprint, extension acting',
        one,
        stored('allow', 'old'),
        false,
        'notify',
      ],
      ['deny with the same fingerprint, extension acting', one, stored('deny'), false, 'hold'],
      [
        'deny with another fingerprint, extension acting',
        one,
        stored('deny', 'old'),
        false,
        'notify',
      ],
      ['nothing stored, extension acting', one, undefined, false, 'notify'],
      ['nothing stored, user asked', one, undefined, true, 'confirm'],
      ['deny with the same fingerprint, user asked', one, stored('deny'), true, 'confirm'],
      ['allow with another fingerprint, user asked', one, stored('allow', 'old'), true, 'confirm'],
      ['allow with the same fingerprint, user asked', one, stored('allow'), true, 'go'],
      ['no findings, user asked', [], undefined, true, 'go'],
    ];
  it.each(rows)('%s -> %s', (_name, findings, storedDecision, userAsked, expected) => {
    expect(decideLaunch({ findings, stored: storedDecision, fingerprint: fp, userAsked })).toBe(
      expected,
    );
  });
});

describe('the decision store', () => {
  function memory(initial?: unknown) {
    const data = new Map<string, unknown>();
    if (initial !== undefined) data.set('k', initial);
    const memento: DecisionMemento = {
      get: (key) => data.get(key),
      update: (key, value) => {
        data.set(key, value);
        return Promise.resolve();
      },
    };
    return { memento, data };
  }

  it('reads back what it recorded, under a normalized key', async () => {
    const { memento } = memory();
    const store = createDecisionStore(memento, 'k', { now: () => 7, platform: 'win32' });
    await store.record(folder, 'allow', fp);
    expect(store.read(folder.toUpperCase())).toEqual({ decision: 'allow', fingerprint: fp, at: 7 });
    expect(store.read(path.join(folder, 'other'))).toBeUndefined();
  });

  it('keeps the entries of other folders when it records or forgets one', async () => {
    const { memento } = memory();
    const store = createDecisionStore(memento, 'k', { platform: 'linux' });
    await store.record('/a', 'allow', 'x');
    await store.record('/b', 'deny', 'y');
    await expect(store.forget('/a')).resolves.toBe(true);
    expect(store.read('/a')).toBeUndefined();
    expect(store.read('/b')?.decision).toBe('deny');
  });

  it('forgetting a folder with no entry does not break and reports false', async () => {
    const { memento } = memory();
    await expect(createDecisionStore(memento, 'k').forget('/nope')).resolves.toBe(false);
  });

  it('treats a corrupt value or entry as no decision', () => {
    const key = path.resolve('/a');
    expect(createDecisionStore(memory('junk').memento, 'k').read('/a')).toBeUndefined();
    const entry = memory({ [key]: { decision: 'maybe', fingerprint: 1 } });
    expect(
      createDecisionStore(entry.memento, 'k', { platform: 'linux' }).read('/a'),
    ).toBeUndefined();
  });
});

describe('the texts', () => {
  it('removes brackets and parentheses from names that come from the repository', () => {
    const evil: PluginFinding = file('[x](command:evil).js');
    const declared: PluginFinding = {
      kind: 'declared',
      spec: '[y](command:evil2)',
      config: path.join(folder, 'opencode.json'),
      inside: true,
    };
    for (const text of [
      noticeMessage([evil, declared], folder),
      confirmDetail([evil, declared], folder),
    ]) {
      expect(text).not.toMatch(/[[\]()]/);
      expect(text).toContain('xcommand:evil.js');
    }
  });

  it('lists five and says "and 2 more" for seven', () => {
    const seven = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => file(`${n}.js`));
    expect(noticeMessage(seven, folder)).toContain(', and 2 more.');
    expect(noticeMessage(seven, folder)).not.toContain('f.js');
    const lines = confirmDetail(seven, folder).split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe('and 2 more');
  });

  it('shows the folder-relative path inside and the absolute path from an ancestor', () => {
    const inside = file('a.js');
    const outside = file('b.js', false);
    const detail = confirmDetail([inside, outside], folder);
    expect(detail).toContain(path.join('.opencode', 'plugins', 'a.js'));
    expect(detail).not.toContain(path.join(folder, '.opencode', 'plugins', 'a.js'));
    expect(detail).toContain(path.join(folder, '.opencode', 'plugins', 'b.js'));
  });

  it('starts the notice with the stable sentence', () => {
    expect(noticeMessage(one, folder)).toMatch(
      /^This folder has opencode plugins that will run with your permissions: /,
    );
  });
});
