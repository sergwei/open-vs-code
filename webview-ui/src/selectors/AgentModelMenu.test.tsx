// Protects the combined agent and model chip (E2, issue #85, phase 3) from the ways such a widget
// quietly breaks. It REPLACES the tests of `AgentToggle`, `ModelPicker` and `VariantPicker`, and the
// cases below are the ones of those files that guard a real regression, ported one by one:
//   - the search box lives inside the prompt's <form>: Enter must not SEND the prompt (it picks the
//     first match), and Escape must close the panel WITHOUT reaching the prompt, which stops the turn
//     on Escape while busy (lesson #1070: the spy goes on `window`, Solid delegates to `document`);
//   - a control that is `disabled` while it holds the focus drops the focus onto the page: the chip is
//     `aria-disabled`, and a panel closed by a lost connection keeps the focus where it was;
//   - a panel that opens without the focus on its current row, whose Escape or choice does not give the
//     focus back to the chip, or whose rows mark the current one only by colour;
//   - a pointer-down outside that does not close the panel, or that moves the focus;
//   - picking the SAME model wiping its reasoning level, or another model keeping a level that means
//     something else (Engram #1021), and "Default" reaching the host as the string "default";
//   - the chosen model reaching the host as a store Proxy (DataCloneError in `postMessage`: the pick
//     is a plain copy, see `selection.test.ts`; `App.test.tsx` structured-clones the real send);
//   - an effective agent, model or variant the catalog lacks being hidden (decision P7=1).
//
// Provenance: a FABRICATED catalog rendered in jsdom (names and ids as the planner's spike saw them
// in a real opencode 2.0.32, Windows 11, 21/10/2026; the second provider, the custom agents and the
// `low`/`high` variants are invented to cover grouping, "Current" and the Reasoning section). They
// confirm the wiring of the component, not the layout, the stacked columns under 360 px, the upward
// panel in a narrow side bar, the focus ring or a screen reader: the first four were observed in a
// real window by `npm run test:visual` (27/10/2026, Windows 11, VS Code 1.143.1; see the header of
// `AgentModelMenu.tsx`), a screen reader never was.
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Catalog, ModelOption, ModelRef } from '../../../src/shared/model';
import type { ConnectionState } from '../../../src/shared/protocol';
import { must, mount, type Mounted } from '../testing';
import { AgentModelMenu } from './AgentModelMenu';
import { effectiveModel, variantChoices } from './selection';

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
    option('opencode', 'glm-5.3-flash-free', 'GLM-5.3-Flash Free', { variants: ['low', 'high'] }),
    option('acme', 'sonnet', 'Sonnet 4', { free: false, status: 'beta', contextLimit: 1_000_000 }),
  ],
  providers: [
    { id: 'opencode', name: 'OpenCode' },
    { id: 'acme', name: 'Acme AI' },
  ],
  agents: [
    { id: 'build', name: 'Build' },
    { id: 'plan', name: 'Plan' },
    { id: 'review', name: 'Reviewer', description: 'Reads the diff' },
  ],
  serverDefault: { providerID: 'opencode', id: 'big-pickle' },
  defaultAgent: 'build',
};

interface Options {
  /** The model of the open session (absent: the server default). */
  model?: ModelRef;
  agent?: string;
  /** `null` is "no catalog" (undefined would pick the default). */
  catalog?: Catalog | null;
  disabled?: boolean;
  connection?: ConnectionState['state'];
}

interface Harness {
  view: Mounted;
  pickedAgents: string[];
  pickedModels: ModelRef[];
  pickedVariants: (string | undefined)[];
  submits(): number;
  disable(on: boolean): void;
  setModel(model: ModelRef | undefined): void;
  chip(): HTMLButtonElement;
  open(): void;
  dialog(): Element | null;
  search(): HTMLInputElement;
  agentRows(): HTMLButtonElement[];
  modelRows(): HTMLButtonElement[];
  variantRows(): HTMLButtonElement[];
  key(target: Element, key: string): boolean;
  /** The close function the chip handed the parent through `onCloseReady`. */
  closeFromParent(): void;
}

