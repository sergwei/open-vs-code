// Protects the provider card of the OpenCode Settings tab: the three faces (connected, signing in,
// not connected), the primary button by method type, the `when` of the forms, the focus rules
// (card on expand, never a button that connects; aria-disabled, not disabled), and above all that
// NO input of type password exists anywhere (architecture rule 1: the API key is asked by the
// host in a native InputBox). Provenance: fabricated rows (settingsFixtures.ts), jsdom; the look
// in a real VS Code is judged by `test:visual` step 36 (cells V6-V9); a screen reader is UNVERIFIED.
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AuthAttemptView,
  ProviderRow,
  SettingsWebviewToHost,
} from '../../../src/shared/settingsProtocol';
import { must, mount, type Mounted } from '../testing';
import { ProviderCard } from './ProviderCard';
import { anthropic, azure, bedrock, copilot, openai, vertex } from './settingsFixtures';
import { createSettingsUi } from './settingsUiState';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

function setup(
  row: ProviderRow,
  options: { attempt?: AuthAttemptView; open?: boolean; draft?: Record<string, string> } = {},
) {
  const sent: SettingsWebviewToHost[] = [];
  const ui = createSettingsUi({ getState: () => undefined, setState: () => undefined });
  if (options.open === true) ui.setExpanded(row.id);
  for (const [key, value] of Object.entries(options.draft ?? {})) ui.setDraft(row.id, key, value);
  const [attempt, setAttempt] = createSignal<AuthAttemptView | undefined>(options.attempt);
  const [busy, setBusy] = createSignal(options.attempt !== undefined);
  mounted = mount(() => (
    <ul>
      <ProviderCard
        row={row}
        attempt={attempt()}
        busy={busy()}
        ui={ui}
        send={(message) => {
          sent.push(message);
        }}
      />
    </ul>
  ));
  return { container: mounted.container, sent, ui, setAttempt, setBusy };
}

/** Types into an input the way the user does: set the value and fire `input`. */
function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function buttons(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('button')).map((b) => b.textContent.trim());
}

describe('not connected', () => {
  it('is collapsed with the way to connect as its description', () => {
    const { container } = setup(azure);
    expect(must(container, 'button.settings-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).toContain('Azure');
    expect(container.textContent).toContain('API key');
    expect(container.querySelector('input')).toBeNull();
  });

  it('opens on the toggle and gives the focus to the card, not to a button that connects', () => {
    const { container } = setup(azure);
    must(container, 'button.settings-toggle').click();
    const card = must(container, 'li.settings-card');
    expect(card.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(card);
    expect(must(container, 'button.primary').textContent).toBe('Enter API key…');
  });

  it('does not take the focus when it is restored open from the saved state', () => {
    setup(azure, { open: true });
    expect(document.activeElement).toBe(document.body);
  });

  it('gives the focus back to the toggle when Cancel closes it, and forgets the draft', () => {
    const { container, ui } = setup(azure);
    must(container, 'button.settings-toggle').click();
    type(must<HTMLInputElement>(container, 'input'), 'r1');
    expect(ui.draft('azure')).toEqual({ '0:resourceName': 'r1' });
    const cancel = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Cancel',
    );
    cancel?.click();
    expect(container.querySelector('input')).toBeNull();
    expect(document.activeElement).toBe(must(container, 'button.settings-toggle'));
    expect(ui.draft('azure')).toEqual({});
  });

  it('blocks the primary button with aria-disabled until the required field is filled, then sends the answer', () => {
    const { container, sent } = setup(azure, { open: true });
    const primary = must(container, 'button.primary');
    expect(primary.getAttribute('aria-disabled')).toBe('true');
    expect(primary.hasAttribute('disabled')).toBe(false);
    expect(container.textContent).toContain('Fill in Resource name to continue.');
    primary.click();
    expect(sent).toEqual([]);

    type(must<HTMLInputElement>(container, 'input'), 'my-resource');
    expect(must(container, 'button.primary').hasAttribute('aria-disabled')).toBe(false);
    must(container, 'button.primary').click();
    expect(sent).toEqual([
      {
        type: 'settings.connect',
        integrationID: 'azure',
        method: 0,
        answer: { resourceName: 'my-resource' },
      },
    ]);
  });

  it('restores the typed value of the form from the saved draft', () => {
    const { container } = setup(azure, { open: true, draft: { '0:resourceName': 'kept' } });
    expect(must<HTMLInputElement>(container, 'input').value).toBe('kept');
    expect(must(container, 'button.primary').hasAttribute('aria-disabled')).toBe(false);
  });
});

describe('forms with options and when', () => {
  it('shows a select, hides the dependent field until Enterprise is chosen, and sends only visible answers', () => {
    const { container, sent } = setup(copilot, { open: true });
    const select = must<HTMLSelectElement>(container, 'select');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'GitHub.com',
      'GitHub Enterprise',
    ]);
    expect(select.value).toBe('github.com');
    expect(container.querySelector('[data-field="enterpriseUrl"]')).toBeNull();
    expect(must(container, 'button.primary').textContent).toBe('Sign in…');

    select.value = 'enterprise';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const url = must<HTMLInputElement>(container, '[data-field="enterpriseUrl"] input');
    expect(must(container, 'button.primary').getAttribute('aria-disabled')).toBe('true');
    type(url, 'https://ghe.example');
    must(container, 'button.primary').click();
    expect(sent.at(-1)).toEqual({
      type: 'settings.connect',
      integrationID: 'github-copilot',
      method: 0,
      answer: { deploymentType: 'enterprise', enterpriseUrl: 'https://ghe.example' },
    });

    select.value = 'github.com';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(container.querySelector('[data-field="enterpriseUrl"]')).toBeNull();
    must(container, 'button.primary').click();
    expect(sent.at(-1)).toMatchObject({ answer: { deploymentType: 'github.com' } });
  });
});

