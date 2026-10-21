// Protects the Build | Plan switch and "More agents" (issue #24) from the ways they quietly break:
//   - a switch that is not a real radio group (no arrows, no screen-reader "1 of 2");
//   - an Enter on a radio that SENDS the prompt (the switch lives inside its <form>);
//   - a control that is `disabled` while it holds the focus, instead of `aria-disabled` with the
//     click cancelled;
//   - the agent that will answer being hidden when it is neither Build nor Plan, or "More agents"
//     showing up when the server has no custom agent.
//
// Provenance: a FABRICATED catalog rendered in jsdom (the ids `build` and `plan`, and that `id` is
// "build" while `name` is "Build", come from the planner's spike against a real opencode 2.0.32,
// Windows 11, 21/10/2026; the custom agent is invented). They confirm the wiring of the component,
// not Chromium's arrow-key behaviour on radios nor the layout (`npm run test:visual` step 11) nor a
// screen reader (UNVERIFIED).
import { afterEach, describe, expect, it } from 'vitest';
import type { Catalog } from '../../../src/shared/model';
import { must, mount, type Mounted } from '../testing';
import { AgentToggle } from './AgentToggle';

const mounted: Mounted[] = [];
afterEach(() => {
  for (const item of mounted.splice(0)) item.dispose();
});

const plain: Catalog = {
  models: [],
  providers: [],
  agents: [
    { id: 'build', name: 'Build' },
    { id: 'plan', name: 'Plan' },
  ],
  defaultAgent: 'build',
};
const withCustom: Catalog = {
  ...plain,
  agents: [
    ...plain.agents,
    { id: 'review', name: 'Reviewer', description: 'Reads the diff' },
    { id: 'docs', name: 'Docs' },
  ],
};

/** Mounts the toggle inside a <form> whose submit is recorded, as in the prompt box. */
function start(
  effective: string | undefined,
  catalogOrNone: Catalog | null = plain,
  disabled = false,
) {
  const catalog = catalogOrNone ?? undefined; // `null` is "no catalog" (undefined would pick the default)
  const picked: string[] = [];
  let submits = 0;
  const view = mount(() => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submits += 1;
      }}
    >
      <AgentToggle
        catalog={catalog}
        effective={effective}
        disabled={disabled}
        onSelect={(id) => {
          picked.push(id);
        }}
      />
      <button type="submit">Send</button>
    </form>
  ));
  mounted.push(view);
  return {
    view,
    picked,
    submits: () => submits,
    radio: (id: string) => must<HTMLInputElement>(view.container, `#agent-${id}`),
    labels: () =>
      [...view.container.querySelectorAll('.agent-toggle label')].map((l) => l.textContent),
    more: () => view.container.querySelector<HTMLButtonElement>('button.agent-more'),
  };
}

describe('the switch', () => {
  it('is a labelled fieldset of radios, Build and Plan, with the effective agent checked', () => {
    const h = start('plan');
    const group = must(h.view.container, 'fieldset.agent-toggle');
    expect(group.querySelector('legend')?.textContent).toBe('Agent');
    expect(h.labels()).toEqual(['Build', 'Plan']);
    expect(h.radio('build').type).toBe('radio');
    expect(h.radio('build').name).toBe(h.radio('plan').name);
    expect(h.radio('build').checked).toBe(false);
    expect(h.radio('plan').checked).toBe(true);
  });

  it('a click on the other segment reports that agent once', () => {
    const h = start('build');
    h.radio('plan').click();
    expect(h.picked).toEqual(['plan']);
  });

  it('shows no segment for an agent the server does not have', () => {
    const onlyBuild: Catalog = { ...plain, agents: [{ id: 'build', name: 'Build' }] };
    expect(start('build', onlyBuild).labels()).toEqual(['Build']);
  });

  it('shows the effective agent as a third checked segment when it is neither Build nor Plan', () => {
    const h = start('review', withCustom);
    expect(h.labels()).toEqual(['Build', 'Plan', 'Reviewer']);
    expect(h.radio('review').checked).toBe(true);
    expect(h.radio('build').checked).toBe(false);
  });

  it("names a subagent session's agent by its id when the catalog does not list it", () => {
    const h = start('general');
    expect(h.labels()).toEqual(['Build', 'Plan', 'general']);
    expect(h.radio('general').checked).toBe(true);
  });

  it('Enter on a radio is cancelled, so it cannot submit the prompt', () => {
    const h = start('build');
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    h.radio('build').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(h.submits()).toBe(0);
  });

  it('is aria-disabled, never disabled, and a click is cancelled and reports nothing', () => {
    const h = start('build', plain, true);
    expect(h.radio('plan').disabled).toBe(false);
    expect(h.radio('plan').getAttribute('aria-disabled')).toBe('true');
    expect(must(h.view.container, 'fieldset').getAttribute('aria-disabled')).toBe('true');
    h.radio('plan').click();
    expect(h.picked).toEqual([]);
    expect(h.radio('plan').checked).toBe(false);
  });

  it('without a catalog nothing is checked and nothing can be picked', () => {
    const h = start(undefined, null);
    expect(h.labels()).toEqual([]);
    expect(must(h.view.container, 'fieldset').getAttribute('aria-disabled')).toBe('true');
  });
});

describe('More agents', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('exists only when the server has agents beyond Build and Plan', () => {
    expect(start('build').more()).toBeNull();
    expect(start('build', withCustom).more()?.textContent).toBe('More agents');
  });

  it('opens a dialog with the custom agents, focuses the first and marks the current one', async () => {
    const h = start('review', withCustom);
    h.more()?.click();
    await flush();
    const dialog = must(h.view.container, '[role="dialog"]');
    expect(dialog.getAttribute('aria-label')).toBe('More agents');
    expect(h.more()?.getAttribute('aria-expanded')).toBe('true');
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button.model-option')];
    expect(buttons.map((b) => b.querySelector('.model-name')?.textContent)).toEqual([
      'Reviewer',
      'Docs',
    ]);
    expect(buttons.map((b) => b.querySelector('.model-meta')?.textContent)).toEqual([
      'Current · Reads the diff',
      undefined,
    ]);
    expect(buttons[0]?.getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('picking one reports it, closes the dialog and returns the focus to the button', async () => {
    const h = start('build', withCustom);
    h.more()?.click();
    await flush();
    const docs = [
      ...h.view.container.querySelectorAll<HTMLButtonElement>('button.model-option'),
    ][1];
    docs?.click();
    expect(h.picked).toEqual(['docs']);
    expect(h.view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(h.more());
  });

  it('Escape closes it and returns the focus to the button; the form is not submitted', async () => {
    const h = start('build', withCustom);
    h.more()?.click();
    await flush();
    const dialog = must(h.view.container, '[role="dialog"]');
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    dialog.querySelector('button')?.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(h.view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(h.more());
    expect(h.submits()).toBe(0);
  });

  it('a pointer-down outside closes it without moving the focus', async () => {
    const h = start('build', withCustom);
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    h.more()?.click();
    await flush();
    elsewhere.focus();
    elsewhere.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    expect(h.view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('is aria-disabled and does not open when the switch is disabled', () => {
    const h = start('build', withCustom, true);
    expect(h.more()?.getAttribute('aria-disabled')).toBe('true');
    expect(h.more()?.disabled).toBe(false);
    h.more()?.click();
    expect(h.view.container.querySelector('[role="dialog"]')).toBeNull();
  });
});