/** Mounts the chip inside a <form> whose submit is recorded, as in the prompt box. */
function start(options: Options = {}): Harness {
  const withCatalog = options.catalog === null ? undefined : (options.catalog ?? catalog);
  const pickedAgents: string[] = [];
  const pickedModels: ModelRef[] = [];
  const pickedVariants: (string | undefined)[] = [];
  let submits = 0;
  let closeFromParent: (() => void) | undefined;
  const [off, setOff] = createSignal(options.disabled ?? false);
  const [current, setCurrent] = createSignal<ModelRef | undefined>(options.model);
  const effective = () =>
    effectiveModel({
      catalog: withCatalog,
      hasSession: current() !== undefined,
      row:
        current() === undefined
          ? undefined
          : { id: 's', createdAt: 1, updatedAt: 2, model: current() },
      draft: {},
    });
  const view = mount(() => (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submits += 1;
      }}
    >
      <AgentModelMenu
        catalog={withCatalog}
        agent={withCatalog === undefined ? undefined : (options.agent ?? withCatalog.defaultAgent)}
        model={effective()}
        variants={variantChoices(effective())}
        connection={options.connection ?? 'connected'}
        disabled={off()}
        onSelectAgent={(id) => {
          pickedAgents.push(id);
        }}
        onSelectModel={(model) => {
          pickedModels.push(model);
        }}
        onSelectVariant={(variant) => {
          pickedVariants.push(variant);
        }}
        onCloseReady={(close) => {
          closeFromParent = close;
        }}
      />
      <button type="submit">Send</button>
    </form>
  ));
  mounted.push(view);
  // The Reasoning section sits INSIDE the Model column, so the model rows are those of its list.
  const rows = (group: string) => [
    ...view.container.querySelectorAll<HTMLButtonElement>(
      group === 'model'
        ? '[data-group="model"] .model-groups button.model-option'
        : `[data-group="${group}"] button.model-option`,
    ),
  ];
  const harness: Harness = {
    view,
    pickedAgents,
    pickedModels,
    pickedVariants,
    closeFromParent: () => {
      closeFromParent?.();
    },
    submits: () => submits,
    disable: setOff,
    setModel: setCurrent,
    chip: () => must<HTMLButtonElement>(view.container, 'button.agent-model-chip'),
    open: () => {
      harness.chip().click();
    },
    dialog: () => view.container.querySelector('[role="dialog"]'),
    search: () => must<HTMLInputElement>(view.container, 'input[type="search"]'),
    agentRows: () => rows('agent'),
    modelRows: () => rows('model'),
    variantRows: () => rows('variant'),
    key: (target, key) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    },
  };
  return harness;
}

const GLM: ModelRef = { providerID: 'opencode', id: 'glm-5.3-flash-free' };
const names = (list: HTMLElement[]) => list.map((b) => b.querySelector('.model-name')?.textContent);

// Protects against the orphan panel of review W1: the focus leaving by a shortcut fires no
// `focusout` with a target, so the window `blur` and the parent's `onCloseReady` must close it.
describe('closing when the focus leaves by code', () => {
  it('closes on the window blur and when the parent asks, without moving the focus', () => {
    const h = start({ model: GLM });
    h.open();
    expect(h.dialog()).not.toBeNull();
    window.dispatchEvent(new Event('blur'));
    expect(h.dialog()).toBeNull();
    h.open();
    expect(h.dialog()).not.toBeNull();
    h.closeFromParent();
    expect(h.dialog()).toBeNull();
    expect(h.chip().getAttribute('aria-expanded')).toBe('false');
  });
});

