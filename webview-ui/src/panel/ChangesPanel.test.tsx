// Protects the Changes tab (issue #188): the heading that counts the files, the rows the list
// draws, the empty state for a session with no changes, the refresh error with and without rows, and
// that a click reports the exact path.
//
// Provenance: the component alone in jsdom with FABRICATED files. The wiring to `session.diff.open`
// is `App.test.tsx`; the look and the keyboard path are the checks of `test:visual` step 18.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChangedFile } from '../../../src/shared/model';
import { mount, must, type Mounted } from '../testing';
import { ChangesPanel } from './ChangesPanel';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

const file = (path: string, extra: Partial<ChangedFile> = {}): ChangedFile => ({
  path,
  status: 'modified',
  additions: 2,
  deletions: 1,
  binary: false,
  tooLarge: false,
  ...extra,
});

function setup(
  files: ChangedFile[],
  error: { code: string; message: string } | undefined = undefined,
) {
  const onOpen = vi.fn<(path: string) => void>();
  mounted = mount(() => <ChangesPanel files={files} error={error} onOpen={onOpen} />);
  return { onOpen, root: mounted.container };
}

describe('ChangesPanel', () => {
  it('says nothing changed yet when the list is empty', () => {
    const { root } = setup([]);
    expect(must(root, '.panel-empty').textContent).toBe('No files changed in this session yet');
    expect(root.querySelector('.changed-files')).toBeNull();
  });

  it('counts the files in a heading and draws one button per file, always open', () => {
    const { root } = setup([file('src/a.ts'), file('logo.png', { binary: true })]);
    const heading = must(root, 'h2.changed-files-title');
    expect(heading.textContent).toBe('Changed files (2)');
    expect(must(root, 'section.changed-files').getAttribute('aria-labelledby')).toBe(heading.id);
    expect(
      [...root.querySelectorAll('button')].map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Open diff of src/a.ts, Modified, 2 added, 1 deleted', 'Open logo.png, Binary']);
    expect(root.querySelector('details')).toBeNull();
  });

  it('reports the exact path of the pressed row', () => {
    const { root, onOpen } = setup([file('src/a.ts'), file('src/b.ts')]);
    root.querySelectorAll('button')[1]?.click();
    expect(onOpen).toHaveBeenCalledWith('src/b.ts');
  });

  it('shows the refresh error above the rows, and above the empty state too', () => {
    const withRows = setup([file('src/a.ts')], { code: 'Boom', message: 'it broke' });
    expect(must(withRows.root, '.changed-files-error').textContent).toBe(
      'Could not refresh the list: it broke',
    );
    expect(withRows.root.querySelectorAll('button')).toHaveLength(1);
    mounted?.dispose();
    const empty = setup([], { code: 'Boom', message: 'still broke' });
    expect(must(empty.root, '.changed-files-error').textContent).toBe(
      'Could not refresh the list: still broke',
    );
    expect(must(empty.root, '.panel-empty')).toBeDefined();
  });
});
