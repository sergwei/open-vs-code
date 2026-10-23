// Protects the rows of the "Changed files" list (issue #31): nothing is drawn for an empty list,
// each row is a real button with the accessible name of `openName`, a click reports the EXACT path
// (the host opens only a path it listed), and a row whose counts change keeps its DOM node (the
// store reconciles by path; a rebuilt node would lose the focus of a keyboard user mid-turn).
//
// Provenance: rows FABRICATED by hand and a real `createChatStore` driven with fabricated host
// messages, in jsdom. Enter/Space on a button are browser behaviour jsdom does not run; the real
// keyboard path is the `test:visual` check "Enter on the deleted row opens a diff editor".
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { ChangedFile } from '../../../src/shared/model';
import { createChatStore } from '../store/chatStore';
import { must, mount, type Mounted } from '../testing';
import { ChangedFilesList } from './ChangedFilesList';

let mounted: Mounted | undefined;
afterEach(() => {
  mounted?.dispose();
  mounted = undefined;
});

const rows: ChangedFile[] = [
  {
    path: 'src/a.ts',
    status: 'modified',
    additions: 3,
    deletions: 1,
    binary: false,
    tooLarge: false,
  },
  {
    path: 'src/new.ts',
    status: 'added',
    additions: 2,
    deletions: 0,
    binary: false,
    tooLarge: false,
  },
  {
    path: 'assets/logo.png',
    status: 'added',
    additions: 0,
    deletions: 0,
    binary: true,
    tooLarge: false,
  },
];

describe('ChangedFilesList', () => {
  it('names the rows with `nameOf` when the caller gives one (the revert block, issue #32)', () => {
    mounted = mount(() => (
      <ChangedFilesList
        files={rows}
        onOpen={() => undefined}
        nameOf={(file) => `custom ${file.path}`}
      />
    ));
    const names = [...mounted.container.querySelectorAll('button')].map((b) =>
      b.getAttribute('aria-label'),
    );
    expect(names).toEqual(['custom src/a.ts', 'custom src/new.ts', 'custom assets/logo.png']);
  });

  it('marks a file that is too large to diff, and keeps its counts in the row', () => {
    mounted = mount(() => (
      <ChangedFilesList
        files={[
          {
            path: 'docs/big.txt',
            status: 'added',
            additions: 1200,
            deletions: 0,
            binary: false,
            tooLarge: true,
          },
        ]}
        onOpen={() => undefined}
      />
    ));
    const button = must<HTMLButtonElement>(mounted.container, 'button');
    expect(button.getAttribute('data-status')).toBe('too-large');
    expect(must(button, '.session-meta').textContent).toBe('Too large to diff · +1200 −0');
    expect(button.getAttribute('aria-label')).toBe(
      'Open docs/big.txt, Too large to diff, 1200 added, 0 deleted',
    );
  });

  it('draws nothing for an empty list', () => {
    mounted = mount(() => <ChangedFilesList files={[]} onOpen={() => undefined} />);
    expect(mounted.container.querySelector('ul')).toBeNull();
    expect(mounted.container.textContent).toBe('');
  });

  it('draws one button per file with the path, the status word and the counts', () => {
    mounted = mount(() => <ChangedFilesList files={rows} onOpen={() => undefined} />);
    const buttons = [...mounted.container.querySelectorAll('button')];
    expect(buttons.map((b) => b.querySelector('.session-title')?.textContent)).toEqual([
      'src/a.ts',
      'src/new.ts',
      'assets/logo.png',
    ]);
    expect(buttons.map((b) => b.querySelector('.session-meta')?.textContent)).toEqual([
      'Modified · +3 −1',
      'Added · +2 −0',
      'Binary',
    ]);
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual([
      'Open diff of src/a.ts, Modified, 3 added, 1 deleted',
      'Open diff of src/new.ts, Added, 2 added, 0 deleted',
      'Open assets/logo.png, Binary',
    ]);
    expect(buttons.every((b) => b.type === 'button')).toBe(true);
    expect(buttons.every((b) => !b.hasAttribute('style'))).toBe(true);
  });

  it('reports the exact path of the row that was pressed', () => {
    const opened: string[] = [];
    mounted = mount(() => (
      <ChangedFilesList
        files={rows}
        onOpen={(path) => {
          opened.push(path);
        }}
      />
    ));
    const buttons = [...mounted.container.querySelectorAll('button')];
    buttons[1]?.click();
    buttons[0]?.click();
    expect(opened).toEqual(['src/new.ts', 'src/a.ts']);
  });

  it('keeps the node of a row whose counts changed in the store', () => {
    const store = createRoot(() => createChatStore());
    store.apply({
      type: 'snapshot',
      snapshot: {
        sessions: [],
        statuses: {},
        open: { sessionID: 's1', messages: [], parts: {} },
        requests: { permissions: [], forms: [] },
        resolutions: [],
      },
    });
    store.apply({ type: 'session.diff', sessionID: 's1', files: rows });
    mounted = mount(() => (
      <ChangedFilesList files={store.state.diff.files} onOpen={() => undefined} />
    ));
    const before = must<HTMLButtonElement>(mounted.container, 'button');
    store.apply({
      type: 'session.diff',
      sessionID: 's1',
      files: [
        {
          path: 'src/a.ts',
          status: 'modified',
          additions: 9,
          deletions: 1,
          binary: false,
          tooLarge: false,
        },
      ],
    });
    const after = must<HTMLButtonElement>(mounted.container, 'button');
    expect(after).toBe(before);
    expect(after.querySelector('.session-meta')?.textContent).toBe('Modified · +9 −1');
    expect(mounted.container.querySelectorAll('button')).toHaveLength(1);
  });
});
