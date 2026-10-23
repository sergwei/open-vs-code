// Protects the model picker (issue #23) from the ways such a widget quietly breaks:
//   - a panel that opens without the focus in its search box, or whose Escape / choice does not give
//     the focus back to the button (keyboard users lost on the page);
//   - a search box inside the prompt's <form> whose Enter would SEND the prompt;
//   - a list with no keyboard model (arrows, Home/End, back to the box) or with the current model
//     marked only by colour;
//   - a button that is `disabled` while it holds the focus (the focus falls onto the page) instead of
//     `aria-disabled`, and an accessible name that does not contain the visible text (WCAG 2.5.3).
//
// Provenance: a FABRICATED catalog rendered in jsdom (names and ids as the planner's spike saw them
// in a real opencode 2.0.32, Windows 11, 21/10/2026; the second provider is invented to cover the
// grouping). They confirm the wiring of the component, not the layout, the upward panel in a narrow
// side bar, the focus ring or a screen reader (`npm run test:visual` step 11 covers the first three
// on Windows; the last is UNVERIFIED). Lessons applied: focus checked with `document.activeElement`,
// the live-region phrase compared whole.
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { Catalog, ModelOption, ModelRef } from '../../../src/shared/model';
import { must, mount, type Mounted } from '../testing';
import { ModelPicker } from './ModelPicker';
import { effectiveModel } from './selection';

const mounted: Mounted[] = [];
afterEach(() => {
  for (const item of mounted.splice(0)) item.dispose();
});

const option = (
  providerID: string,
  id: string,
  name: string,
  extra: Partial<ModelOption> = {},
): ModelOption => ({
  providerID,
  id,
  name,
  status: 'active',
  contextLimit: 200000,
  free: true,
  variants: [],
  images: true,
  ...extra,
});

const catalog: Catalog = {
  models: [
    option('opencode', 'big-pickle', 'Big Pickle'),
    option('opencode', 'glm-5.3-flash-free', 'GLM-5.3-Flash Free'),
    option('acme', 'sonnet', 'Sonnet 4', { free: false, status: 'beta', contextLimit: 1_000_000 }),
  ],
  providers: [
    { id: 'opencode', name: 'OpenCode' },
    { id: 'acme', name: 'Acme AI' },
  ],
  agents: [{ id: 'build', name: 'Build' }],
  serverDefault: { providerID: 'opencode', id: 'big-pickle' },
  defaultAgent: 'build',
};

interface Harness {
  view: Mounted;
  picked: ModelRef[];
  disable(on: boolean): void;
  trigger(): HTMLButtonElement;
  open(): void;
  search(): HTMLInputElement;
  options(): HTMLButtonElement[];
  key(target: Element, key: string): boolean;
}

/** Mounts the picker; `current` is the model of the open session (absent: the server default). */
function start(
  current?: ModelRef,
  catalogOrNone: Catalog | null = catalog,
  disabled = false,
): Harness {
  const withCatalog = catalogOrNone ?? undefined; // `null` is "no catalog" (undefined would pick the default)
  const picked: ModelRef[] = [];
  const [off, setOff] = createSignal(disabled);
  const view = mount(() => (
    <ModelPicker
      catalog={withCatalog}
      effective={effectiveModel({
        catalog: withCatalog,
        hasSession: current !== undefined,
        row:
          current === undefined
            ? undefined
            : { id: 's', createdAt: 1, updatedAt: 2, model: current },
        draft: {},
      })}
      disabled={off()}
      onSelect={(model) => {
        picked.push(model);
      }}
    />
  ));
  mounted.push(view);
  const harness: Harness = {
    view,
    picked,
    disable: setOff,
    trigger: () => must<HTMLButtonElement>(view.container, 'button.model-trigger'),
    open: () => {
      harness.trigger().click();
    },
    search: () => must<HTMLInputElement>(view.container, 'input[type="search"]'),
    options: () => [...view.container.querySelectorAll<HTMLButtonElement>('button.model-option')],
    key: (target, key) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    },
  };
  return harness;
}

