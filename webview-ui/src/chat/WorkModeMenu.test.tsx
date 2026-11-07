// Protects the work-mode pill (E3-work-mode) from the ways a menu button quietly breaks: the
// WAI-ARIA wiring (`menuitemradio` + `aria-checked`, the checked item focused on open), the roving
// keys, Escape closing WITHOUT reaching the prompt box (spy on `window`, because Solid delegates to
// `document`), Tab and Shift+Tab not being trapped, `aria-disabled` instead of `disabled`, the
// name "Work mode: {0}" staying when only the icon shows, choosing the current mode calling
// nothing, and the shipped Spanish catalog for the pill and the two descriptions.
//
// Provenance: events synthesized in jsdom with `document.activeElement` checks, plus the Spanish
// catalog read from `l10n/bundle.l10n.es.json` through `useSpanish`. They prove the wiring, not
// the look, the contrast of the bolt or a real focus order: those are `test:visual` step 44.
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkMode } from '../../../src/shared/model';
import { must, mount, useEnglish, useSpanish, type Mounted } from '../testing';
import { WorkModeMenu } from './WorkModeMenu';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
  useEnglish();
});

function setup(initial: WorkMode = 'manual', disabled = false) {
  const [mode, setMode] = createSignal<WorkMode>(initial);
  const onSelect = vi.fn<(next: WorkMode) => void>();
  mounted = mount(() => <WorkModeMenu mode={mode()} disabled={disabled} onSelect={onSelect} />);
  const pill = must<HTMLButtonElement>(mounted.container, 'button[aria-haspopup="menu"]');
  const items = (): HTMLButtonElement[] => [
    ...(mounted?.container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []),
  ];
  const press = (target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
  };
  return { pill, items, press, onSelect, setMode };
}

describe('WorkModeMenu', () => {
  it('names the pill by its mode and swaps the text when the mode changes', () => {
    const { pill, setMode } = setup();
    expect(pill.getAttribute('aria-label')).toBe('Work mode: Manual');
    expect(pill.textContent).toBe('Manual');
    setMode('auto');
    expect(pill.getAttribute('aria-label')).toBe('Work mode: Auto');
    expect(pill.textContent).toBe('Auto');
    expect(pill.querySelector('svg')).not.toBeNull();
  });

  it('opens with two radio items, the checked one focused, and the descriptions', () => {
    const { pill, items } = setup('auto');
    pill.click();
    expect(pill.getAttribute('aria-expanded')).toBe('true');
    expect(pill.getAttribute('aria-controls')).toBe(
      must(mounted?.container ?? document.body, '[role="menu"]').id,
    );
    expect(items().map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true']);
    expect(document.activeElement).toBe(items()[1]);
    expect(items()[0]?.textContent).toContain("Asks whenever opencode's permission rules ask.");
    expect(items()[1]?.textContent).toContain(
      "Approves opencode's permission requests for you, except those it recognises as reading secrets, going outside the project, deleting, destructive commands or publishing or pushing. The agent's questions still reach you.",
    );
  });

  it('chooses with the keyboard, returns the focus to the pill and reports the mode', () => {
    const { pill, items, press, onSelect } = setup();
    press(pill, 'ArrowDown');
    expect(document.activeElement).toBe(items()[0]);
    press(items()[0] ?? pill, 'ArrowDown');
    expect(document.activeElement).toBe(items()[1]);
    items()[1]?.click();
    expect(onSelect).toHaveBeenCalledWith('auto');
    expect(items()).toHaveLength(0);
    expect(document.activeElement).toBe(pill);
  });

  it('choosing the mode already set only closes the menu', () => {
    const { pill, items, onSelect } = setup();
    pill.click();
    items()[0]?.click();
    expect(onSelect).not.toHaveBeenCalled();
    expect(items()).toHaveLength(0);
  });

  it('Escape closes it, returns the focus and never reaches window', () => {
    const { pill, items, press } = setup();
    pill.click();
    const spy = vi.fn();
    window.addEventListener('keydown', spy);
    const escape = press(items()[0] ?? pill, 'Escape');
    window.removeEventListener('keydown', spy);
    expect(escape.defaultPrevented).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(items()).toHaveLength(0);
    expect(document.activeElement).toBe(pill);
  });

  it('Tab and Shift+Tab close it without preventing the default move', () => {
    const { pill, items, press } = setup();
    pill.click();
    expect(press(items()[0] ?? pill, 'Tab', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(items()).toHaveLength(0);
    expect(document.activeElement).toBe(pill);
  });

  it('is aria-disabled, not disabled, and ignores the click without a connection', () => {
    const { pill, items } = setup('manual', true);
    expect(pill.disabled).toBe(false);
    expect(pill.getAttribute('aria-disabled')).toBe('true');
    pill.click();
    expect(items()).toHaveLength(0);
  });

  it('reads the pill and the descriptions from the shipped Spanish catalog', () => {
    useSpanish();
    const { pill, items } = setup('auto');
    expect(pill.getAttribute('aria-label')).toBe('Modo de trabajo: Auto');
    pill.click();
    expect(items()[0]?.textContent).toContain(
      'Pregunta cuando lo piden las reglas de permisos de opencode.',
    );
    expect(items()[1]?.textContent).toContain(
      'Aprueba por usted los permisos que pida opencode, salvo los que reconoce como leer secretos, salir del proyecto, borrar, comandos destructivos o publicar o hacer push. Las preguntas del agente le siguen llegando.',
    );
  });
});