describe('the primary button by method type', () => {
  it('says Connect for an external method and sends an empty answer', () => {
    const { container, sent } = setup(bedrock, { open: true });
    must(container, 'button.primary').click();
    expect(must(container, 'button.primary').textContent).toBe('Connect');
    expect(sent).toEqual([
      { type: 'settings.connect', integrationID: 'amazon-bedrock', method: 0, answer: {} },
    ]);
  });

  it('lists each method with its own button when there are several, and says how many', () => {
    const { container, sent } = setup(openai);
    expect(container.textContent).toContain('3 ways to connect');
    must(container, 'button.settings-toggle').click();
    expect(
      Array.from(container.querySelectorAll('button.primary')).map((b) => b.textContent),
    ).toEqual(['Enter API key…', 'Sign in…', 'Sign in…']);
    container.querySelectorAll<HTMLButtonElement>('button.primary')[2]?.click();
    expect(sent).toEqual([
      { type: 'settings.connect', integrationID: 'openai', method: 2, answer: {} },
    ]);
  });

  it('says to use the CLI for a method it cannot render, with no button', () => {
    const row: ProviderRow = {
      ...azure,
      methods: [{ index: 0, type: 'key', label: 'API key', fields: [], supported: false }],
    };
    const { container } = setup(row, { open: true });
    expect(container.textContent).toContain('opencode auth login');
    expect(container.querySelector('button.primary')).toBeNull();
  });

  it('says there is no method for a provider without any', () => {
    const { container } = setup({ ...azure, methods: [] }, { open: true });
    expect(container.textContent).toContain('No sign-in method');
  });
});