describe('the trigger', () => {
  it('shows the model, is named "Model: <name>" and starts closed', () => {
    const h = start({ providerID: 'opencode', id: 'glm-5.3-flash-free' });
    expect(h.trigger().textContent).toBe('GLM-5.3-Flash Free');
    expect(h.trigger().getAttribute('aria-label')).toBe('Model: GLM-5.3-Flash Free');
    expect(h.trigger().getAttribute('aria-haspopup')).toBe('dialog');
    expect(h.trigger().getAttribute('aria-expanded')).toBe('false');
    expect(h.view.container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('says "(default)" when only the server default applies and "(unavailable)" for a retired model', () => {
    expect(start().trigger().textContent).toBe('Big Pickle (default)');
    expect(start({ providerID: 'opencode', id: 'retired' }).trigger().textContent).toBe(
      'opencode/retired (unavailable)',
    );
  });

  it('is aria-disabled, not disabled, without a catalog or a connection, and does not open', () => {
    const noCatalog = start(undefined, null);
    expect(noCatalog.trigger().getAttribute('aria-disabled')).toBe('true');
    expect(noCatalog.trigger().disabled).toBe(false);
    expect(noCatalog.trigger().textContent).toBe('Model');
    noCatalog.open();
    expect(noCatalog.view.container.querySelector('[role="dialog"]')).toBeNull();

    const offline = start(undefined, catalog, true);
    offline.open();
    expect(offline.trigger().getAttribute('aria-disabled')).toBe('true');
    expect(offline.view.container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps the focus on the button when the connection drops with the panel open', () => {
    const h = start();
    h.open();
    h.trigger().focus();
    h.disable(true);
    expect(h.view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(h.trigger());
  });
});

describe('opening', () => {
  it('opens a labelled, non-modal dialog with the focus in the search box', () => {
    const h = start();
    h.open();
    const dialog = must(h.view.container, '[role="dialog"]');
    expect(dialog.getAttribute('aria-label')).toBe('Choose a model');
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    expect(h.trigger().getAttribute('aria-expanded')).toBe('true');
    expect(h.trigger().getAttribute('aria-controls')).toBe(dialog.id);
    expect(document.activeElement).toBe(h.search());
    expect(h.search().getAttribute('aria-label')).toBe('Search models');
  });

  it('groups the models by provider with a visible heading, and says how many in the live region', () => {
    const h = start();
    h.open();
    const sections = [...h.view.container.querySelectorAll('section.model-group')];
    expect(sections.map((s) => s.getAttribute('aria-label'))).toEqual(['OpenCode', 'Acme AI']);
    expect(sections.map((s) => s.querySelector('h3')?.textContent)).toEqual([
      'OpenCode',
      'Acme AI',
    ]);
    expect(h.options().map((b) => b.querySelector('.model-name')?.textContent)).toEqual([
      'Big Pickle',
      'GLM-5.3-Flash Free',
      'Sonnet 4',
    ]);
    expect(must(h.view.container, '[role="status"]').textContent.trim()).toBe('3 models');
  });

  it('each model carries its detail as ONE string', () => {
    const h = start();
    h.open();
    expect(h.options().map((b) => b.querySelector('.model-meta')?.textContent)).toEqual([
      'Current · Free · 200K context',
      'Free · 200K context',
      '1M context · beta',
    ]);
  });

  it('marks the current model with aria-current and the word "Current"', () => {
    const h = start({ providerID: 'opencode', id: 'glm-5.3-flash-free' });
    h.open();
    const current = h.options().filter((b) => b.getAttribute('aria-current') === 'true');
    expect(current.map((b) => b.querySelector('.model-name')?.textContent)).toEqual([
      'GLM-5.3-Flash Free',
    ]);
    expect(current[0]?.querySelector('.model-meta')?.textContent).toBe(
      'Current · Free · 200K context',
    );
    // The tab stop starts on the current model.
    expect(h.options().map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
  });
});

describe('searching', () => {
  const type = (h: Harness, text: string) => {
    h.search().value = text;
    h.search().dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('filters at once, announces the count and says when nothing matches', () => {
    const h = start();
    h.open();
    type(h, 'glm');
    expect(h.options().map((b) => b.querySelector('.model-name')?.textContent)).toEqual([
      'GLM-5.3-Flash Free',
    ]);
    expect(must(h.view.container, '[role="status"]').textContent.trim()).toBe('1 model');
    type(h, 'zzz');
    expect(h.options()).toEqual([]);
    expect(must(h.view.container, '.session-status').textContent).toBe('No models match');
    expect(must(h.view.container, '[role="status"]').textContent.trim()).toBe('No models match');
  });

  it('alternates a no-break space so a repeated announcement is read again', () => {
    const h = start();
    h.open();
    const status = must(h.view.container, '[role="status"]');
    const first = status.textContent;
    type(h, 'zzz');
    type(h, 'yyy');
    expect(status.textContent.trim()).toBe('No models match');
    expect(status.textContent).not.toBe(first);
  });

  it('finds a model typed without the punctuation', () => {
    const h = start();
    h.open();
    type(h, 'glm53');
    expect(h.options()).toHaveLength(1);
  });

  it('Enter in the box picks the first match, closes and never submits the form', () => {
    const h = start();
    h.open();
    type(h, 'sonnet');
    expect(h.key(h.search(), 'Enter')).toBe(true);
    expect(h.picked).toEqual([{ providerID: 'acme', id: 'sonnet' }]);
    expect(h.view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(h.trigger());
  });
});

describe('keyboard', () => {
  it('ArrowDown from the box enters the list at the tab stop; arrows, Home and End move between models', () => {
    const h = start({ providerID: 'opencode', id: 'glm-5.3-flash-free' });
    h.open();
    h.key(h.search(), 'ArrowDown');
    const [first, second, third] = h.options();
    expect(document.activeElement).toBe(second);
    h.key(second as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(third);
    h.key(third as HTMLElement, 'ArrowDown'); // clamped at the end
    expect(document.activeElement).toBe(third);
    h.key(third as HTMLElement, 'Home');
    expect(document.activeElement).toBe(first);
    h.key(first as HTMLElement, 'End');
    expect(document.activeElement).toBe(third);
    h.key(third as HTMLElement, 'ArrowUp');
    expect(document.activeElement).toBe(second);
  });

  it('roving tabindex: only the last focused model is a tab stop', () => {
    const h = start();
    h.open();
    const [first, second, third] = h.options();
    expect(h.options().map((b) => b.tabIndex)).toEqual([0, -1, -1]);
    (third as HTMLElement).focus();
    expect(h.options().map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
    expect(first).toBeDefined();
    expect(second).toBeDefined();
  });

  it('ArrowUp from the first model goes back to the search box', () => {
    const h = start();
    h.open();
    const [first] = h.options();
    h.key(first as HTMLElement, 'ArrowUp');
    expect(document.activeElement).toBe(h.search());
  });

  it('Enter or a click on a model picks it, closes the panel and returns the focus to the button', () => {
    const h = start();
    h.open();
    const [, second] = h.options();
    (second as HTMLElement).click();
    expect(h.picked).toEqual([{ providerID: 'opencode', id: 'glm-5.3-flash-free' }]);
    expect(h.view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(h.trigger());
    expect(h.trigger().getAttribute('aria-expanded')).toBe('false');
  });

  // Issue #61 (decision of Sergio, 22/10/2026, Engram #1021). The variant has its own control now.
  it('the trigger no longer carries the reasoning variant', () => {
    const h = start({ providerID: 'opencode', id: 'glm-5.3-flash-free', variant: 'high' });
    expect(h.trigger().textContent).toBe('GLM-5.3-Flash Free');
    expect(h.trigger().getAttribute('aria-label')).toBe('Model: GLM-5.3-Flash Free');
  });

  it('picking the model already in use keeps its variant, picking another starts on Default', () => {
    const h = start({ providerID: 'opencode', id: 'glm-5.3-flash-free', variant: 'high' });
    h.open();
    (h.options()[1] as HTMLElement).click();
    expect(h.picked).toEqual([
      { providerID: 'opencode', id: 'glm-5.3-flash-free', variant: 'high' },
    ]);
    h.open();
    (h.options()[0] as HTMLElement).click();
    expect(h.picked[1]).toEqual({ providerID: 'opencode', id: 'big-pickle' });
    expect('variant' in (h.picked[1] ?? {})).toBe(false);
  });

  it('Escape closes without picking and returns the focus to the button', () => {
    const h = start();
    h.open();
    expect(h.key(h.search(), 'Escape')).toBe(true);
    expect(h.picked).toEqual([]);
    expect(h.view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(h.trigger());
  });

  it('the trigger toggles: a second click closes it', () => {
    const h = start();
    h.open();
    h.open();
    expect(h.view.container.querySelector('[role="dialog"]')).toBeNull();
  });
});

describe('pointer', () => {
  const pointerDown = (target: Element) => {
    target.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
  };

  it('a pointer-down outside closes the panel and does not move the focus', () => {
    const h = start();
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    h.open();
    elsewhere.focus();
    pointerDown(elsewhere);
    expect(h.view.container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('a pointer-down inside the panel or on the button leaves it open (the button toggles by itself)', () => {
    const h = start();
    h.open();
    pointerDown(h.search());
    expect(h.view.container.querySelector('[role="dialog"]')).not.toBeNull();
    pointerDown(h.trigger());
    expect(h.view.container.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
