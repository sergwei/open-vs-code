// Tests for `serverStatus.ts` (issue #124): the text of the status bar item for every connection
// state and the model it shows. SYNTHETIC: fabricated states and catalogs. Codicons: `circle-outline`
// and `check` are VERIFIED rendered (captures 32a-not-started and 32b-started of `test:visual`,
// seen by the main thread on Windows 11, 31/10/2026: "○ OpenCode: not started", "✓ OpenCode: Big
// Pickle"); `loading~spin`, `circle-slash` and `error` stay HYPOTHESIS until a capture shows them.

import { describe, expect, it } from 'vitest';
import type { Catalog } from '../shared/model';
import type { ConnectionState } from '../shared/protocol';
import { describeServerStatus, statusModelLabel } from './serverStatus';

const model = (id: string, name: string) => ({
  providerID: 'opencode',
  id,
  name,
  status: 'active' as const,
  contextLimit: 1,
  free: true,
  variants: [],
  images: false,
});
const catalog = (extra: Partial<Catalog> = {}): Catalog => ({
  models: [model('a', 'Model A'), model('b', 'Model B')],
  providers: [],
  agents: [],
  ...extra,
});

describe('statusModelLabel', () => {
  it('prefers the preferred model, then the server default, by catalog name', () => {
    const both = catalog({
      preferredModel: { providerID: 'opencode', id: 'b' },
      serverDefault: { providerID: 'opencode', id: 'a' },
    });
    expect(statusModelLabel(both)).toBe('Model B');
    expect(statusModelLabel({ ...both, preferredModel: undefined })).toBe('Model A');
  });

  it('falls back to provider/id when the catalog does not list it, and to nothing without data', () => {
    expect(statusModelLabel(catalog({ serverDefault: { providerID: 'x', id: 'y' } }))).toBe('x/y');
    expect(statusModelLabel(catalog())).toBeUndefined();
    expect(statusModelLabel(undefined)).toBeUndefined();
  });

  it('removes "$(" so a server name cannot inject a codicon', () => {
    const evil = catalog({
      models: [model('a', 'Evil $(error) name')],
      serverDefault: { providerID: 'opencode', id: 'a' },
    });
    expect(describeServerStatus({ state: 'connected', serverVersion: '2.0.32' }, evil).text).toBe(
      '$(check) OpenCode: Evil error) name',
    );
  });
});

describe('describeServerStatus', () => {
  const withModel = catalog({ serverDefault: { providerID: 'opencode', id: 'a' } });

  it('connected shows the model, or just OpenCode without a catalog', () => {
    const connected: ConnectionState = { state: 'connected', serverVersion: '2.0.32' };
    const shown = describeServerStatus(connected, withModel);
    expect(shown.text).toBe('$(check) OpenCode: Model A');
    expect(shown.tooltip).toContain('Model: Model A');
    expect(shown.tooltip).toContain('opencode 2.0.32');
    expect(shown.tooltip).toContain('Click to open the chat.');
    expect(describeServerStatus(connected, undefined).text).toBe('$(check) OpenCode');
  });

  it.each([
    [{ state: 'starting' }, '$(loading~spin) OpenCode', false],
    [{ state: 'reconnecting', attempt: 1 }, '$(loading~spin) OpenCode', false],
    [{ state: 'not-started' }, '$(circle-outline) OpenCode: not started', false],
    [{ state: 'stopped' }, '$(circle-slash) OpenCode: stopped', false],
    [
      {
        state: 'unavailable',
        reason: 'start-failed',
        error: { code: 'start-failed', message: 'http://127.0.0.1:5555 secret' },
      },
      '$(error) OpenCode: unavailable',
      true,
    ],
  ] as Array<[ConnectionState, string, boolean]>)('%j -> "%s"', (connection, text, error) => {
    const shown = describeServerStatus(connection, withModel);
    expect(shown.text).toBe(text);
    expect(shown.error).toBe(error);
    expect(shown.ariaLabel).toContain('Click to open the chat.');
    // Neither a URL nor a raw error text ever reaches the tooltip.
    expect(shown.tooltip).not.toContain('127.0.0.1');
    expect(shown.tooltip).not.toContain('Model');
  });
});