describe('the chip', () => {
  it('shows agent · model, is named "Agent and model: <text> (<connection>)" and starts closed', () => {
    const h = start({ model: GLM });
    expect(h.chip().textContent).toBe('Build · GLM-5.3-Flash Free');
    expect(h.chip().getAttribute('aria-label')).toBe(
      'Agent and model: Build · GLM-5.3-Flash Free (Connected)',
    );
    // WCAG 2.5.3: the visible text is inside the accessible name.
    expect(h.chip().getAttribute('aria-label')).toContain(h.chip().textContent);
    expect(h.chip().getAttribute('aria-haspopup')).toBe('dialog');
    expect(h.chip().getAttribute('aria-expanded')).toBe('false');
    expect(h.dialog()).toBeNull();
  });

  it('adds the reasoning variant, and nothing for Default or for the server default', () => {
    expect(start({ model: { ...GLM, variant: 'low' } }).chip().textContent).toBe(
      'Build · GLM-5.3-Flash Free · low',
    );
    expect(start({ model: GLM }).chip().textContent).toBe('Build · GLM-5.3-Flash Free');
    // Only the server default applies: no "(default)" suffix in the chip any more.
    expect(start().chip().textContent).toBe('Build · Big Pickle');
  });

  it('marks what the catalog lacks as "(unavailable)" (P7=1): retired model, subagent agent, retired variant', () => {
    expect(start({ model: { providerID: 'opencode', id: 'retired' } }).chip().textContent).toBe(
      'Build · opencode/retired (unavailable)',
    );
    expect(start({ agent: 'general' }).chip().textContent).toBe(
      'general (unavailable) · Big Pickle',
    );
    expect(start({ model: { ...GLM, variant: 'ultra' } }).chip().textContent).toBe(
      'Build · GLM-5.3-Flash Free · ultra (unavailable)',
    );
  });

  it('carries the connection as a dot with data-state and in the accessible name, not only a colour (P10=1)', () => {
    const h = start({ connection: 'reconnecting' });
    expect(must(h.view.container, '.conn-dot').getAttribute('data-state')).toBe('reconnecting');
    expect(must(h.view.container, '.conn-dot').getAttribute('aria-hidden')).toBe('true');
    expect(h.chip().getAttribute('aria-label')).toBe(
      'Agent and model: Build · Big Pickle (Reconnecting)',
    );
    expect(h.chip().title).toBe(h.chip().getAttribute('aria-label'));
  });

  it('is aria-disabled, not disabled, without a catalog or a connection, and does not open', () => {
    const noCatalog = start({ catalog: null });
    expect(noCatalog.chip().getAttribute('aria-disabled')).toBe('true');
    expect(noCatalog.chip().disabled).toBe(false);
    expect(noCatalog.chip().textContent).toBe('Agent · Model');
    noCatalog.open();
    expect(noCatalog.dialog()).toBeNull();

    const offline = start({ disabled: true });
    offline.open();
    expect(offline.chip().getAttribute('aria-disabled')).toBe('true');
    expect(offline.dialog()).toBeNull();
  });

  it('keeps the focus on the chip when the connection drops with the panel open', () => {
    const h = start();
    h.open();
    h.chip().focus();
    h.disable(true);
    expect(h.dialog()).toBeNull();
    expect(document.activeElement).toBe(h.chip());
  });

  it('gives the focus back to the chip when it sat inside the panel that the lost connection closed', () => {
    const h = start();
    h.open();
    expect(document.activeElement?.closest('[role="dialog"]')).not.toBeNull();
    h.disable(true);
    expect(h.dialog()).toBeNull();
    expect(document.activeElement).toBe(h.chip());
  });
});

