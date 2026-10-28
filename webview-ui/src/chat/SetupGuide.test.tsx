// Protects the setup guide (E2, issue #85): the ordered steps with their status in words, the
// buttons below each step sending the right messages, and the hidden announcement. Provenance:
// FABRICATED connection states rendered in jsdom; the layout and contrast are NOT tested here
// (`test:visual` measures them).
import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectionState } from '../../../src/shared/protocol';
import { must, mount, type Mounted } from '../testing';
import { SetupGuide } from './SetupGuide';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

const missing: ConnectionState = {
  state: 'unavailable',
  reason: 'binary-missing',
  error: { code: 'binary-missing', message: 'opencode was not found' },
  binary: { checks: [{ source: 'opencode2', outcome: 'not-on-path', detail: '' }] },
};

describe('SetupGuide', () => {
  it('lists the steps in order with the status as text and the searched places', () => {
    mounted = mount(() => <SetupGuide connection={missing} catalog={undefined} />);
    const titles = [...mounted.container.querySelectorAll('.step-title')].map((t) => t.textContent);
    expect(titles).toEqual([
      '1. Find the opencode binary — Failed',
      '2. Start the server — Waiting',
      '3. Pick a model — Waiting',
    ]);
    expect(mounted.container.textContent).toContain('opencode2: not on PATH');
    expect(must(mounted.container, '[role="status"]').textContent).toBe(
      'opencode is not available',
    );
  });

  it('sends the setup action of Choose binary… and Install guide, and logs.show', () => {
    mounted = mount(() => <SetupGuide connection={missing} catalog={undefined} />);
    const click = (label: string) => {
      const button = [...must(mounted!.container, '.setup-guide').querySelectorAll('button')].find(
        (b) => b.textContent === label,
      );
      button?.click();
    };
    click('Choose binary…');
    click('Install guide');
    click('Show logs');
    expect(mounted.sent).toEqual([
      { type: 'setup.action', action: 'binary.choose' },
      { type: 'setup.action', action: 'install.guide' },
      { type: 'logs.show' },
    ]);
  });

  // Issue #86. Provenance: FABRICATED binaryCheck values rendered in jsdom.
  it('says Checking… with a spinner and the chosen path, and Choose binary… ignores presses', () => {
    mounted = mount(() => (
      <SetupGuide
        connection={missing}
        catalog={undefined}
        binaryCheck={{ kind: 'checking', path: '/opt/oc' }}
      />
    ));
    const root = mounted.container;
    expect(must(root, '[data-step="binary"] .step-title').textContent).toBe(
      '1. Find the opencode binary — Checking…',
    );
    expect(root.querySelector('[data-step="binary"] .spinner')).not.toBeNull();
    expect(
      [...root.querySelectorAll('[data-step="binary"] .step-line')].map((l) => l.textContent),
    ).toEqual(['Checking /opt/oc…']);
    expect(must(root, '[role="status"]').textContent).toBe('Checking the opencode binary…');
    const choose = [...root.querySelectorAll('button')].find(
      (b) => b.textContent === 'Choose binary…',
    );
    expect(choose?.getAttribute('aria-disabled')).toBe('true');
    expect(choose?.hasAttribute('disabled')).toBe(false);
    choose?.click();
    expect(mounted.sent).toEqual([]);
  });

  it('calls onChoose before sending binary.choose, and keeps the focus on the pressed button', () => {
    const order: string[] = [];
    mounted = mount(() => (
      <SetupGuide
        connection={missing}
        catalog={undefined}
        onChoose={() => {
          order.push('onChoose');
        }}
      />
    ));
    const choose = [...mounted.container.querySelectorAll('button')].find(
      (b) => b.textContent === 'Choose binary…',
    );
    document.body.append(mounted.container);
    choose?.focus();
    choose?.click();
    order.push(`sent:${String(mounted.sent.length)}`);
    expect(order).toEqual(['onChoose', 'sent:1']);
    expect(document.activeElement).toBe(choose);
  });

  it('does not announce a failure while it is only starting', () => {
    mounted = mount(() => <SetupGuide connection={{ state: 'starting' }} catalog={undefined} />);
    expect(must(mounted.container, '[role="status"]').textContent).toBe('');
    expect(mounted.container.querySelector('[data-step="server"] .spinner')).not.toBeNull();
  });
});
