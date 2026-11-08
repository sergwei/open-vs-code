// Protects the compact connected row of the Providers section (issue #186, phase 1.3): a stored
// credential offers "Disconnect" and sends exactly `settings.disconnect`; a connection through an
// environment variable says "Managed by VARIABLE" and has NO button (opencode cannot remove a
// variable); the model count is absent until the catalog was read; a busy host silences the button.
// Provenance: fabricated rows (settingsFixtures.ts) in jsdom; the look is `test:visual` step 35.
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderRow, SettingsWebviewToHost } from '../../../src/shared/settingsProtocol';
import { must, mount, type Mounted } from '../testing';
import { ConnectedProviderRow } from './ConnectedProviderRow';
import { anthropic, vertex } from './settingsFixtures';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

function setup(row: ProviderRow, busy = false) {
  const sent: SettingsWebviewToHost[] = [];
  mounted = mount(() => (
    <ul>
      <ConnectedProviderRow
        row={row}
        busy={busy}
        send={(message) => {
          sent.push(message);
        }}
      />
    </ul>
  ));
  return { container: mounted.container, sent };
}

describe('ConnectedProviderRow', () => {
  it('shows the monogram, the pill, the method and the model count, and sends Disconnect', () => {
    const { container, sent } = setup({ ...structuredClone(anthropic), modelCount: 3 });
    const row = must(container, 'li[data-provider="anthropic"]');
    expect(row.getAttribute('tabindex')).toBe('-1');
    expect(must(row, '.provider-monogram').textContent).toBe('A');
    expect(must(row, '.settings-pill').textContent).toBe('Connected');
    expect(row.textContent).toContain('API key · 3 models');
    const button = must<HTMLButtonElement>(row, 'button');
    expect(button.textContent).toBe('Disconnect');
    expect(button.getAttribute('aria-label')).toBe('Disconnect Anthropic (Anthropic)');
    expect(sent).toEqual([]);
    button.click();
    expect(sent).toEqual([
      { type: 'settings.disconnect', integrationID: 'anthropic', credentialID: 'cred_1' },
    ]);
  });

  it('says Managed by the variable and offers no button for an environment connection', () => {
    const { container, sent } = setup({ ...structuredClone(vertex), modelCount: 1 });
    const row = must(container, 'li[data-provider="google-vertex"]');
    expect(row.textContent).toContain('Managed by GOOGLE_APPLICATION_CREDENTIALS · 1 model');
    expect(row.querySelector('button')).toBeNull();
    expect(sent).toEqual([]);
  });

  it('leaves the count out while the catalog has not been read', () => {
    const { container } = setup(structuredClone(anthropic));
    const text = must(container, 'li[data-provider="anthropic"]').textContent;
    expect(text).toContain('API key');
    expect(text).not.toContain('model');
  });

  it('keeps Disconnect aria-disabled, and silent, while the host is busy', () => {
    const { container, sent } = setup(structuredClone(anthropic), true);
    const button = must<HTMLButtonElement>(container, 'button');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
    button.click();
    expect(sent).toEqual([]);
  });
});