describe('opening', () => {
  it('opens a labelled, non-modal dialog with the focus on the current agent', () => {
    const h = start({ agent: 'plan' });
    h.open();
    const dialog = must(h.view.container, '[role="dialog"]');
    expect(dialog.getAttribute('aria-label')).toBe('Choose agent and model');
    expect(dialog.getAttribute('aria-modal')).toBeNull();
    expect(h.chip().getAttribute('aria-expanded')).toBe('true');
    expect(h.chip().getAttribute('aria-controls')).toBe(dialog.id);
    expect(document.activeElement).toBe(h.agentRows()[1]);
    expect(h.search().getAttribute('aria-label')).toBe('Search models');
  });

  it('lists the agents with the current one marked by aria-current and the word "Current"', () => {
    const h = start({ agent: 'review' });
    h.open();
    expect(names(h.agentRows())).toEqual(['Build', 'Plan', 'Reviewer']);
    const current = h.agentRows().filter((b) => b.getAttribute('aria-current') === 'true');
    expect(current.map((b) => b.dataset['agent'])).toEqual(['review']);
    expect(h.agentRows().map((b) => b.querySelector('.model-meta')?.textContent)).toEqual([
      undefined,
      undefined,
      'Current · Reads the diff',
    ]);
    expect(h.agentRows().map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
  });

  it('shows the effective agent the catalog lacks FIRST, current and not pickable (P7=1)', () => {
    const h = start({ agent: 'general' });
    h.open();
    expect(names(h.agentRows())).toEqual(['general (unavailable)', 'Build', 'Plan', 'Reviewer']);
    const missing = h.agentRows()[0] as HTMLButtonElement;
    expect(missing.getAttribute('aria-current')).toBe('true');
    expect(missing.getAttribute('aria-disabled')).toBe('true');
    expect(missing.disabled).toBe(false);
    missing.click();
    expect(h.pickedAgents).toEqual([]);
    expect(h.dialog()).toBeNull();
    expect(document.activeElement).toBe(h.chip());
  });

  it('shows the effective model the catalog lacks first in the Model column, current and not pickable', () => {
    const h = start({ model: { providerID: 'opencode', id: 'retired' } });
    h.open();
    const missing = must<HTMLButtonElement>(h.view.container, 'button[data-model-unavailable]');
    expect(missing.querySelector('.model-name')?.textContent).toBe(
      'opencode/retired (unavailable)',
    );
    expect(missing.getAttribute('aria-current')).toBe('true');
    expect(missing.getAttribute('aria-disabled')).toBe('true');
    expect(h.modelRows()[0]).toBe(missing);
    missing.click();
    expect(h.pickedModels).toEqual([]);
    expect(h.dialog()).toBeNull();
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
    expect(names(h.modelRows())).toEqual(['Big Pickle', 'GLM-5.3-Flash Free', 'Sonnet 4']);
    expect(must(h.view.container, '[role="status"]').textContent.trim()).toBe('3 models');
  });

  it('each model carries its detail as ONE string, and the current one is marked', () => {
    const h = start({ model: GLM });
    h.open();
    expect(h.modelRows().map((b) => b.querySelector('.model-meta')?.textContent)).toEqual([
      'Free · 200K context',
      'Current · Free · 200K context',
      '1M context · beta',
    ]);
    const current = h.modelRows().filter((b) => b.getAttribute('aria-current') === 'true');
    expect(names(current)).toEqual(['GLM-5.3-Flash Free']);
    // The tab stop of the model list starts on the current model.
    expect(h.modelRows().map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
  });

  it('shows the Reasoning section only when the effective model lists variants', () => {
    const plain = start();
    plain.open();
    expect(plain.variantRows()).toEqual([]);
    expect(plain.view.container.querySelector('.menu-reasoning')).toBeNull();

    const reasoning = start({ model: { ...GLM, variant: 'high' } });
    reasoning.open();
    expect(names(reasoning.variantRows())).toEqual(['Default', 'low', 'high']);
    const current = reasoning
      .variantRows()
      .filter((b) => b.getAttribute('aria-current') === 'true');
    expect(current.map((b) => b.dataset['variant'])).toEqual(['high']);
    expect(current[0]?.querySelector('.model-meta')?.textContent).toBe('Current');
    expect(reasoning.variantRows().map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
  });

  // Decision of Sergio (27/10/2026, as sketch D3): Reasoning lives INSIDE the Model column, under
  // its list, and its rows are not model rows (the model list keys must not walk into them).
  it('puts the Reasoning section inside the Model column, after the model list', () => {
    const h = start({ model: GLM });
    h.open();
    const column = must(h.view.container, '[data-group="model"]');
    const reasoning = must(h.view.container, '.menu-reasoning');
    expect(column.contains(reasoning)).toBe(true);
    const groups = must(column, '.model-groups');
    expect(
      groups.compareDocumentPosition(reasoning) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(groups.contains(reasoning)).toBe(false);
  });

  it('Default is the current Reasoning row when no variant is set', () => {
    const h = start({ model: GLM });
    h.open();
    expect(h.variantRows()[0]?.getAttribute('aria-current')).toBe('true');
  });

  it('keeps a variant that is set but not listed as "<id> (unavailable)", current and not pickable', () => {
    const h = start({ model: { ...GLM, variant: 'ultra' } });
    h.open();
    expect(names(h.variantRows())).toEqual(['Default', 'low', 'high', 'ultra (unavailable)']);
    const missing = h.variantRows()[3] as HTMLElement;
    expect(missing.getAttribute('aria-current')).toBe('true');
    missing.click();
    expect(h.pickedVariants).toEqual([]);
    expect(h.dialog()).toBeNull();
  });

  it('the chip toggles: a second click closes it', () => {
    const h = start();
    h.open();
    h.open();
    expect(h.dialog()).toBeNull();
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
    expect(names(h.modelRows())).toEqual(['GLM-5.3-Flash Free']);
    expect(must(h.view.container, '[role="status"]').textContent.trim()).toBe('1 model');
    type(h, 'zzz');
    expect(h.modelRows()).toEqual([]);
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
    expect(h.modelRows()).toHaveLength(1);
  });

  it('Enter in the box picks the first match, closes, returns the focus and never submits the form', () => {
    const h = start();
    h.open();
    type(h, 'sonnet');
    expect(h.key(h.search(), 'Enter')).toBe(true);
    expect(h.pickedModels).toEqual([{ providerID: 'acme', id: 'sonnet' }]);
    expect(h.submits()).toBe(0);
    expect(h.dialog()).toBeNull();
    expect(document.activeElement).toBe(h.chip());
  });
});

describe('keyboard', () => {
  it('ArrowDown from the box enters the model list at the tab stop; arrows, Home and End move without wrapping', () => {
    const h = start({ model: GLM });
    h.open();
    h.key(h.search(), 'ArrowDown');
    const [first, second, third] = h.modelRows();
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

  it('ArrowUp from the first model goes back to the search box', () => {
    const h = start();
    h.open();
    h.key(h.modelRows()[0] as HTMLElement, 'ArrowUp');
    expect(document.activeElement).toBe(h.search());
  });

  it('roving tabindex: only the last focused model is a tab stop', () => {
    const h = start();
    h.open();
    expect(h.modelRows().map((b) => b.tabIndex)).toEqual([0, -1, -1]);
    (h.modelRows()[2] as HTMLElement).focus();
    expect(h.modelRows().map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
  });

  it('the agent list has its own arrows, Home and End, and does not leak into the models', () => {
    const h = start();
    h.open();
    const [build, plan, review] = h.agentRows();
    expect(document.activeElement).toBe(build);
    expect(h.key(build as Element, 'ArrowDown')).toBe(true);
    expect(document.activeElement).toBe(plan);
    h.key(plan as Element, 'End');
    expect(document.activeElement).toBe(review);
    h.key(review as Element, 'ArrowDown');
    expect(document.activeElement).toBe(review);
    h.key(review as Element, 'Home');
    expect(document.activeElement).toBe(build);
    h.key(build as Element, 'ArrowUp');
    expect(document.activeElement).toBe(build);
  });

  it('the Reasoning list has its own arrows, Home and End, without wrapping', () => {
    const h = start({ model: GLM });
    h.open();
    const rows = h.variantRows();
    (rows[0] as HTMLElement).focus();
    expect(h.key(rows[0] as Element, 'ArrowDown')).toBe(true);
    expect(document.activeElement).toBe(rows[1]);
    h.key(rows[1] as Element, 'End');
    expect(document.activeElement).toBe(rows[2]);
    h.key(rows[2] as Element, 'ArrowDown');
    expect(document.activeElement).toBe(rows[2]);
    h.key(rows[2] as Element, 'Home');
    expect(document.activeElement).toBe(rows[0]);
  });

  it('Escape closes without picking, returns the focus to the chip and is not left to the prompt', () => {
    const h = start();
    h.open();
    const reached = vi.fn();
    window.addEventListener('keydown', reached);
    // Lesson #1070: Solid delegates to `document`, so the spy must sit on `window` to see a leak.
    expect(h.key(h.agentRows()[0] as Element, 'Escape')).toBe(true);
    window.removeEventListener('keydown', reached);
    expect(reached).not.toHaveBeenCalled();
    expect(h.pickedAgents).toEqual([]);
    expect(h.pickedModels).toEqual([]);
    expect(h.dialog()).toBeNull();
    expect(document.activeElement).toBe(h.chip());
  });

  it('Escape from the search box closes it too', () => {
    const h = start();
    h.open();
    expect(h.key(h.search(), 'Escape')).toBe(true);
    expect(h.dialog()).toBeNull();
    expect(document.activeElement).toBe(h.chip());
  });
});

describe('choosing (P6=1: every choice closes the panel and returns the focus to the chip)', () => {
  it('an agent is reported once, the panel closes and the focus returns to the chip', () => {
    const h = start();
    h.open();
    (h.agentRows()[1] as HTMLElement).click();
    expect(h.pickedAgents).toEqual(['plan']);
    expect(h.dialog()).toBeNull();
    expect(document.activeElement).toBe(h.chip());
    expect(h.chip().getAttribute('aria-expanded')).toBe('false');
  });

  it('a model is reported as a plain copy, the panel closes and the focus returns to the chip', () => {
    const h = start();
    h.open();
    (h.modelRows()[1] as HTMLElement).click();
    expect(h.pickedModels).toEqual([GLM]);
    expect(() => structuredClone(h.pickedModels[0])).not.toThrow();
    expect(h.dialog()).toBeNull();
    expect(document.activeElement).toBe(h.chip());
  });

  it('picking the model already in use keeps its variant, picking another starts on Default', () => {
    const h = start({ model: { ...GLM, variant: 'high' } });
    h.open();
    (h.modelRows()[1] as HTMLElement).click();
    expect(h.pickedModels).toEqual([{ ...GLM, variant: 'high' }]);
    h.open();
    (h.modelRows()[0] as HTMLElement).click();
    expect(h.pickedModels[1]).toEqual({ providerID: 'opencode', id: 'big-pickle' });
    expect('variant' in (h.pickedModels[1] ?? {})).toBe(false);
  });

  it('a variant is reported, the panel closes and the focus returns to the chip', () => {
    const h = start({ model: GLM });
    h.open();
    (h.variantRows()[2] as HTMLElement).click();
    expect(h.pickedVariants).toEqual(['high']);
    expect(h.dialog()).toBeNull();
    expect(document.activeElement).toBe(h.chip());
  });

  it('Default reaches the host as undefined, never as the string "default"', () => {
    const h = start({ model: { ...GLM, variant: 'low' } });
    h.open();
    (h.variantRows()[0] as HTMLElement).click();
    expect(h.pickedVariants).toEqual([undefined]);
  });

  it('changing both an agent and a model takes two openings', () => {
    const h = start();
    h.open();
    (h.agentRows()[1] as HTMLElement).click();
    expect(h.dialog()).toBeNull();
    h.open();
    (h.modelRows()[2] as HTMLElement).click();
    expect(h.pickedAgents).toEqual(['plan']);
    expect(h.pickedModels).toEqual([{ providerID: 'acme', id: 'sonnet' }]);
  });
});

describe('pointer and focus', () => {
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
    expect(h.dialog()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('a pointer-down inside the panel or on the chip leaves it open (the chip toggles by itself)', () => {
    const h = start();
    h.open();
    pointerDown(h.search());
    expect(h.dialog()).not.toBeNull();
    pointerDown(h.chip());
    expect(h.dialog()).not.toBeNull();
  });

  it('the focus moving to another element of the page closes the panel', () => {
    const h = start();
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    h.open();
    elsewhere.focus();
    expect(h.dialog()).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });

  it('the focus moving inside the panel does not close it', () => {
    const h = start();
    h.open();
    h.search().focus();
    (h.modelRows()[0] as HTMLElement).focus();
    expect(h.dialog()).not.toBeNull();
  });
});

describe('the selection follows the host', () => {
  it('shows the new model after the effective one changes', () => {
    const h = start({ model: GLM });
    h.setModel({ providerID: 'acme', id: 'sonnet' });
    expect(h.chip().textContent).toBe('Build · Sonnet 4');
  });
});
