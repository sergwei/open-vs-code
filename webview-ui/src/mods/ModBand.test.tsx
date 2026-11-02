// Protects the status bands of mods (E10-mods, phase 3): text a mod controls is printed as TEXT (a
// `<b>` must not become an element), the button has an `aria-label` that names the command and the
// mod, it calls back with the qualified command, and while `disabled` it is `aria-disabled` (never
// `disabled`, so the focus stays) and the click is ignored. Nothing renders without bands.
// Provenance: props FABRICATED by hand, rendered in jsdom. The contrast in the four themes and at
// 300 px is `test:visual` step 38.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModBand } from '../../../src/shared/model';
import { must, mount, type Mounted } from '../testing';
import { ModBands, shortCommandName } from './ModBand';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

const band = (extra: Partial<ModBand> = {}): ModBand => ({
  modId: 'hello-station',
  modName: 'Hello Station',
  text: 'Last turn: succeeded',
  severity: 'info',
  ...extra,
});

/** Mounts the bands with a spy; `disabled` and the bands are the knobs of the cases. */
function draw(bands: ModBand[], disabled = false) {
  const onRun = vi.fn();
  mounted = mount(() => <ModBands bands={bands} disabled={disabled} onRun={onRun} />);
  return { container: mounted.container, onRun };
}

describe('ModBands', () => {
  it('renders nothing when there are no bands', () => {
    const { container } = draw([]);
    expect(container.querySelector('.mod-bands')).toBeNull();
  });

  it('prints the name, the text and the severity of each band', () => {
    const { container } = draw([
      band(),
      band({ modId: 'two', modName: 'Two', text: 'Careful', severity: 'warning' }),
    ]);
    const rows = [...container.querySelectorAll('.mod-band')];
    expect(rows.map((row) => row.getAttribute('data-severity'))).toEqual(['info', 'warning']);
    expect(rows[0]?.querySelector('.mod-band-name')?.textContent).toBe('Hello Station');
    expect(rows[0]?.querySelector('.mod-band-text')?.textContent).toBe('Last turn: succeeded');
  });

  it('prints markup from a mod as text and puts the tooltip in a title attribute', () => {
    const { container } = draw([
      band({ text: 'a <b>bold</b> <img src=x onerror=alert(1)>', tooltip: '<i>tip</i>' }),
    ]);
    const text = must(container, '.mod-band-text');
    expect(text.textContent).toBe('a <b>bold</b> <img src=x onerror=alert(1)>');
    expect(container.querySelector('.mod-band b, .mod-band img, .mod-band i')).toBeNull();
    expect(must(container, '.mod-band').getAttribute('title')).toBe('<i>tip</i>');
  });

  it('gives the button an aria-label and calls back with the qualified command', () => {
    const { container, onRun } = draw([band({ command: 'hello-station:hello' })]);
    const button = must<HTMLButtonElement>(container, '.mod-band-action');
    expect(button.textContent).toBe('hello');
    expect(button.getAttribute('aria-label')).toBe('Run hello (Hello Station)');
    button.click();
    expect(onRun).toHaveBeenCalledExactlyOnceWith('hello-station:hello');
  });

  it('has no button when the band names no command', () => {
    const { container } = draw([band()]);
    expect(container.querySelector('button')).toBeNull();
  });

  it('is aria-disabled, not disabled, and ignores the click while disabled', () => {
    const { container, onRun } = draw([band({ command: 'hello-station:hello' })], true);
    const button = must<HTMLButtonElement>(container, '.mod-band-action');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.disabled).toBe(false);
    button.click();
    expect(onRun).not.toHaveBeenCalled();
  });
});

describe('shortCommandName', () => {
  it('drops the mod prefix and leaves an unqualified name alone', () => {
    expect(shortCommandName('hello-station:hello')).toBe('hello');
    expect(shortCommandName('hello')).toBe('hello');
  });
});
