// Protects the mods button and popover (E10-mod-toggles, issue #181) from the ways a popover with
// switches quietly breaks: the ARIA wiring (`aria-haspopup="dialog"`, `role="switch"` +
// `aria-checked`), the name "Mods: N active" with the badge hidden from assistive technology, the
// button absent with nothing listed, the focus on the first switch on open, Escape closing WITHOUT
// reaching the prompt box (spy on `window`: Solid delegates to `document`), a click that never
// assumes its outcome (`aria-busy` and `aria-disabled` until the next listing), `aria-disabled`
// switches with the global setting off and "Open Settings", the failed and skipped rows, the footer
// that changes with `persisted`, and the shipped Spanish catalog.
//
// Provenance: FABRICATED listings and events synthesized in jsdom with `document.activeElement`
// checks. They prove the wiring, not the look, the contrast or a real focus order: those are
// `test:visual` step 45.
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModEntry, ModsListing } from '../../../src/shared/model';
import { must, mount, useEnglish, useSpanish, type Mounted } from '../testing';
import { ModsMenu } from './ModsMenu';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
  vi.useRealTimers();
  useEnglish();
});

const quiet: ModEntry = {
  id: 'quiet',
  name: 'Quiet',
  version: '1.0.0',
  description: 'Counts in silence',
  enabled: true,
  state: 'active',
};
const hello: ModEntry = {
  id: 'hello-station',
  name: 'Hello Station',
  version: '0.2.0',
  enabled: true,
  state: 'active',
};

function listingOf(extra: Partial<ModsListing> = {}): ModsListing {
  return { enabled: true, persisted: true, mods: [quiet, hello], skipped: [], ...extra };
}

function setup(initial: ModsListing = listingOf()) {
  const [listing, setListing] = createSignal(initial);
  const onToggle = vi.fn<(id: string, enabled: boolean) => void>();
  const onAction = vi.fn<(action: 'openFolder' | 'openSettings') => void>();
  let closeFromParent: (() => void) | undefined;
  mounted = mount(() => (
    <ModsMenu
      listing={listing()}
      onToggle={onToggle}
      onAction={onAction}
      onCloseReady={(close) => {
        closeFromParent = close;
      }}
    />
  ));
  const root = mounted.container;
  const trigger = (): HTMLButtonElement | null =>
    root.querySelector<HTMLButtonElement>('[data-mods-trigger]');
  const switches = (): HTMLButtonElement[] => [
    ...root.querySelectorAll<HTMLButtonElement>('button[role="switch"]'),
  ];
  const dialog = (): Element | null => root.querySelector('[role="dialog"]');
  return {
    root,
    trigger,
    switches,
    dialog,
    onToggle,
    onAction,
    setListing,
    closeFromParent: () => {
      closeFromParent?.();
    },
  };
}

