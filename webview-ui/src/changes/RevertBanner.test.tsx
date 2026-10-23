// Protects the block under the conversation while a revert is prepared (issue #32): the title says
// how many messages were reverted, the rows are the files the revert changed (with the accessible
// name of "what the revert undid"), the two buttons call back, and while `disabled` they are
// `aria-disabled` (never `disabled`, so the focus stays) and the click is ignored.
// Provenance: props FABRICATED by hand, rendered in jsdom. The contrast in the four themes and the
// real modal behind "Discard for good" are `test:visual` step 19.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangedFile } from '../../../src/shared/model';
import { must, mount, type Mounted } from '../testing';
import { RevertBanner } from './RevertBanner';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

const file = (path: string, extra: Partial<ChangedFile> = {}): ChangedFile => ({
  path,
  status: 'modified',
  additions: 3,
  deletions: 1,
  binary: false,
  tooLarge: false,
  ...extra,
});

/** Mounts the banner with spies; `disabled` and the rows are the knobs of the cases. */
function draw(options: { files?: ChangedFile[]; disabled?: boolean; count?: number } = {}) {
  const spies = {
    onRestore: vi.fn(),
    onDiscard: vi.fn(),
    onOpenFile: vi.fn(),
  };
  mounted = mount(() => (
    <RevertBanner
      revert={{ messageID: 'm3', files: options.files ?? [] }}
      split={{ revertedCount: options.count ?? 2, found: true }}
      disabled={options.disabled ?? false}
      {...spies}
    />
  ));
  return { container: mounted.container, ...spies };
}

describe('RevertBanner', () => {
  it('says how many messages were reverted and warns that sending discards them', () => {
    const { container } = draw({ count: 2 });
    expect(must(container, '.revert-banner-title').textContent).toBe('2 messages reverted');
    expect(must(container, '.revert-banner-note').textContent).toContain('discards them for good');
    expect(container.querySelector('section')?.getAttribute('aria-label')).toBe(
      'Reverted messages',
    );
  });

  it('draws no list and no caption without files', () => {
    const { container } = draw();
    expect(container.querySelector('.changed-files-list')).toBeNull();
    expect(container.querySelector('.revert-banner-caption')).toBeNull();
  });

  it('draws one row per file, named after what the revert undid, and a click reports the path', () => {
    const { container, onOpenFile } = draw({
      files: [file('src/a.ts'), file('logo.png', { binary: true })],
    });
    expect(must(container, '.revert-banner-caption').textContent).toBe('2 files changed on disk');
    const names = [...container.querySelectorAll('.changed-file')].map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(names).toEqual([
      'Show what the revert undid in src/a.ts, Modified, 3 added, 1 deleted',
      'Open logo.png, Binary',
    ]);
    must<HTMLButtonElement>(container, '.changed-file').click();
    expect(onOpenFile).toHaveBeenCalledWith('src/a.ts');
  });

  it('calls back for Restore and for Discard for good', () => {
    const { container, onRestore, onDiscard } = draw();
    const [restore, discard] = [
      ...container.querySelectorAll<HTMLButtonElement>('.revert-banner-actions button'),
    ];
    expect(restore?.textContent).toBe('Restore');
    expect(discard?.textContent).toBe('Discard for good');
    restore?.click();
    expect(onRestore).toHaveBeenCalledTimes(1);
    discard?.click();
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('locks both buttons with aria-disabled (not disabled) and ignores the click', () => {
    const { container, onRestore, onDiscard } = draw({ disabled: true });
    for (const button of container.querySelectorAll<HTMLButtonElement>(
      '.revert-banner-actions button',
    )) {
      expect(button.getAttribute('aria-disabled')).toBe('true');
      expect(button.hasAttribute('disabled')).toBe(false);
      button.focus();
      button.click();
      expect(document.activeElement).toBe(button);
    }
    expect(onRestore).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });
});