describe('signing in', () => {
  it('shows the instructions, the code once, Copy code and Cancel in the waiting phase', () => {
    const { container, sent } = setup(copilot, {
      attempt: {
        integrationID: 'github-copilot',
        phase: 'waiting',
        instructions: 'Enter code: ABCD-1234',
        code: 'ABCD-1234',
      },
    });
    expect(container.textContent).toContain('Enter code: ABCD-1234');
    expect(container.querySelector('.settings-code')).toBeNull();
    expect(container.querySelector('.spinner')).not.toBeNull();
    expect(buttons(container)).toEqual(['Copy code', 'Cancel']);
    Array.from(container.querySelectorAll('button'))[0]?.click();
    Array.from(container.querySelectorAll('button'))[1]?.click();
    expect(sent).toEqual([
      { type: 'settings.copyCode', integrationID: 'github-copilot' },
      { type: 'settings.cancel', integrationID: 'github-copilot' },
    ]);
  });

  it('shows the code on its own line when the instructions do not contain it', () => {
    const { container } = setup(copilot, {
      attempt: {
        integrationID: 'github-copilot',
        phase: 'waiting',
        instructions: 'Approve in the browser.',
        code: 'WXYZ-9',
      },
    });
    expect(must(container, '.settings-code').textContent).toBe('WXYZ-9');
  });

  it('has no Copy code without a code, and a finishing attempt cannot be cancelled', () => {
    const { container, sent, setAttempt } = setup(copilot, {
      attempt: { integrationID: 'github-copilot', phase: 'waiting' },
    });
    expect(buttons(container)).toEqual(['Cancel']);
    setAttempt({ integrationID: 'github-copilot', phase: 'finishing' });
    const cancel = must(container, '.settings-attempt button');
    expect(cancel.getAttribute('aria-disabled')).toBe('true');
    cancel.click();
    expect(sent).toEqual([]);
    setAttempt({ integrationID: 'github-copilot', phase: 'starting' });
    expect(container.textContent).toContain('Starting sign-in');
  });
});

describe('connected', () => {
  it('describes each connection and removes a stored credential through the host', () => {
    const { container, sent } = setup(anthropic);
    expect(container.textContent).toContain('API key · saved by opencode for all projects');
    expect(container.querySelector('button.settings-toggle')).toBeNull();
    const remove = must(container, 'button.secondary');
    expect(remove.getAttribute('aria-label')).toBe('Remove Anthropic (Anthropic)');
    remove.click();
    expect(sent).toEqual([
      { type: 'settings.disconnect', integrationID: 'anthropic', credentialID: 'cred_1' },
    ]);
  });

  it('offers nothing to remove for an environment variable', () => {
    const { container } = setup(vertex);
    expect(container.textContent).toContain('From GOOGLE_APPLICATION_CREDENTIALS');
    expect(container.querySelector('button')).toBeNull();
  });

  it('keeps Remove aria-disabled, and silent, while the host is busy', () => {
    const { container, sent, setBusy } = setup(anthropic);
    setBusy(true);
    const remove = must(container, 'button.secondary');
    expect(remove.getAttribute('aria-disabled')).toBe('true');
    expect(remove.hasAttribute('disabled')).toBe(false);
    remove.click();
    expect(sent).toEqual([]);
  });

  it('says a connection needs sign-in when the server reports it', () => {
    const row: ProviderRow = {
      ...anthropic,
      connections: [{ kind: 'env', name: 'ANTHROPIC_API_KEY', needsAuth: 'Token expired' }],
    };
    const { container } = setup(row);
    expect(container.textContent).toContain('Needs sign-in: Token expired');
  });
});

describe('security', () => {
  it('never renders an input of type password, in any face of any provider', () => {
    for (const row of [anthropic, vertex, azure, copilot, bedrock, openai]) {
      const { container } = setup(row, { open: true });
      expect(container.querySelectorAll('input[type="password"]'), row.id).toHaveLength(0);
      for (const input of container.querySelectorAll('input')) {
        expect(input.type).toBe('text');
      }
      mounted?.dispose();
      mounted = undefined;
    }
    const waiting = setup(copilot, {
      attempt: { integrationID: 'github-copilot', phase: 'waiting', code: 'AB-12' },
    });
    expect(waiting.container.querySelectorAll('input[type="password"]')).toHaveLength(0);
  });

  it('renders server texts as text, not as HTML', () => {
    const row: ProviderRow = { ...azure, name: '<img src=x onerror=alert(1)>' };
    const { container } = setup(row);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