describe('ModsMenu', () => {
  it('is named "Mods: N active" with an aria-hidden badge, and is a dialog button', () => {
    const { trigger } = setup();
    const button = must<HTMLButtonElement>(document.body, '[data-mods-trigger]');
    expect(button).toBe(trigger());
    expect(button.getAttribute('aria-label')).toBe('Mods: 2 active');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    const badge = must(button, '.mods-badge');
    expect(badge.getAttribute('aria-hidden')).toBe('true');
    expect(badge.textContent).toBe('2');
  });

  it('drops the badge at zero active mods and renders nothing with an empty listing', () => {
    const { trigger, setListing } = setup(listingOf({ mods: [{ ...quiet, state: 'disabled' }] }));
    expect(trigger()?.getAttribute('aria-label')).toBe('Mods: 0 active');
    expect(trigger()?.querySelector('.mods-badge')).toBeNull();
    setListing(listingOf({ mods: [], skipped: [] }));
    expect(trigger()).toBeNull();
    setListing(listingOf({ mods: [], skipped: [{ folder: 'broken', reason: 'no mod.json' }] }));
    expect(trigger()).not.toBeNull();
  });

  it('opens with the focus on the first switch, and on "Open folder" when there is none', () => {
    const first = setup();
    first.trigger()?.click();
    expect(first.dialog()?.getAttribute('aria-labelledby')).toBe('mods-menu-heading');
    expect(document.activeElement).toBe(first.switches()[0]);
    expect(first.trigger()?.getAttribute('aria-expanded')).toBe('true');
    mounted?.dispose();
    const second = setup(listingOf({ mods: [], skipped: [{ folder: 'x', reason: 'bad' }] }));
    second.trigger()?.click();
    expect(document.activeElement?.textContent).toBe('Open folder');
  });

  it('shows switches by role and aria-checked, and a state line for starting and failed', () => {
    const { trigger, switches, root } = setup(
      listingOf({
        mods: [
          quiet,
          { ...hello, state: 'disabled' },
          {
            id: 'throws',
            name: 'Throws',
            version: '1.0.0',
            enabled: true,
            state: 'failed',
            error: 'boom',
          },
          { id: 'slow', name: 'Slow', version: '1.0.0', enabled: true, state: 'starting' },
        ],
        skipped: [{ folder: 'broken', reason: 'no mod.json' }],
      }),
    );
    trigger()?.click();
    expect(switches().map((s) => s.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'true',
      'true',
    ]);
    const text = root.textContent;
    expect(text).toContain('boom');
    expect(text).toContain('Starting…');
    expect(text).toContain('Skipped: no mod.json');
    expect(root.querySelectorAll('.mods-skipped button')).toHaveLength(0);
  });

  it('a click calls onToggle with the opposite and leaves the row busy until the next listing', () => {
    const { trigger, switches, onToggle, setListing, root } = setup();
    trigger()?.click();
    switches()[0]?.click();
    expect(onToggle).toHaveBeenCalledExactlyOnceWith('quiet', false);
    expect(switches()[0]?.getAttribute('aria-disabled')).toBe('true');
    expect(root.querySelector('.mods-row')?.getAttribute('aria-busy')).toBe('true');
    switches()[0]?.click();
    expect(onToggle).toHaveBeenCalledTimes(1);
    // The switch did not change on its own: the host's answer does it.
    expect(switches()[0]?.getAttribute('aria-checked')).toBe('true');
    setListing(listingOf({ mods: [{ ...quiet, state: 'disabled' }, hello] }));
    expect(switches()[0]?.getAttribute('aria-checked')).toBe('false');
    expect(switches()[0]?.getAttribute('aria-disabled')).toBeNull();
  });

  it('a click on a focused switch of another row toggles that row', () => {
    const { trigger, switches, onToggle } = setup();
    trigger()?.click();
    // This does NOT press Space (jsdom does not turn it into a click): the real keyboard path is
    // only exercised by `test:visual` step 45, whose failures are listed in the header of `ModsMenu`.
    switches()[1]?.focus();
    switches()[1]?.click();
    expect(onToggle).toHaveBeenCalledWith('hello-station', false);
  });

  it('frees a busy row after the limit when the host never answers', () => {
    vi.useFakeTimers();
    const { trigger, switches } = setup();
    trigger()?.click();
    switches()[0]?.click();
    expect(switches()[0]?.getAttribute('aria-disabled')).toBe('true');
    vi.advanceTimersByTime(5000);
    expect(switches()[0]?.getAttribute('aria-disabled')).toBeNull();
  });

  it('Escape closes, returns the focus to the button and does not reach window', () => {
    const { trigger, dialog } = setup();
    trigger()?.click();
    const spy = vi.fn();
    window.addEventListener('keydown', spy);
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.activeElement?.dispatchEvent(escape);
    window.removeEventListener('keydown', spy);
    expect(escape.defaultPrevented).toBe(true);
    expect(spy).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on a pointer-down outside, on window blur and from the parent, without moving the focus', () => {
    const { trigger, dialog, closeFromParent } = setup();
    trigger()?.click();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(dialog()).toBeNull();
    trigger()?.click();
    window.dispatchEvent(new Event('blur'));
    expect(dialog()).toBeNull();
    trigger()?.click();
    closeFromParent();
    expect(dialog()).toBeNull();
  });

  it('closes when the focus leaves the dialog for another element (Tab out)', () => {
    const { trigger, dialog, root } = setup();
    const outside = document.createElement('button');
    document.body.append(outside);
    trigger()?.click();
    const sw = must<HTMLButtonElement>(root, 'button[role="switch"]');
    sw.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
    outside.remove();
    expect(dialog()).toBeNull();
  });

  it('with the global switch off: notice, aria-disabled switches, Open Settings, no toggle', () => {
    const { trigger, switches, onToggle, onAction, root } = setup(listingOf({ enabled: false }));
    trigger()?.click();
    expect(root.textContent).toContain('Mods are turned off');
    expect(switches().every((s) => s.getAttribute('aria-disabled') === 'true')).toBe(true);
    expect(switches().some((s) => s.hasAttribute('disabled'))).toBe(false);
    switches()[0]?.click();
    expect(onToggle).not.toHaveBeenCalled();
    [...root.querySelectorAll<HTMLButtonElement>('.mods-link')]
      .find((b) => b.textContent === 'Open Settings')
      ?.click();
    expect(onAction).toHaveBeenCalledWith('openSettings');
  });

  it('"Open folder" asks for openFolder', () => {
    const { trigger, onAction, root } = setup();
    trigger()?.click();
    must<HTMLButtonElement>(root, '.mods-link').click();
    expect(onAction).toHaveBeenCalledWith('openFolder');
  });

  it('the footer follows persisted', () => {
    const { trigger, root, setListing } = setup();
    trigger()?.click();
    expect(must(root, '.mods-footer').textContent).toBe(
      'Each switch starts or stops only that mod. Saved for this workspace.',
    );
    setListing(listingOf({ persisted: false }));
    expect(must(root, '.mods-footer').textContent).toBe(
      'No folder open: these choices last until you close this window',
    );
  });

  it('uses the singular in Spanish for one active mod', () => {
    useSpanish();
    const { trigger } = setup(listingOf({ mods: [quiet, { ...hello, state: 'disabled' }] }));
    expect(trigger()?.getAttribute('aria-label')).toBe('Mods: 1 activo');
  });

  it('describes each switch by its description and its state line', () => {
    const { trigger, root } = setup(
      listingOf({
        mods: [quiet, { ...hello, state: 'failed', error: 'boom' }],
      }),
    );
    trigger()?.click();
    const [first, second] = [...root.querySelectorAll<HTMLButtonElement>('button[role="switch"]')];
    const text = (button: HTMLButtonElement | undefined): string =>
      (button?.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent ?? '')
        .join('|');
    expect(text(first)).toBe('Counts in silence');
    // `hello` has no description: only its state line (the error) describes it.
    expect(text(second)).toBe('boom');
  });

  it('reads the shipped Spanish catalog', () => {
    useSpanish();
    const { trigger, root } = setup();
    trigger()?.click();
    expect(trigger()?.getAttribute('aria-label')).toBe('Mods: 2 activos');
    expect(root.textContent).toContain('Abrir carpeta');
    expect(must(root, '.mods-footer').textContent).toContain('Se guarda para este espacio');
  });
});
